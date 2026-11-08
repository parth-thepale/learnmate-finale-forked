/**
 * Firestore Emulator Integration Tests for Content Approval Repository.
 *
 * Prerequisite:
 *   Firebase Emulator requires Java 21+ and a running Firestore emulator:
 *   npx --yes firebase-tools@15.34.2 emulators:exec --only firestore --project demo-learnmate-rules "tsx --test firestore-tests/firestoreApprovalRepository.emulator.test.ts"
 *
 * This integration test exercises real multi-document transactions across the wire against the Firestore emulator.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, getApps, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  FirestoreApprovalRecordRepository,
} from '../src/server/contentVerification/approvalRepository.ts';
import type { ServerApprovalRecord } from '../src/server/contentVerification/types.ts';
import type { QuotaFirestore } from '../src/server/quotaStore.ts';

const PROJECT_ID = 'demo-learnmate-rules';
let app: App;
let db: Firestore;
let repo: FirestoreApprovalRecordRepository;

function sampleRecord(overrides: Partial<ServerApprovalRecord> = {}): ServerApprovalRecord {
  return {
    schemaVersion: 2,
    reviewStatus: 'verified',
    questionId: 'PHY-EMU-T01',
    reviewerUid: 'uid-sme-physics-dr-sharma',
    reviewerId: 'sme-phys-dr-sharma',
    subject: 'physics',
    checkpointId: 'PHY-01-CP1',
    topicId: 'units_and_measurements',
    contentDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    contentVersion: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    reviewedAt: '2026-11-04T12:00:00.000Z',
    reviewNotes: 'Verified against NTA 2026 syllabus on emulator.',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
    signature: 'mock_emulator_signature',
    signingKeyId: 'kms-key-emu',
    signatureAlgorithm: 'RSASSA_PSS_SHA_256',
    lifecycleStatus: 'approved',
    ...overrides,
  };
}

before(() => {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const existing = getApps().find((a) => a.name === 'learnmate-emulator-test');
  app = existing || initializeApp({ projectId: PROJECT_ID }, 'learnmate-emulator-test');
  db = getFirestore(app);
  repo = new FirestoreApprovalRecordRepository(db as unknown as QuotaFirestore);
});

test('emulator: 1. Create and retrieve an approval document in real Firestore', async () => {
  const sample = sampleRecord({ questionId: 'PHY-EMU-T01' });
  const outcome = await repo.saveApproval(sample);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  assert.equal(outcome.isDuplicate, false);
  assert.equal(outcome.record.versionNumber, 1);

  const active = await repo.getActiveApproval(sample.questionId);
  assert.ok(active);
  assert.equal(active.contentDigest, sample.contentDigest);
  assert.equal(active.versionNumber, 1);

  const byDigest = await repo.getApprovalByDigest(sample.questionId, sample.contentDigest);
  assert.ok(byDigest);
  assert.equal(byDigest.contentDigest, sample.contentDigest);

  // Subcollection audit verification (AUD-01)
  const history = await repo.getAuditHistory(sample.questionId);
  assert.equal(history.length, 1);
  assert.equal(history[0].sequenceNumber, 1);
  assert.equal(history[0].questionId, sample.questionId);
  assert.equal(history[0].contentDigest, sample.contentDigest);
});

test('emulator: 2. Duplicate approval idempotency in real Firestore', async () => {
  const sample = sampleRecord({ questionId: 'PHY-EMU-T02' });
  const first = await repo.saveApproval(sample);
  assert.equal(first.ok, true);

  const duplicate = await repo.saveApproval(sample);
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;

  assert.equal(duplicate.isDuplicate, true);
  assert.equal(duplicate.record.contentDigest, sample.contentDigest);
  assert.equal(duplicate.record.versionNumber, 1);

  // Audit history length is not duplicated
  const history = await repo.getAuditHistory(sample.questionId);
  assert.equal(history.length, 1);
});

test('emulator: 3. Revocation and retrieval of revocation history in real Firestore', async () => {
  const sample = sampleRecord({ questionId: 'PHY-EMU-T03' });
  await repo.saveApproval(sample);

  const revoke = await repo.revokeApproval(sample.questionId, sample.contentDigest, {
    revokedBy: 'uid-sme-physics-dr-sharma',
    reason: 'Correction required on emulator test',
  });
  assert.equal(revoke.ok, true);
  if (!revoke.ok) return;
  assert.equal(revoke.record.lifecycleStatus, 'revoked');

  const active = await repo.getActiveApproval(sample.questionId);
  assert.equal(active, null);

  const byDigest = await repo.getApprovalByDigest(sample.questionId, sample.contentDigest);
  assert.equal(byDigest?.lifecycleStatus, 'revoked');

  const history = await repo.getAuditHistory(sample.questionId);
  assert.ok(history.some((e) => e.eventType === 'revoked'));
});

test('emulator: 4. Re-approval after revocation in real Firestore', async () => {
  const sample = sampleRecord({ questionId: 'PHY-EMU-T04' });
  await repo.saveApproval(sample);
  await repo.revokeApproval(sample.questionId, sample.contentDigest, {
    revokedBy: 'uid-sme-reviewer',
    reason: 'Temporary hold',
  });

  const reapproveSample = sampleRecord({
    questionId: 'PHY-EMU-T04',
    reviewedAt: '2026-11-04T15:00:00.000Z',
    reviewNotes: 'Hold lifted and re-approved',
  });
  const reapproved = await repo.saveApproval(reapproveSample);
  assert.equal(reapproved.ok, true);
  if (!reapproved.ok) return;
  assert.equal(reapproved.record.versionNumber, 2);

  const active = await repo.getActiveApproval(sample.questionId);
  assert.ok(active);
  assert.equal(active.versionNumber, 2);
});

test('emulator: 5. Superseding requires expectedCurrentVersion in real Firestore (AUD-03)', async () => {
  const qId = 'PHY-EMU-T05';
  const v1 = sampleRecord({
    questionId: qId,
    contentDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    contentVersion: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    reviewedAt: '2026-11-04T10:00:00.000Z',
  });
  await repo.saveApproval(v1);

  const v2 = sampleRecord({
    questionId: qId,
    contentDigest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    contentVersion: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    reviewedAt: '2026-11-04T16:00:00.000Z',
  });

  // Attempting to supersede without expectedCurrentVersion fails with expected_version_required
  const noExpected = await repo.saveApproval(v2);
  assert.equal(noExpected.ok, false);
  if (!noExpected.ok) {
    assert.equal(noExpected.code, 'expected_version_required');
  }

  // Superseding with correct expectedCurrentVersion succeeds
  const superseded = await repo.saveApproval(v2, { expectedCurrentVersion: v1.contentDigest });
  assert.equal(superseded.ok, true);
  if (!superseded.ok) return;
  assert.equal(superseded.record.versionNumber, 2);

  const active = await repo.getActiveApproval(qId);
  assert.equal(active?.contentDigest, v2.contentDigest);

  const oldDoc = await repo.getApprovalByDigest(qId, v1.contentDigest);
  assert.equal(oldDoc?.lifecycleStatus, 'superseded');
  assert.equal(oldDoc?.supersededBy, v2.contentDigest);
});

test('emulator: 6. Stale or conflicting version rejection in real Firestore', async () => {
  const qId = 'PHY-EMU-T06';
  const active = sampleRecord({
    questionId: qId,
    contentDigest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    reviewedAt: '2026-11-04T16:00:00.000Z',
  });
  await repo.saveApproval(active);

  const stale = sampleRecord({
    questionId: qId,
    contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    reviewedAt: '2026-11-04T08:00:00.000Z',
  });
  const staleRes = await repo.saveApproval(stale, { expectedCurrentVersion: active.contentDigest });
  assert.equal(staleRes.ok, false);
  if (!staleRes.ok) assert.equal(staleRes.code, 'stale_version_conflict');

  const conflictRes = await repo.saveApproval(
    sampleRecord({
      questionId: qId,
      contentDigest: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
      reviewedAt: '2026-11-04T18:00:00.000Z',
    }),
    { expectedCurrentVersion: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }
  );
  assert.equal(conflictRes.ok, false);
  if (!conflictRes.ok) assert.equal(conflictRes.code, 'concurrency_conflict');
});

test('emulator: 7. Two concurrent approvals for the same question in real Firestore', async () => {
  const sample = sampleRecord({ questionId: 'PHY-EMU-T07' });
  const [res1, res2] = await Promise.all([
    repo.saveApproval(sample),
    repo.saveApproval(sample),
  ]);

  assert.equal(res1.ok, true);
  assert.equal(res2.ok, true);
  const duplicates = [res1, res2].filter((r) => r.ok && r.isDuplicate);
  assert.equal(duplicates.length, 1);
});

test('emulator: 8. Concurrent approval and revocation in real Firestore', async () => {
  const qId = 'PHY-EMU-T08';
  const sampleA = sampleRecord({
    questionId: qId,
    contentDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    reviewedAt: '2026-11-04T10:00:00.000Z',
  });
  await repo.saveApproval(sampleA);

  const sampleB = sampleRecord({
    questionId: qId,
    contentDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    reviewedAt: '2026-11-04T12:00:00.000Z',
  });

  const [revRes, saveRes] = await Promise.all([
    repo.revokeApproval(sampleA.questionId, sampleA.contentDigest, {
      revokedBy: 'uid-admin-revoker',
      reason: 'Replacing with sampleB',
    }),
    repo.saveApproval(sampleB, { expectedCurrentVersion: sampleA.contentDigest }),
  ]);

  assert.equal(revRes.ok, true);
  assert.equal(saveRes.ok, true);
  const active = await repo.getActiveApproval(qId);
  assert.ok(active);
  assert.equal(active.contentDigest, sampleB.contentDigest);
});

test('emulator: 9. Persistence across repository/client re-instantiation in real Firestore', async () => {
  const sample = sampleRecord({ questionId: 'PHY-EMU-T09' });
  const client1 = new FirestoreApprovalRecordRepository(db as unknown as QuotaFirestore);
  await client1.saveApproval(sample);

  // Separate instance
  const client2 = new FirestoreApprovalRecordRepository(db as unknown as QuotaFirestore);
  const active = await client2.getActiveApproval(sample.questionId);
  assert.ok(active);
  assert.equal(active.contentDigest, sample.contentDigest);
});

test('emulator: 10. Failure behavior when Firestore is unavailable', async () => {
  const unavailableRepo = new FirestoreApprovalRecordRepository(null as unknown as QuotaFirestore);
  const res = await unavailableRepo.saveApproval(sampleRecord({ questionId: 'PHY-EMU-T10' }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'repository_unavailable');

  const revokeRes = await unavailableRepo.revokeApproval('q', 'd', { revokedBy: 'u', reason: 'r' });
  assert.equal(revokeRes.ok, false);
  if (!revokeRes.ok) assert.equal(revokeRes.code, 'repository_unavailable');
});

test('emulator: 11. Question ID validation prevents unsafe path traversal in real Firestore (AUD-02)', async () => {
  const badId = 'PHY/EMU/TRAVERSAL';
  const badSample = sampleRecord({ questionId: badId });

  const saveRes = await repo.saveApproval(badSample);
  assert.equal(saveRes.ok, false);
  if (!saveRes.ok) assert.equal(saveRes.code, 'invalid_question_id');

  const activeRes = await repo.getActiveApproval(badId);
  assert.equal(activeRes, null);
});

test('emulator: 12. Paginated subcollection audit retrieval in real Firestore (AUD-01)', async () => {
  const qId = 'PHY-EMU-AUDIT-PAGE';
  const v1 = sampleRecord({
    questionId: qId,
    contentDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    contentVersion: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    reviewedAt: '2026-11-04T10:00:00.000Z',
  });
  await repo.saveApproval(v1);

  await repo.revokeApproval(qId, v1.contentDigest, {
    revokedBy: 'uid-admin',
    reason: 'Temporary revoke',
  });

  const v2 = sampleRecord({
    questionId: qId,
    contentDigest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    contentVersion: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    reviewedAt: '2026-11-04T14:00:00.000Z',
  });
  await repo.saveApproval(v2);

  const page = await repo.getAuditHistory(qId, { limit: 2, direction: 'asc' });
  assert.equal(page.length, 2);
  assert.equal(page[0].sequenceNumber, 1);
  assert.equal(page[1].sequenceNumber, 2);
});
