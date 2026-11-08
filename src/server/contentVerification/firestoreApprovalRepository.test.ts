import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FirestoreApprovalRecordRepository,
  UnavailableApprovalRecordRepository,
  MemoryApprovalRecordRepository,
  APPROVAL_COLLECTION,
  activeApprovalDocId,
  versionApprovalDocId,
  auditEventDocPath,
} from './approvalRepository.ts';
import { StrictFakeFirestore } from '../firestoreTestDouble.ts';
import type { ServerApprovalRecord } from './types.ts';

function createSampleRecord(overrides: Partial<ServerApprovalRecord> = {}): ServerApprovalRecord {
  return {
    schemaVersion: 2,
    reviewStatus: 'verified',
    questionId: 'PHY-01-CP1-Q1',
    reviewerUid: 'uid-reviewer-phys-01',
    reviewerId: 'sme-phys-dr-sharma',
    subject: 'physics',
    checkpointId: 'PHY-01-CP1',
    topicId: 'units_and_measurements',
    contentDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    contentVersion: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    reviewedAt: '2026-11-04T12:00:00.000Z',
    reviewNotes: 'Standard physics review confirmed.',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
    signature: 'mock_sig_v1',
    signingKeyId: 'kms-key-v1',
    signatureAlgorithm: 'RSASSA_PSS_SHA_256',
    lifecycleStatus: 'approved',
    ...overrides,
  };
}

test('firestoreRepo: 1. Create and retrieve an approval document with subcollection audit event', async () => {
  const db = new StrictFakeFirestore();
  const repo = new FirestoreApprovalRecordRepository(db);
  const sample = createSampleRecord();

  const outcome = await repo.saveApproval(sample);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  assert.equal(outcome.isDuplicate, false);
  assert.equal(outcome.record.lifecycleStatus, 'approved');
  assert.equal(outcome.record.versionNumber, 1);
  assert.equal(outcome.record.questionId, 'PHY-01-CP1-Q1');

  // Verify retrieval of active approval
  const active = await repo.getActiveApproval('PHY-01-CP1-Q1');
  assert.ok(active);
  assert.equal(active.contentDigest, sample.contentDigest);
  assert.equal(active.versionNumber, 1);

  // Verify retrieval by specific digest
  const byDigest = await repo.getApprovalByDigest('PHY-01-CP1-Q1', sample.contentDigest);
  assert.ok(byDigest);
  assert.equal(byDigest.contentDigest, sample.contentDigest);

  // Verify deterministic Firestore document paths
  const activeDoc = db.docs.get(`${APPROVAL_COLLECTION}/${activeApprovalDocId('PHY-01-CP1-Q1')}`);
  assert.ok(activeDoc);
  assert.equal(activeDoc.docType, 'active_pointer');
  assert.equal(activeDoc.activeDigest, sample.contentDigest);
  assert.equal(activeDoc.auditCount, 1);

  const versionDoc = db.docs.get(`${APPROVAL_COLLECTION}/${versionApprovalDocId('PHY-01-CP1-Q1', sample.contentDigest)}`);
  assert.ok(versionDoc);
  assert.equal(versionDoc.docType, 'version_record');

  // Verify audit event document in subcollection (AUD-01: subcollection, NOT monolithic doc)
  const history = await repo.getAuditHistory('PHY-01-CP1-Q1');
  assert.equal(history.length, 1);
  const firstEvent = history[0];
  const auditPath = auditEventDocPath('PHY-01-CP1-Q1', firstEvent.eventId);
  const auditDoc = db.docs.get(auditPath);
  assert.ok(auditDoc, 'Audit event document should exist at subcollection path');
  assert.equal(auditDoc.docType, 'audit_event');
  assert.equal(auditDoc.sequenceNumber, 1);
  assert.equal(auditDoc.questionId, 'PHY-01-CP1-Q1');
  assert.equal(auditDoc.contentDigest, sample.contentDigest);
  assert.equal(auditDoc.eventType, 'approved');

  // Confirm no monolithic audit document was created
  assert.equal(db.docs.get(`${APPROVAL_COLLECTION}/audit_PHY-01-CP1-Q1`), undefined);
});

test('firestoreRepo: 2. Duplicate approval idempotency preserves record and avoids duplicate audit events', async () => {
  const db = new StrictFakeFirestore();
  const repo = new FirestoreApprovalRecordRepository(db);
  const sample = createSampleRecord();

  const first = await repo.saveApproval(sample);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.isDuplicate, false);

  const commitsBefore = db.commits;

  // Duplicate request with identical question and contentDigest
  const second = await repo.saveApproval(sample);
  assert.equal(second.ok, true);
  if (!second.ok) return;

  assert.equal(second.isDuplicate, true);
  assert.equal(second.record.contentDigest, sample.contentDigest);
  assert.equal(second.record.signature, sample.signature);
  assert.equal(second.record.versionNumber, 1);
  // No new write commit on idempotent return
  assert.equal(db.commits, commitsBefore);

  // Exactly one audit event exists
  const history = await repo.getAuditHistory(sample.questionId);
  assert.equal(history.length, 1);
});

test('firestoreRepo: 3. Revocation and retrieval of revocation history', async () => {
  const db = new StrictFakeFirestore();
  const repo = new FirestoreApprovalRecordRepository(db);
  const sample = createSampleRecord();

  await repo.saveApproval(sample);

  // Revoke approval
  const revokeOutcome = await repo.revokeApproval(sample.questionId, sample.contentDigest, {
    revokedBy: 'uid-admin-audit',
    reason: 'Identified ambiguous unit definition in option B',
  });

  assert.equal(revokeOutcome.ok, true);
  if (!revokeOutcome.ok) return;

  assert.equal(revokeOutcome.record.lifecycleStatus, 'revoked');
  assert.equal(revokeOutcome.record.revokedBy, 'uid-admin-audit');
  assert.equal(revokeOutcome.record.revocationReason, 'Identified ambiguous unit definition in option B');
  assert.ok(revokeOutcome.record.revokedAt);

  // Active approval must now be null
  const active = await repo.getActiveApproval(sample.questionId);
  assert.equal(active, null);

  // Record by digest is preserved as 'revoked'
  const byDigest = await repo.getApprovalByDigest(sample.questionId, sample.contentDigest);
  assert.ok(byDigest);
  assert.equal(byDigest.lifecycleStatus, 'revoked');

  // Second revocation fails with already_revoked
  const repeatRevoke = await repo.revokeApproval(sample.questionId, sample.contentDigest, {
    revokedBy: 'uid-admin-audit',
    reason: 'Duplicate revocation call',
  });
  assert.equal(repeatRevoke.ok, false);
  if (!repeatRevoke.ok) {
    assert.equal(repeatRevoke.code, 'already_revoked');
  }

  // Audit history contains both approved and revoked events
  const history = await repo.getAuditHistory(sample.questionId);
  assert.equal(history.length, 2);
  assert.equal(history[0].eventType, 'approved');
  assert.equal(history[0].sequenceNumber, 1);
  assert.equal(history[1].eventType, 'revoked');
  assert.equal(history[1].sequenceNumber, 2);
  assert.equal(history[1].details, 'Identified ambiguous unit definition in option B');

  // Check subcollection document for revoked event
  const revokeEvent = history[1];
  const revokeEventDoc = db.docs.get(auditEventDocPath(sample.questionId, revokeEvent.eventId));
  assert.ok(revokeEventDoc);
  assert.equal(revokeEventDoc.docType, 'audit_event');
  assert.equal(revokeEventDoc.sequenceNumber, 2);
  assert.equal(revokeEventDoc.eventType, 'revoked');
});

test('firestoreRepo: 4. Re-approval after revocation increments version and records audit', async () => {
  const db = new StrictFakeFirestore();
  const repo = new FirestoreApprovalRecordRepository(db);
  const sample = createSampleRecord();

  await repo.saveApproval(sample);
  await repo.revokeApproval(sample.questionId, sample.contentDigest, {
    revokedBy: 'uid-admin-01',
    reason: 'Correction needed',
  });

  // Re-approve the question content
  const reapprovalSample = createSampleRecord({
    reviewedAt: '2026-11-04T15:00:00.000Z',
    reviewNotes: 'Re-reviewed and confirmed valid by SME council.',
  });

  const reapproveOutcome = await repo.saveApproval(reapprovalSample);
  assert.equal(reapproveOutcome.ok, true);
  if (!reapproveOutcome.ok) return;

  assert.equal(reapproveOutcome.isDuplicate, false);
  assert.equal(reapproveOutcome.record.lifecycleStatus, 'approved');
  assert.equal(reapproveOutcome.record.versionNumber, 2);

  // Active approval is restored
  const active = await repo.getActiveApproval(sample.questionId);
  assert.ok(active);
  assert.equal(active.lifecycleStatus, 'approved');
  assert.equal(active.versionNumber, 2);

  // Audit log contains: approved -> revoked -> re_approved
  const history = await repo.getAuditHistory(sample.questionId);
  assert.equal(history.length, 3);
  assert.equal(history[0].eventType, 'approved');
  assert.equal(history[1].eventType, 'revoked');
  assert.equal(history[2].eventType, 're_approved');
  assert.equal(history[2].sequenceNumber, 3);
});

test('firestoreRepo: 5. Superseding an older content version requires expectedCurrentVersion (AUD-03)', async () => {
  const db = new StrictFakeFirestore();
  const repo = new FirestoreApprovalRecordRepository(db);

  const v1 = createSampleRecord({
    contentDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    contentVersion: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    reviewedAt: '2026-11-04T10:00:00.000Z',
  });
  await repo.saveApproval(v1);

  const v2 = createSampleRecord({
    contentDigest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    contentVersion: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    reviewedAt: '2026-11-04T14:00:00.000Z',
    reviewNotes: 'Improved explanation clarity.',
  });

  // Attempting to supersede without expectedCurrentVersion must fail with expected_version_required
  const unversionedOutcome = await repo.saveApproval(v2);
  assert.equal(unversionedOutcome.ok, false);
  if (!unversionedOutcome.ok) {
    assert.equal(unversionedOutcome.code, 'expected_version_required');
  }

  // Superseding with correct expectedCurrentVersion succeeds
  const outcome2 = await repo.saveApproval(v2, {
    expectedCurrentVersion: v1.contentDigest,
  });

  assert.equal(outcome2.ok, true);
  if (!outcome2.ok) return;
  assert.equal(outcome2.record.versionNumber, 2);

  // Active approval is now v2
  const active = await repo.getActiveApproval(v1.questionId);
  assert.ok(active);
  assert.equal(active.contentDigest, v2.contentDigest);
  assert.equal(active.versionNumber, 2);

  // Previous v1 record is now marked 'superseded'
  const v1Doc = await repo.getApprovalByDigest(v1.questionId, v1.contentDigest);
  assert.ok(v1Doc);
  assert.equal(v1Doc.lifecycleStatus, 'superseded');
  assert.equal(v1Doc.supersededBy, v2.contentDigest);

  // Audit history reflects superseding event
  const history = await repo.getAuditHistory(v1.questionId);
  assert.ok(history.some((h) => h.eventType === 'superseded' && h.details?.includes(v2.contentDigest)));
});

test('firestoreRepo: 6. Stale or conflicting version rejection', async () => {
  const db = new StrictFakeFirestore();
  const repo = new FirestoreApprovalRecordRepository(db);

  const activeV2 = createSampleRecord({
    contentDigest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    contentVersion: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    reviewedAt: '2026-11-04T14:00:00.000Z',
  });
  await repo.saveApproval(activeV2);

  // 1. Attempting to approve older timestamp version fails with stale_version_conflict
  const staleV1 = createSampleRecord({
    contentDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    contentVersion: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    reviewedAt: '2026-11-04T10:00:00.000Z',
  });
  const staleOutcome = await repo.saveApproval(staleV1, {
    expectedCurrentVersion: activeV2.contentDigest,
  });
  assert.equal(staleOutcome.ok, false);
  if (!staleOutcome.ok) {
    assert.equal(staleOutcome.code, 'stale_version_conflict');
  }

  // 2. Optimistic concurrency check with mismatched expectedCurrentVersion
  const conflictingV3 = createSampleRecord({
    contentDigest: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
    contentVersion: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
    reviewedAt: '2026-11-04T16:00:00.000Z',
  });
  const conflictOutcome = await repo.saveApproval(conflictingV3, {
    expectedCurrentVersion: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  });
  assert.equal(conflictOutcome.ok, false);
  if (!conflictOutcome.ok) {
    assert.equal(conflictOutcome.code, 'concurrency_conflict');
  }

  // Active record remains unchanged
  const currentActive = await repo.getActiveApproval(activeV2.questionId);
  assert.equal(currentActive?.contentDigest, activeV2.contentDigest);
});

test('firestoreRepo: 7. Two concurrent approvals for the same question', async () => {
  const db = new StrictFakeFirestore();
  const repo = new FirestoreApprovalRecordRepository(db);
  const sample = createSampleRecord();

  // Issue two approvals concurrently
  const [res1, res2] = await Promise.all([
    repo.saveApproval(sample),
    repo.saveApproval(sample),
  ]);

  assert.equal(res1.ok, true);
  assert.equal(res2.ok, true);

  // Exactly one creates the record, the other is an idempotent duplicate
  const duplicates = [res1, res2].filter((r) => r.ok && r.isDuplicate);
  const creates = [res1, res2].filter((r) => r.ok && !r.isDuplicate);

  assert.equal(creates.length, 1);
  assert.equal(duplicates.length, 1);

  // Exactly one active record exists in Firestore
  const active = await repo.getActiveApproval(sample.questionId);
  assert.ok(active);
  assert.equal(active.versionNumber, 1);
});

test('firestoreRepo: 8. Concurrent approval and revocation maintains transactional consistency', async () => {
  const db = new StrictFakeFirestore();
  const repo = new FirestoreApprovalRecordRepository(db);
  const sampleA = createSampleRecord({
    contentDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    contentVersion: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    reviewedAt: '2026-11-04T12:00:00.000Z',
  });
  await repo.saveApproval(sampleA);

  const sampleB = createSampleRecord({
    contentDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    contentVersion: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    reviewedAt: '2026-11-04T13:00:00.000Z',
  });

  // Concurrently revoke sampleA and save sampleB (with expectedCurrentVersion)
  const [revokeRes, saveRes] = await Promise.all([
    repo.revokeApproval(sampleA.questionId, sampleA.contentDigest, {
      revokedBy: 'uid-admin-revoker',
      reason: 'Superseded by sampleB review',
    }),
    repo.saveApproval(sampleB, { expectedCurrentVersion: sampleA.contentDigest }),
  ]);

  assert.equal(revokeRes.ok, true);
  assert.equal(saveRes.ok, true);

  // Firestore state is consistent: sampleB is active
  const active = await repo.getActiveApproval(sampleA.questionId);
  assert.ok(active);
  assert.equal(active.contentDigest, sampleB.contentDigest);

  // Audit history contains all events without loss
  const history = await repo.getAuditHistory(sampleA.questionId);
  assert.ok(history.length >= 2);
});

test('firestoreRepo: 9. Persistence across repository/client re-instantiation', async () => {
  const sharedDb = new StrictFakeFirestore();
  const sample = createSampleRecord();

  // Client 1 saves the approval
  const repoClient1 = new FirestoreApprovalRecordRepository(sharedDb);
  const saveResult = await repoClient1.saveApproval(sample);
  assert.equal(saveResult.ok, true);

  // Client 2 instantiated anew from the shared database
  const repoClient2 = new FirestoreApprovalRecordRepository(sharedDb);
  const active = await repoClient2.getActiveApproval(sample.questionId);
  assert.ok(active);
  assert.equal(active.questionId, sample.questionId);
  assert.equal(active.contentDigest, sample.contentDigest);
  assert.equal(active.versionNumber, 1);

  const audit = await repoClient2.getAuditHistory(sample.questionId);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actorUid, sample.reviewerUid);
});

test('firestoreRepo: 10. Failure behavior when Firestore is unavailable', async () => {
  // Case A: StrictFakeFirestore with simulated database failure
  const failingDb = new StrictFakeFirestore();
  failingDb.failNext = 'Firestore DEADLINE_EXCEEDED';
  const repo = new FirestoreApprovalRecordRepository(failingDb);
  const sample = createSampleRecord();

  const saveOutcome = await repo.saveApproval(sample);
  assert.equal(saveOutcome.ok, false);
  if (!saveOutcome.ok) {
    assert.equal(saveOutcome.code, 'repository_unavailable');
    assert.ok(saveOutcome.error.includes('Firestore transaction failed'));
  }

  failingDb.failNext = 'Firestore UNAVAILABLE';
  const revokeOutcome = await repo.revokeApproval(sample.questionId, sample.contentDigest, {
    revokedBy: 'uid-admin',
    reason: 'test failure',
  });
  assert.equal(revokeOutcome.ok, false);
  if (!revokeOutcome.ok) {
    assert.equal(revokeOutcome.code, 'repository_unavailable');
  }

  // Case B: UnavailableApprovalRecordRepository fails closed
  const unavailableRepo = new UnavailableApprovalRecordRepository('Credentials missing in production');
  const unavailSave = await unavailableRepo.saveApproval(sample);
  assert.equal(unavailSave.ok, false);
  if (!unavailSave.ok) {
    assert.equal(unavailSave.code, 'repository_unavailable');
    assert.equal(unavailSave.error, 'Credentials missing in production');
  }

  const unavailActive = await unavailableRepo.getActiveApproval(sample.questionId);
  assert.equal(unavailActive, null);

  const unavailAudit = await unavailableRepo.getAuditHistory(sample.questionId);
  assert.deepEqual(unavailAudit, []);
});

test('firestoreRepo: 11. Question ID and content digest allowlist validation (AUD-02)', async () => {
  const db = new StrictFakeFirestore();
  const repo = new FirestoreApprovalRecordRepository(db);
  const validSample = createSampleRecord();

  const invalidQuestionIds = [
    'PHY/01/Q1',               // Path traversal attempt with slashes
    '../secrets',              // Directory traversal
    'PHY 01 Q1',               // Spaces
    'PHY.01.Q1',               // Dots
    'PHY-01-Q1\0',             // Null byte
    'PHY-01-Q1#ref',           // Hash symbol
    'PHY%2F01',                // URL-encoded slash
    'PHY-01-🚀',               // Unicode
    '',                        // Empty string
  ];

  for (const badId of invalidQuestionIds) {
    const badSample = createSampleRecord({ questionId: badId });
    const saveRes = await repo.saveApproval(badSample);
    assert.equal(saveRes.ok, false, `saveApproval should reject bad questionId: "${badId}"`);
    if (!saveRes.ok) {
      assert.equal(saveRes.code, 'invalid_question_id');
    }

    const revokeRes = await repo.revokeApproval(badId, validSample.contentDigest, {
      revokedBy: 'uid-test',
      reason: 'test',
    });
    assert.equal(revokeRes.ok, false, `revokeApproval should reject bad questionId: "${badId}"`);
    if (!revokeRes.ok) {
      assert.equal(revokeRes.code, 'invalid_question_id');
    }

    const activeRes = await repo.getActiveApproval(badId);
    assert.equal(activeRes, null, `getActiveApproval should return null for bad questionId: "${badId}"`);

    const digestRes = await repo.getApprovalByDigest(badId, validSample.contentDigest);
    assert.equal(digestRes, null, `getApprovalByDigest should return null for bad questionId: "${badId}"`);

    const auditRes = await repo.getAuditHistory(badId);
    assert.deepEqual(auditRes, [], `getAuditHistory should return empty for bad questionId: "${badId}"`);
  }

  const invalidDigests = [
    '1111111111111111111111111111111111111111111111111111111111111111',          // Missing sha256: prefix
    'md5:11111111111111111111111111111111',                                       // Wrong algorithm
    'sha256:xyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyzx',      // Non-hex
    'sha256:1111',                                                                 // Too short
    'sha256:1111111111111111111111111111111111111111111111111111111111111111extra', // Too long
    '',                                                                            // Empty
  ];

  for (const badDigest of invalidDigests) {
    const badSample = createSampleRecord({ contentDigest: badDigest });
    const saveRes = await repo.saveApproval(badSample);
    assert.equal(saveRes.ok, false, `saveApproval should reject bad contentDigest: "${badDigest}"`);
    if (!saveRes.ok) {
      assert.equal(saveRes.code, 'invalid_content_digest');
    }

    const revokeRes = await repo.revokeApproval('PHY-01-Q1', badDigest, {
      revokedBy: 'uid-test',
      reason: 'test',
    });
    assert.equal(revokeRes.ok, false, `revokeApproval should reject bad contentDigest: "${badDigest}"`);
    if (!revokeRes.ok) {
      assert.equal(revokeRes.code, 'invalid_content_digest');
    }

    const byDigest = await repo.getApprovalByDigest('PHY-01-Q1', badDigest);
    assert.equal(byDigest, null, `getApprovalByDigest should return null for bad contentDigest: "${badDigest}"`);
  }
});

test('firestoreRepo: 12. Superseding lifecycle and revoking old version preserves newer active (AUD-03)', async () => {
  const db = new StrictFakeFirestore();
  const repo = new FirestoreApprovalRecordRepository(db);

  // 1. First approval works without expectedCurrentVersion
  const v1 = createSampleRecord({
    contentDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    contentVersion: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    reviewedAt: '2026-11-04T10:00:00.000Z',
  });
  const firstRes = await repo.saveApproval(v1);
  assert.equal(firstRes.ok, true);

  // 2. Superseding without expectedCurrentVersion fails with expected_version_required
  const v2 = createSampleRecord({
    contentDigest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    contentVersion: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    reviewedAt: '2026-11-04T12:00:00.000Z',
  });
  const noExpectedRes = await repo.saveApproval(v2);
  assert.equal(noExpectedRes.ok, false);
  if (!noExpectedRes.ok) {
    assert.equal(noExpectedRes.code, 'expected_version_required');
  }

  // 3. Superseding with wrong expectedCurrentVersion fails with concurrency_conflict
  const wrongExpectedRes = await repo.saveApproval(v2, {
    expectedCurrentVersion: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  });
  assert.equal(wrongExpectedRes.ok, false);
  if (!wrongExpectedRes.ok) {
    assert.equal(wrongExpectedRes.code, 'concurrency_conflict');
  }

  // 4. Superseding with correct expectedCurrentVersion succeeds
  const v2Res = await repo.saveApproval(v2, { expectedCurrentVersion: v1.contentDigest });
  assert.equal(v2Res.ok, true);

  // Active is now v2
  const activeBeforeRevoke = await repo.getActiveApproval(v1.questionId);
  assert.equal(activeBeforeRevoke?.contentDigest, v2.contentDigest);
  assert.equal(activeBeforeRevoke?.lifecycleStatus, 'approved');

  // 5. Revoking the OLD superseded version v1 MUST NOT clear the active v2 pointer!
  const revokeV1Res = await repo.revokeApproval(v1.questionId, v1.contentDigest, {
    revokedBy: 'uid-admin-01',
    reason: 'Retired older phrasing',
  });
  assert.equal(revokeV1Res.ok, true);

  // Active pointer must STILL be v2!
  const activeAfterRevoke = await repo.getActiveApproval(v1.questionId);
  assert.ok(activeAfterRevoke);
  assert.equal(activeAfterRevoke.contentDigest, v2.contentDigest);
  assert.equal(activeAfterRevoke.lifecycleStatus, 'approved');

  // V1 record itself is revoked
  const v1Status = await repo.getApprovalByDigest(v1.questionId, v1.contentDigest);
  assert.equal(v1Status?.lifecycleStatus, 'revoked');
});

test('firestoreRepo: 13. Paginated audit event retrieval (AUD-01)', async () => {
  const db = new StrictFakeFirestore();
  const repo = new FirestoreApprovalRecordRepository(db);

  // Create sequence of 4 events:
  // 1: v1 approved
  const v1 = createSampleRecord({
    contentDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    contentVersion: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    reviewedAt: '2026-11-04T10:00:00.000Z',
  });
  await repo.saveApproval(v1);

  // 2: v1 revoked
  await repo.revokeApproval(v1.questionId, v1.contentDigest, {
    revokedBy: 'uid-admin',
    reason: 'Correction needed',
  });

  // 3: v1 re-approved
  await repo.saveApproval(createSampleRecord({
    contentDigest: v1.contentDigest,
    contentVersion: v1.contentVersion,
    reviewedAt: '2026-11-04T12:00:00.000Z',
  }));

  // 4: v2 supersedes v1
  const v2 = createSampleRecord({
    contentDigest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    contentVersion: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    reviewedAt: '2026-11-04T14:00:00.000Z',
  });
  await repo.saveApproval(v2, { expectedCurrentVersion: v1.contentDigest });

  // Full history
  const full = await repo.getAuditHistory(v1.questionId);
  assert.equal(full.length, 5);
  assert.deepEqual(full.map((e) => e.sequenceNumber), [1, 2, 3, 4, 5]);

  // Paginated: limit 2
  const page1 = await repo.getAuditHistory(v1.questionId, { limit: 2 });
  assert.equal(page1.length, 2);
  assert.deepEqual(page1.map((e) => e.sequenceNumber), [1, 2]);

  // Paginated: offset 2, limit 2
  const page2 = await repo.getAuditHistory(v1.questionId, { offset: 2, limit: 2 });
  assert.equal(page2.length, 2);
  assert.deepEqual(page2.map((e) => e.sequenceNumber), [3, 4]);

  // Direction: desc
  const desc = await repo.getAuditHistory(v1.questionId, { direction: 'desc', limit: 2 });
  assert.equal(desc.length, 2);
  assert.deepEqual(desc.map((e) => e.sequenceNumber), [5, 4]);
});

test('memoryRepo: 14. MemoryApprovalRecordRepository conforms to hardening rules (validation, concurrency, pagination)', async () => {
  const repo = new MemoryApprovalRecordRepository();
  const sample = createSampleRecord();

  // 1. Validation rejection
  const badIdRes = await repo.saveApproval(createSampleRecord({ questionId: 'bad/id' }));
  assert.equal(badIdRes.ok, false);
  if (!badIdRes.ok) assert.equal(badIdRes.code, 'invalid_question_id');

  const badDigestRes = await repo.saveApproval(createSampleRecord({ contentDigest: 'invalid_sha' }));
  assert.equal(badDigestRes.ok, false);
  if (!badDigestRes.ok) assert.equal(badDigestRes.code, 'invalid_content_digest');

  // 2. Initial save (event 1: approved v1)
  const firstRes = await repo.saveApproval(sample);
  assert.equal(firstRes.ok, true);

  // 3. Supersede without expectedCurrentVersion fails with expected_version_required
  const v2 = createSampleRecord({
    contentDigest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    contentVersion: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    reviewedAt: '2026-11-04T15:00:00.000Z',
  });
  const unversionedRes = await repo.saveApproval(v2);
  assert.equal(unversionedRes.ok, false);
  if (!unversionedRes.ok) assert.equal(unversionedRes.code, 'expected_version_required');

  // 4. Supersede with correct version succeeds (event 2: superseded v1, event 3: approved v2)
  const v2Res = await repo.saveApproval(v2, { expectedCurrentVersion: sample.contentDigest });
  assert.equal(v2Res.ok, true);

  // 5. Revoking old version v1 does not clear active v2 (event 4: revoked v1)
  const revokeV1 = await repo.revokeApproval(sample.questionId, sample.contentDigest, {
    revokedBy: 'uid-admin',
    reason: 'archiving old version',
  });
  assert.equal(revokeV1.ok, true);
  const currentActive = await repo.getActiveApproval(sample.questionId);
  assert.equal(currentActive?.contentDigest, v2.contentDigest);

  // 6. Paginated audit history (total 4 events, newest is sequenceNumber 4)
  const page = await repo.getAuditHistory(sample.questionId, { limit: 1, direction: 'desc' });
  assert.equal(page.length, 1);
  assert.equal(page[0].sequenceNumber, 4);
});
