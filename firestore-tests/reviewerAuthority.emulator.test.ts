/**
 * Real Firestore Emulator Integration Tests for Reviewer Authorization.
 *
 * Verifies:
 *  1. FirestoreReviewerRegistry UID lookup and runtime schema validation.
 *  2. Reviewer ID query with persistence-layer uniqueness enforcement (detecting duplicates).
 *  3. Genuinely missing reviewer returns null (not error).
 *  4. Malformed profile throws RegistryLookupError.
 *  5. Dynamic permission and status mutations are immediately reflected without caching.
 *  6. Revocation TOCTOU race closure: reviewer revocation between initial authorization and
 *     approval persistence aborts the approval transaction with code 'reviewer_authorization_revoked'.
 *  7. Durable audit writes in `reviewerAuthorizationAudit` with non-secret metadata.
 *  8. Immutability of audit history through repository abstraction.
 *  9. Complete commit-time revocation rejection matrix for the six canonical codes.
 *
 * Execution:
 *   $env:JAVA_HOME = "C:\Program Files\Java\jdk-26.0.2"; $env:PATH = "C:\Program Files\Java\jdk-26.0.2\bin;$env:PATH";
 *   npx --yes firebase-tools@15.34.2 emulators:exec --only firestore --project demo-learnmate-rules "tsx --test firestore-tests/reviewerAuthority.emulator.test.ts"
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, getApps, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  FirestoreReviewerRegistry,
  FirestoreReviewerAuditRepository,
  RegistryLookupError,
  ServerReviewerAuthority,
  TRUSTED_REVIEWER_COLLECTION,
  REVIEWER_AUDIT_COLLECTION,
} from '../src/server/contentVerification/reviewerAuthority.ts';
import {
  FirestoreApprovalRecordRepository,
} from '../src/server/contentVerification/approvalRepository.ts';
import {
  approveQuestionContent,
  revokeQuestionApproval,
} from '../src/server/contentVerification/contentApprovalService.ts';
import {
  MemoryStagedContentRepository,
} from '../src/server/contentVerification/contentRepository.ts';
import {
  LocalAsymmetricTestSigningService,
} from '../src/server/contentVerification/signingService.ts';
import type {
  AuthorizedReviewerProfile,
  ContentApprovalRequest,
  ContentRevocationRequest,
  ReviewerAuthorizationAuditRecord,
  ReviewerCommitFailureCode,
  ServerApprovalRecord,
  StagedQuestionRecord,
} from '../src/server/contentVerification/types.ts';
import type { AssessmentQuestion } from '../src/features/roadmaps/types/checkpoint.types.ts';
import type { QuotaFirestore } from '../src/server/quotaStore.ts';

const PROJECT_ID = 'demo-learnmate-rules';
let app: App;
let db: Firestore;
let registry: FirestoreReviewerRegistry;
let auditRepo: FirestoreReviewerAuditRepository;
let approvalRepo: FirestoreApprovalRecordRepository;
let authority: ServerReviewerAuthority;

before(() => {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const existing = getApps().find((a) => a.name === 'learnmate-reviewer-emulator-test');
  app = existing || initializeApp({ projectId: PROJECT_ID }, 'learnmate-reviewer-emulator-test');
  db = getFirestore(app);
  registry = new FirestoreReviewerRegistry(db as unknown as QuotaFirestore);
  auditRepo = new FirestoreReviewerAuditRepository(db as unknown as QuotaFirestore);
  approvalRepo = new FirestoreApprovalRecordRepository(db as unknown as QuotaFirestore);
  authority = new ServerReviewerAuthority(registry, { auditRepository: auditRepo });
});

function validProfile(overrides: Partial<AuthorizedReviewerProfile> = {}): AuthorizedReviewerProfile {
  return {
    uid: 'uid-emu-reviewer-01',
    reviewerId: 'sme-phys-dr-sharma',
    displayName: 'Dr. Sharma',
    email: 'sharma@physics.learnmate.org',
    role: 'senior_reviewer',
    status: 'active',
    registryVersion: '2026.1',
    recordVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin-council',
    permissions: [
      {
        subject: 'physics',
        active: true,
        grantedAt: '2026-01-01T00:00:00.000Z',
        grantedBy: 'admin-council',
        canApprove: true,
        canRevoke: true,
      },
    ],
    ...overrides,
  };
}

test('emulator: 1. UID lookup and profile retrieval from real Firestore', async () => {
  const profile = validProfile({ uid: 'uid-emu-lookup-01', reviewerId: 'sme-phys-dr-lookup' });
  await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(profile.uid).set(profile);

  const found = await registry.getReviewerByUid(profile.uid);
  assert.ok(found);
  assert.equal(found.uid, profile.uid);
  assert.equal(found.reviewerId, 'sme-phys-dr-lookup');
  assert.equal(found.status, 'active');
  assert.equal(found.permissions[0].canApprove, true);
});

test('emulator: 2. Reviewer ID query in real Firestore', async () => {
  const profile = validProfile({ uid: 'uid-emu-byid-01', reviewerId: 'sme-chem-dr-byid' });
  await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(profile.uid).set(profile);

  const found = await registry.getReviewerById('sme-chem-dr-byid');
  assert.ok(found);
  assert.equal(found.uid, profile.uid);
  assert.equal(found.reviewerId, 'sme-chem-dr-byid');
});

test('emulator: 3. Missing reviewer returns null without error', async () => {
  const byUid = await registry.getReviewerByUid('uid-definitely-nonexistent-999');
  assert.equal(byUid, null);

  const byId = await registry.getReviewerById('sme-math-dr-nonexistent-999');
  assert.equal(byId, null);
});

test('emulator: 4. Malformed reviewer profile throws RegistryLookupError', async () => {
  // Store a malformed profile missing reviewerId and permissions in Firestore
  const malformedUid = 'uid-emu-malformed-01';
  await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(malformedUid).set({
    uid: malformedUid,
    displayName: 'Broken Profile',
    status: 'active',
    // Missing reviewerId, missing permissions
  });

  await assert.rejects(
    async () => {
      await registry.getReviewerByUid(malformedUid);
    },
    (err: unknown) => {
      assert.ok(err instanceof RegistryLookupError);
      assert.match((err as Error).message, /Malformed reviewer profile/);
      return true;
    }
  );
});

test('emulator: 5. Duplicate reviewerIds rejected at persistence layer', async () => {
  const duplicateId = 'sme-phys-dr-duplicate';
  const doc1 = validProfile({ uid: 'uid-emu-dup-01', reviewerId: duplicateId });
  const doc2 = validProfile({ uid: 'uid-emu-dup-02', reviewerId: duplicateId });

  await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(doc1.uid).set(doc1);
  await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(doc2.uid).set(doc2);

  await assert.rejects(
    async () => {
      await registry.getReviewerById(duplicateId);
    },
    (err: unknown) => {
      assert.ok(err instanceof RegistryLookupError);
      assert.match((err as Error).message, /duplicate reviewerId/);
      return true;
    }
  );
});

test('emulator: 6. Dynamic permissions changes take effect immediately without caching', async () => {
  const testUid = 'uid-emu-dyn-perm-01';
  const profile = validProfile({
    uid: testUid,
    reviewerId: 'sme-phys-dr-dyn',
    permissions: [
      {
        subject: 'physics',
        active: true,
        grantedAt: '2026-01-01T00:00:00.000Z',
        grantedBy: 'admin',
        canApprove: true,
        canRevoke: false,
      },
    ],
  });
  await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(testUid).set(profile);

  // Request 1: canApprove is true -> authorized
  const outcome1 = await authority.authorizeReviewer(testUid, 'physics', { action: 'approve' });
  assert.equal(outcome1.ok, true);

  // Dynamic write: deactivate physics permission
  await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(testUid).update({
    permissions: [
      {
        subject: 'physics',
        active: false,
        grantedAt: '2026-01-01T00:00:00.000Z',
        grantedBy: 'admin',
        canApprove: true,
        canRevoke: false,
      },
    ],
  });

  // Request 2: immediate re-check fails closed
  const outcome2 = await authority.authorizeReviewer(testUid, 'physics', { action: 'approve' });
  assert.equal(outcome2.ok, false);
  if (!outcome2.ok) {
    assert.equal(outcome2.code, 'subject_unauthorized');
  }
});

test('emulator: 7. TOCTOU Revocation Race: reviewer revocation during approval aborts transaction', async () => {
  const raceUid = 'uid-emu-race-01';
  const profile = validProfile({
    uid: raceUid,
    reviewerId: 'sme-phys-dr-race',
    status: 'active',
    recordVersion: 1,
  });
  await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(raceUid).set(profile);

  // 1. Initial authorization succeeds
  const authOutcome = await authority.authorizeReviewer(raceUid, 'physics', { action: 'approve' });
  assert.equal(authOutcome.ok, true);
  if (!authOutcome.ok) return;

  // 2. Concurrently (e.g. while signing is underway), an admin revokes the reviewer in Firestore
  await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(raceUid).update({
    status: 'revoked',
    revokedAt: new Date().toISOString(),
    revokedBy: 'admin-compliance',
    recordVersion: 2,
  });

  // 3. Approval persistence transaction executes with expectedReviewer check
  const sampleApproval: ServerApprovalRecord = {
    schemaVersion: 2,
    reviewStatus: 'verified',
    questionId: 'PHY-EMU-RACE-01',
    reviewerUid: raceUid,
    reviewerId: 'sme-phys-dr-race',
    subject: 'physics',
    checkpointId: 'PHY-01-CP1',
    topicId: 'units',
    contentDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    contentVersion: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    reviewedAt: new Date().toISOString(),
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
    lifecycleStatus: 'approved',
  };

  const saveResult = await approvalRepo.saveApproval(sampleApproval, {
    expectedReviewer: {
      uid: raceUid,
      reviewerId: 'sme-phys-dr-race',
      subject: 'physics',
      expectedRecordVersion: 1,
    },
  });

  // Transaction MUST abort with reviewer_authorization_revoked
  assert.equal(saveResult.ok, false);
  if (!saveResult.ok) {
    assert.equal(saveResult.code, 'reviewer_authorization_revoked');
    assert.match(saveResult.error, /required "active"/);
  }

  // Ensure NO active approval record was created in Firestore
  const activeRecord = await approvalRepo.getActiveApproval('PHY-EMU-RACE-01');
  assert.equal(activeRecord, null);
});

test('emulator: 8. Durable authorization audit records persist in reviewerAuthorizationAudit', async () => {
  const auditEvent: ReviewerAuthorizationAuditRecord = {
    auditId: 'rev_audit_emu_000001_test',
    callerUid: 'uid-emu-caller-01',
    resolvedReviewerId: 'sme-phys-dr-sharma',
    action: 'approve',
    requestedSubject: 'physics',
    requestId: 'PHY-EMU-AUD-01',
    decision: 'authorized',
    code: 'authorized',
    allowed: true,
    timestamp: new Date().toISOString(),
    registryVersion: '2026.1',
    reason: 'Authorized reviewer confirmed.',
  };

  await auditRepo.recordDecision(auditEvent);

  // Directly verify document in Firestore Emulator collection `reviewerAuthorizationAudit`
  const docSnap = await db.collection(REVIEWER_AUDIT_COLLECTION).doc(auditEvent.auditId).get();
  assert.ok(docSnap.exists);
  const data = docSnap.data();
  assert.ok(data);
  assert.equal(data.auditId, auditEvent.auditId);
  assert.equal(data.callerUid, 'uid-emu-caller-01');
  assert.equal(data.resolvedReviewerId, 'sme-phys-dr-sharma');
  assert.equal(data.decision, 'authorized');
  assert.equal(data.docType, 'reviewer_authorization_audit_event');
});

test('emulator: 9. ReviewerAuditRepository is append-only and does not expose mutation methods', () => {
  // Assert at type/runtime level that no delete or clear methods exist on auditRepo
  const repoAny = auditRepo as unknown as Record<string, unknown>;
  assert.equal(repoAny.deleteDecision, undefined);
  assert.equal(repoAny.clearAudit, undefined);
  assert.equal(repoAny.truncate, undefined);
  assert.equal(repoAny.updateDecision, undefined);
  assert.equal(typeof auditRepo.recordDecision, 'function');
  assert.equal(typeof auditRepo.getAuditEvents, 'function');
});

test('emulator: 10. End-to-end TOCTOU revocation produces durable denied audit event in real Firestore', async () => {
  const testUid = 'uid-emu-toctou-01';
  const reviewerId = 'sme-phys-dr-toctou';
  const profile = validProfile({
    uid: testUid,
    reviewerId,
    status: 'active',
    recordVersion: 1,
  });
  await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(testUid).set(profile);

  const question: AssessmentQuestion = {
    id: 'PHY-EMU-TOCTOU-01',
    type: 'mcq',
    topicId: 'physics.units-and-measurements.planck-constant',
    topicLabel: 'Planck Constant',
    difficulty: 'easy',
    stem: 'What are the dimensions of Planck constant (h)?',
    options: ['[M L^2 T^-1]', '[M L T^-1]', '[M L^2 T^-2]', '[M L^-1 T^-2]'],
    correctOptionIndex: 0,
    explanation: 'h = [M L^2 T^-1]',
  };
  const stagedRecord: StagedQuestionRecord = {
    question,
    checkpointId: 'PHY-01-CP1',
    subject: 'physics',
    topicId: question.topicId,
    stageStatus: 'staged',
    stagedAt: '2026-11-01T00:00:00.000Z',
  };

  const contentRepo = new MemoryStagedContentRepository([stagedRecord]);
  const signingService = new LocalAsymmetricTestSigningService();

  // Intercept saveApproval to revoke the reviewer in real Firestore between authorization and commit
  const origSaveApproval = approvalRepo.saveApproval.bind(approvalRepo);
  const interceptedApprovalRepo = Object.create(approvalRepo);
  interceptedApprovalRepo.saveApproval = async (record: any, options: any) => {
    // Revoke the reviewer document in Firestore before the transaction commit
    await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(testUid).update({
      status: 'revoked',
      recordVersion: 2,
      revokedAt: new Date().toISOString(),
    });
    return origSaveApproval(record, options);
  };

  const req: ContentApprovalRequest = {
    questionId: 'PHY-EMU-TOCTOU-01',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  const outcome = await approveQuestionContent(
    req,
    { uid: testUid },
    authority,
    contentRepo,
    interceptedApprovalRepo,
    signingService
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 403);
    assert.equal(outcome.code, 'reviewer_authorization_revoked');
  }

  // Directly query real Firestore `reviewerAuthorizationAudit`
  const snap = await db
    .collection(REVIEWER_AUDIT_COLLECTION)
    .where('questionId', '==', 'PHY-EMU-TOCTOU-01')
    .get();

  assert.equal(snap.docs.length, 2);
  const events = snap.docs.map((d) => d.data());

  const initialEvent = events.find((e) => e.decision === 'authorized');
  assert.ok(initialEvent);
  assert.equal(initialEvent.callerUid, testUid);
  assert.equal(initialEvent.resolvedReviewerId, reviewerId);
  assert.equal(initialEvent.action, 'approve');
  assert.equal(initialEvent.allowed, true);
  assert.equal(initialEvent.questionId, 'PHY-EMU-TOCTOU-01');

  const commitDeniedEvent = events.find((e) => e.decision === 'denied');
  assert.ok(commitDeniedEvent);
  assert.equal(commitDeniedEvent.callerUid, testUid);
  assert.equal(commitDeniedEvent.resolvedReviewerId, reviewerId);
  assert.equal(commitDeniedEvent.action, 'approve');
  assert.equal(commitDeniedEvent.code, 'reviewer_authorization_revoked');
  assert.equal(commitDeniedEvent.allowed, false);
  assert.equal(commitDeniedEvent.questionId, 'PHY-EMU-TOCTOU-01');
  assert.equal(commitDeniedEvent.requestId, initialEvent.requestId);
  assert.notEqual(commitDeniedEvent.requestId, 'PHY-EMU-TOCTOU-01');
  assert.match(commitDeniedEvent.reason || '', /required "active"/);
});

test('emulator: 11. Revocation flow commit-time rejection persists durable denied event in real Firestore', async () => {
  const testUid = 'uid-emu-toctou-02';
  const reviewerId = 'sme-phys-dr-toctou2';
  const profile = validProfile({
    uid: testUid,
    reviewerId,
    status: 'active',
    recordVersion: 1,
  });
  await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(testUid).set(profile);

  const question: AssessmentQuestion = {
    id: 'PHY-EMU-TOCTOU-02',
    type: 'mcq',
    topicId: 'physics.units-and-measurements.planck-constant',
    topicLabel: 'Planck Constant',
    difficulty: 'easy',
    stem: 'What are the dimensions of Planck constant (h)?',
    options: ['[M L^2 T^-1]', '[M L T^-1]', '[M L^2 T^-2]', '[M L^-1 T^-2]'],
    correctOptionIndex: 0,
    explanation: 'h = [M L^2 T^-1]',
  };
  const stagedRecord: StagedQuestionRecord = {
    question,
    checkpointId: 'PHY-01-CP1',
    subject: 'physics',
    topicId: question.topicId,
    stageStatus: 'staged',
    stagedAt: '2026-11-01T00:00:00.000Z',
  };

  const contentRepo = new MemoryStagedContentRepository([stagedRecord]);
  const signingService = new LocalAsymmetricTestSigningService();

  // First approve successfully
  const approveReq: ContentApprovalRequest = {
    questionId: 'PHY-EMU-TOCTOU-02',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };
  const approveRes = await approveQuestionContent(
    approveReq,
    { uid: testUid },
    authority,
    contentRepo,
    approvalRepo,
    signingService
  );
  assert.equal(approveRes.ok, true);
  if (!approveRes.ok) return;

  // Now revoke with interceptor that removes canRevoke before commit
  const origRevoke = approvalRepo.revokeApproval.bind(approvalRepo);
  const interceptedApprovalRepo = Object.create(approvalRepo);
  interceptedApprovalRepo.revokeApproval = async (qId: string, digest: string, rev: any, options: any) => {
    await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(testUid).update({
      permissions: [
        {
          subject: 'physics',
          active: true,
          grantedAt: '2026-01-01T00:00:00.000Z',
          grantedBy: 'admin',
          canApprove: true,
          canRevoke: false,
        },
      ],
      recordVersion: 2,
    });
    return origRevoke(qId, digest, rev, options);
  };

  const revokeReq: ContentRevocationRequest = {
    questionId: 'PHY-EMU-TOCTOU-02',
    contentDigest: approveRes.approvalRecord.contentDigest,
    reason: 'Testing revoke commit TOCTOU in emulator',
  };

  const revokeRes = await revokeQuestionApproval(
    revokeReq,
    { uid: testUid },
    authority,
    interceptedApprovalRepo
  );

  assert.equal(revokeRes.ok, false);
  if (!revokeRes.ok) {
    assert.equal(revokeRes.status, 403);
    assert.equal(revokeRes.code, 'reviewer_permission_denied');
  }

  // Directly check real Firestore `reviewerAuthorizationAudit` for revoke events
  const snap = await db
    .collection(REVIEWER_AUDIT_COLLECTION)
    .where('questionId', '==', 'PHY-EMU-TOCTOU-02')
    .where('action', '==', 'revoke')
    .get();

  assert.equal(snap.docs.length, 2);
  const events = snap.docs.map((d) => d.data());

  const initRevoke = events.find((e) => e.decision === 'authorized');
  assert.ok(initRevoke);
  assert.equal(initRevoke.action, 'revoke');
  assert.equal(initRevoke.questionId, 'PHY-EMU-TOCTOU-02');

  const commitRevoke = events.find((e) => e.decision === 'denied');
  assert.ok(commitRevoke);
  assert.equal(commitRevoke.action, 'revoke');
  assert.equal(commitRevoke.code, 'reviewer_permission_denied');
  assert.equal(commitRevoke.allowed, false);
  assert.equal(commitRevoke.questionId, 'PHY-EMU-TOCTOU-02');
  assert.equal(commitRevoke.requestId, initRevoke.requestId);
  assert.notEqual(commitRevoke.requestId, 'PHY-EMU-TOCTOU-02');
});

test('emulator: 12. Real overwrite rejection test: second write fails with ALREADY_EXISTS and original doc is untouched', async () => {
  const auditId = `rev_audit_overwrite_${Date.now()}`;
  const originalRecord: ReviewerAuthorizationAuditRecord = {
    auditId,
    callerUid: 'uid-emu-orig-reviewer',
    resolvedReviewerId: 'sme-phys-dr-sharma',
    action: 'approve',
    requestedSubject: 'physics',
    requestId: 'req-orig-uuid-12345',
    questionId: 'PHY-OVERWRITE-TEST-01',
    decision: 'authorized',
    code: 'authorized',
    allowed: true,
    timestamp: '2026-11-05T00:00:00.000Z',
    registryVersion: '2026.1',
    reason: 'Original immutable audit record',
  };

  // 1. Write an audit document with a known ID.
  await auditRepo.recordDecision(originalRecord);

  // 2. Read and preserve its contents.
  const snap1 = await db.collection(REVIEWER_AUDIT_COLLECTION).doc(auditId).get();
  assert.ok(snap1.exists, 'Original document must exist after initial write');
  const preservedData = snap1.data()!;
  assert.equal(preservedData.auditId, auditId);
  assert.equal(preservedData.callerUid, 'uid-emu-orig-reviewer');
  assert.equal(preservedData.resolvedReviewerId, 'sme-phys-dr-sharma');
  assert.equal(preservedData.action, 'approve');
  assert.equal(preservedData.requestedSubject, 'physics');
  assert.equal(preservedData.requestId, 'req-orig-uuid-12345');
  assert.equal(preservedData.questionId, 'PHY-OVERWRITE-TEST-01');
  assert.equal(preservedData.decision, 'authorized');
  assert.equal(preservedData.code, 'authorized');
  assert.equal(preservedData.allowed, true);
  assert.equal(preservedData.timestamp, '2026-11-05T00:00:00.000Z');
  assert.equal(preservedData.registryVersion, '2026.1');
  assert.equal(preservedData.reason, 'Original immutable audit record');

  // 3. Attempt a second write with the same ID and modified contents.
  const modifiedRecord: ReviewerAuthorizationAuditRecord = {
    auditId,
    callerUid: 'uid-emu-attacker-tamper',
    resolvedReviewerId: 'sme-phys-dr-tamper',
    action: 'approve',
    requestedSubject: 'physics',
    requestId: 'req-tamper-uuid-67890',
    questionId: 'PHY-OVERWRITE-TEST-01',
    decision: 'denied',
    code: 'reviewer_permission_denied',
    allowed: false,
    timestamp: '2026-11-05T01:00:00.000Z',
    registryVersion: '2026.1',
    reason: 'Malicious attempt to overwrite audit history',
  };

  // 4. Assert ALREADY_EXISTS.
  await assert.rejects(
    async () => {
      await auditRepo.recordDecision(modifiedRecord);
    },
    (err: any) => {
      const codeMatches =
        err?.code === 'ALREADY_EXISTS' ||
        err?.code === 6 ||
        err?.originalCode === 6 ||
        err?.originalCode === 'ALREADY_EXISTS';
      const messageMatches = typeof err?.message === 'string' && err.message.includes('ALREADY_EXISTS');
      assert.ok(
        codeMatches || messageMatches,
        `Expected error indicating ALREADY_EXISTS, but received code "${err?.code}" with message: "${err?.message}"`
      );
      return true;
    }
  );

  // 5. Read the original document again.
  const snap2 = await db.collection(REVIEWER_AUDIT_COLLECTION).doc(auditId).get();
  assert.ok(snap2.exists, 'Document must still exist');
  const reReadData = snap2.data()!;

  // 6. Assert every relevant original field remains unchanged.
  assert.equal(reReadData.auditId, preservedData.auditId);
  assert.equal(reReadData.callerUid, preservedData.callerUid);
  assert.equal(reReadData.resolvedReviewerId, preservedData.resolvedReviewerId);
  assert.equal(reReadData.action, preservedData.action);
  assert.equal(reReadData.requestedSubject, preservedData.requestedSubject);
  assert.equal(reReadData.requestId, preservedData.requestId);
  assert.equal(reReadData.questionId, preservedData.questionId);
  assert.equal(reReadData.decision, preservedData.decision);
  assert.equal(reReadData.code, preservedData.code);
  assert.equal(reReadData.allowed, preservedData.allowed);
  assert.equal(reReadData.timestamp, preservedData.timestamp);
  assert.equal(reReadData.registryVersion, preservedData.registryVersion);
  assert.equal(reReadData.reason, preservedData.reason);
  assert.equal(reReadData.docType, preservedData.docType);
});

test('emulator: 13. Parameterized commit-time denial tests for the six canonical failure codes', async () => {
  const canonicalFailureCases: Array<{
    code: ReviewerCommitFailureCode;
    mutateReviewer: (uid: string) => Promise<void>;
  }> = [
    {
      code: 'reviewer_authorization_revoked',
      mutateReviewer: async (uid) => {
        await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(uid).update({
          status: 'revoked',
          recordVersion: 2,
        });
      },
    },
    {
      code: 'reviewer_permission_denied',
      mutateReviewer: async (uid) => {
        await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(uid).update({
          permissions: [
            {
              subject: 'physics',
              active: true,
              grantedAt: '2026-01-01T00:00:00.000Z',
              grantedBy: 'admin',
              canApprove: false,
              canRevoke: true,
            },
          ],
          recordVersion: 2,
        });
      },
    },
    {
      code: 'reviewer_subject_unauthorized',
      mutateReviewer: async (uid) => {
        await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(uid).update({
          permissions: [
            {
              subject: 'physics',
              active: false,
              grantedAt: '2026-01-01T00:00:00.000Z',
              grantedBy: 'admin',
              canApprove: true,
              canRevoke: true,
            },
          ],
          recordVersion: 2,
        });
      },
    },
    {
      code: 'reviewer_not_found',
      mutateReviewer: async (uid) => {
        await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(uid).delete();
      },
    },
    {
      code: 'reviewer_uid_mismatch',
      mutateReviewer: async (uid) => {
        await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(uid).update({
          uid: `${uid}-mismatched-uid`,
          recordVersion: 2,
        });
      },
    },
    {
      code: 'reviewer_id_mismatch',
      mutateReviewer: async (uid) => {
        await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(uid).update({
          reviewerId: 'sme-phys-dr-mismatched-id',
          recordVersion: 2,
        });
      },
    },
  ];

  for (const { code, mutateReviewer } of canonicalFailureCases) {
    const testUid = `uid-emu-param-${code.replace(/_/g, '-')}`;
    const reviewerId = `sme-phys-dr-${code.slice(0, 12).replace(/_/g, '-')}`;
    const questionId = `PHY-EMU-PARAM-${code.toUpperCase().replace(/_/g, '-')}`;

    // Seed reviewer profile into Firestore Emulator
    const profile = validProfile({
      uid: testUid,
      reviewerId,
      status: 'active',
      recordVersion: 1,
      permissions: [
        {
          subject: 'physics',
          active: true,
          grantedAt: '2026-01-01T00:00:00.000Z',
          grantedBy: 'admin',
          canApprove: true,
          canRevoke: true,
        },
      ],
    });
    await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(testUid).set(profile);

    const question: AssessmentQuestion = {
      id: questionId,
      type: 'mcq',
      topicId: 'physics.units-measurements.dimensional-analysis',
      topicLabel: 'Dimensional Analysis',
      difficulty: 'medium',
      stem: `Dimensional equation stem for test case ${code}`,
      options: ['[M L^2 T^-1]', '[M L T^-1]', '[M L^2 T^-2]', '[M L^-1 T^-2]'],
      correctOptionIndex: 0,
      explanation: 'Dimensional correctness confirmed.',
    };

    const stagedRecord: StagedQuestionRecord = {
      question,
      checkpointId: 'PHY-01-CP1',
      subject: 'physics',
      topicId: question.topicId,
      stageStatus: 'staged',
      stagedAt: '2026-11-01T00:00:00.000Z',
    };

    const contentRepo = new MemoryStagedContentRepository([stagedRecord]);
    const signingService = new LocalAsymmetricTestSigningService();

    // Create intercepted approval repo that triggers the specific commit failure
    const origSaveApproval = approvalRepo.saveApproval.bind(approvalRepo);
    const interceptedApprovalRepo = Object.create(approvalRepo);
    interceptedApprovalRepo.saveApproval = async (record: any, options: any) => {
      await mutateReviewer(testUid);
      return origSaveApproval(record, options);
    };

    const approvalRequest: ContentApprovalRequest = {
      questionId,
      checkpointId: 'PHY-01-CP1',
      mathematicalCheckConfirmed: true,
      pedagogicalReviewConfirmed: true,
    };

    // Execute approval flow
    const outcome = await approveQuestionContent(
      approvalRequest,
      { uid: testUid },
      authority,
      contentRepo,
      interceptedApprovalRepo,
      signingService
    );

    // 1. Assert actual returned failure code
    assert.equal(outcome.ok, false, `Expected commit check to fail for code "${code}"`);
    if (!outcome.ok) {
      assert.equal(outcome.status, 403, `Status code must be 403 for "${code}"`);
      assert.equal(outcome.code, code, `Returned code must match expected canonical failure code "${code}"`);
    }

    // Directly query Firestore Emulator collection reviewerAuthorizationAudit
    const snap = await db
      .collection(REVIEWER_AUDIT_COLLECTION)
      .where('questionId', '==', questionId)
      .get();

    // 2. Assert exactly the expected events exist for that attempt
    assert.equal(snap.docs.length, 2, `Exactly 2 audit events expected for attempt on question "${questionId}"`);
    const events = snap.docs.map((d) => d.data());

    // 3. Assert initial authorization audit event exists
    const initialEvent = events.find((e) => e.decision === 'authorized');
    assert.ok(initialEvent, `Initial authorization audit event must exist for "${code}"`);
    assert.equal(initialEvent.allowed, true, 'Initial event must have allowed=true');
    assert.equal(initialEvent.code, 'authorized', 'Initial event code must be "authorized"');
    assert.equal(initialEvent.action, 'approve', 'Initial event action must be "approve"');
    assert.equal(initialEvent.callerUid, testUid);
    assert.equal(initialEvent.resolvedReviewerId, reviewerId);
    assert.equal(initialEvent.questionId, questionId, 'Initial event must contain the correct questionId');

    // 4. Assert compensating denial event exists
    const compensatingDenialEvent = events.find((e) => e.decision === 'denied');
    assert.ok(compensatingDenialEvent, `Compensating denial event must exist for "${code}"`);
    assert.equal(compensatingDenialEvent.allowed, false, 'The second event is denied and has allowed=false');
    assert.equal(compensatingDenialEvent.code, code, `Compensating denial code must match canonical failure code "${code}"`);
    assert.equal(compensatingDenialEvent.action, 'approve');
    assert.equal(compensatingDenialEvent.callerUid, testUid);
    assert.equal(compensatingDenialEvent.resolvedReviewerId, reviewerId);
    assert.equal(compensatingDenialEvent.questionId, questionId, 'Compensating denial event must contain the correct questionId');

    // 5. Assert both events share the same requestId
    assert.ok(initialEvent.requestId, 'Initial event must have a non-empty requestId');
    assert.equal(initialEvent.requestId, compensatingDenialEvent.requestId, 'Both events must share the same requestId');
    assert.notEqual(initialEvent.requestId, questionId, 'requestId must be a unique attempt UUID, not questionId');
    assert.match(initialEvent.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  }
});

test('emulator: 14. Repeated attempts on the same question receive different request IDs', async () => {
  const testUid = 'uid-emu-repeat-01';
  const reviewerId = 'sme-phys-dr-repeat';
  const questionId = 'PHY-EMU-REPEAT-01';

  const profile = validProfile({
    uid: testUid,
    reviewerId,
    status: 'active',
  });
  await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(testUid).set(profile);

  const question: AssessmentQuestion = {
    id: questionId,
    type: 'mcq',
    topicId: 'physics.units-measurements.dimensional-analysis',
    topicLabel: 'Dimensional Analysis',
    difficulty: 'easy',
    stem: 'Repeat attempt stem',
    options: ['[M L^2 T^-1]', '[M L T^-1]', '[M L^2 T^-2]', '[M L^-1 T^-2]'],
    correctOptionIndex: 0,
    explanation: 'Repeat attempt explanation.',
  };
  const stagedRecord: StagedQuestionRecord = {
    question,
    checkpointId: 'PHY-01-CP1',
    subject: 'physics',
    topicId: question.topicId,
    stageStatus: 'staged',
    stagedAt: '2026-11-01T00:00:00.000Z',
  };
  const contentRepo = new MemoryStagedContentRepository([stagedRecord]);
  const signingService = new LocalAsymmetricTestSigningService();

  const req: ContentApprovalRequest = {
    questionId,
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  const outcome1 = await approveQuestionContent(
    req,
    { uid: testUid },
    authority,
    contentRepo,
    approvalRepo,
    signingService
  );
  assert.equal(outcome1.ok, true);

  const outcome2 = await approveQuestionContent(
    req,
    { uid: testUid },
    authority,
    contentRepo,
    approvalRepo,
    signingService
  );
  assert.equal(outcome2.ok, true);

  const snap = await db.collection(REVIEWER_AUDIT_COLLECTION).where('questionId', '==', questionId).get();
  assert.equal(snap.docs.length, 2);
  const events = snap.docs.map((d) => d.data());

  assert.equal(events[0].questionId, questionId);
  assert.equal(events[1].questionId, questionId);
  assert.notEqual(events[0].requestId, events[1].requestId, 'Repeated attempts on same question must receive different request IDs');
  assert.match(events[0].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.match(events[1].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

test('emulator: 15. Parameterized commit-time denial tests for the six canonical failure codes in revokeQuestionApproval', async () => {
  const canonicalFailureCases: Array<{
    code: ReviewerCommitFailureCode;
    mutateReviewer: (uid: string) => Promise<void>;
  }> = [
    {
      code: 'reviewer_authorization_revoked',
      mutateReviewer: async (uid) => {
        await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(uid).update({
          status: 'revoked',
          recordVersion: 2,
        });
      },
    },
    {
      code: 'reviewer_permission_denied',
      mutateReviewer: async (uid) => {
        await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(uid).update({
          permissions: [
            {
              subject: 'physics',
              active: true,
              grantedAt: '2026-01-01T00:00:00.000Z',
              grantedBy: 'admin',
              canApprove: true,
              canRevoke: false,
            },
          ],
          recordVersion: 2,
        });
      },
    },
    {
      code: 'reviewer_subject_unauthorized',
      mutateReviewer: async (uid) => {
        await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(uid).update({
          permissions: [
            {
              subject: 'physics',
              active: false,
              grantedAt: '2026-01-01T00:00:00.000Z',
              grantedBy: 'admin',
              canApprove: true,
              canRevoke: true,
            },
          ],
          recordVersion: 2,
        });
      },
    },
    {
      code: 'reviewer_not_found',
      mutateReviewer: async (uid) => {
        await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(uid).delete();
      },
    },
    {
      code: 'reviewer_uid_mismatch',
      mutateReviewer: async (uid) => {
        await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(uid).update({
          uid: `${uid}-mismatched-uid`,
          recordVersion: 2,
        });
      },
    },
    {
      code: 'reviewer_id_mismatch',
      mutateReviewer: async (uid) => {
        await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(uid).update({
          reviewerId: 'sme-phys-dr-mismatched-id',
          recordVersion: 2,
        });
      },
    },
  ];

  for (const { code, mutateReviewer } of canonicalFailureCases) {
    const testUid = `uid-emu-revparam-${code.replace(/_/g, '-')}`;
    const reviewerId = `sme-phys-dr-rev-${code.slice(0, 10).replace(/_/g, '-')}`;
    const questionId = `PHY-EMU-REVPARAM-${code.toUpperCase().replace(/_/g, '-')}`;

    // 1. Seed reviewer profile into Firestore Emulator with canApprove and canRevoke
    const profile = validProfile({
      uid: testUid,
      reviewerId,
      status: 'active',
      recordVersion: 1,
      permissions: [
        {
          subject: 'physics',
          active: true,
          grantedAt: '2026-01-01T00:00:00.000Z',
          grantedBy: 'admin',
          canApprove: true,
          canRevoke: true,
        },
      ],
    });
    await db.collection(TRUSTED_REVIEWER_COLLECTION).doc(testUid).set(profile);

    // 2. Stage question in authoritative repository
    const question: AssessmentQuestion = {
      id: questionId,
      type: 'mcq',
      topicId: 'physics.units-measurements.dimensional-analysis',
      topicLabel: 'Dimensional Analysis',
      difficulty: 'medium',
      stem: `Revocation dimensional equation stem for test case ${code}`,
      options: ['[M L^2 T^-1]', '[M L T^-1]', '[M L^2 T^-2]', '[M L^-1 T^-2]'],
      correctOptionIndex: 0,
      explanation: 'Dimensional correctness confirmed for revocation test.',
    };

    const stagedRecord: StagedQuestionRecord = {
      question,
      checkpointId: 'PHY-01-CP1',
      subject: 'physics',
      topicId: question.topicId,
      stageStatus: 'staged',
      stagedAt: '2026-11-01T00:00:00.000Z',
    };

    const contentRepo = new MemoryStagedContentRepository([stagedRecord]);
    const signingService = new LocalAsymmetricTestSigningService();

    // 3. Seed an existing valid approval that can be revoked
    const approveReq: ContentApprovalRequest = {
      questionId,
      checkpointId: 'PHY-01-CP1',
      mathematicalCheckConfirmed: true,
      pedagogicalReviewConfirmed: true,
    };

    const approveOutcome = await approveQuestionContent(
      approveReq,
      { uid: testUid },
      authority,
      contentRepo,
      approvalRepo,
      signingService
    );
    assert.equal(approveOutcome.ok, true, `Seeding initial approval must succeed for "${code}"`);
    if (!approveOutcome.ok) continue;

    const contentDigest = approveOutcome.approvalRecord.contentDigest;

    // 4. Create intercepted approval repo that triggers the specific commit failure right before revocation transaction
    const origRevokeApproval = approvalRepo.revokeApproval.bind(approvalRepo);
    const interceptedApprovalRepo = Object.create(approvalRepo);
    interceptedApprovalRepo.revokeApproval = async (qId: string, digest: string, rev: any, options: any) => {
      await mutateReviewer(testUid);
      return origRevokeApproval(qId, digest, rev, options);
    };

    const revocationRequest: ContentRevocationRequest = {
      questionId,
      contentDigest,
      reason: `Testing commit-time revocation rejection for canonical code: ${code}`,
    };

    // 5. Execute revocation flow
    const outcome = await revokeQuestionApproval(
      revocationRequest,
      { uid: testUid },
      authority,
      interceptedApprovalRepo
    );

    // 6. Assert actual returned HTTP status and canonical failure code
    assert.equal(outcome.ok, false, `Expected commit check to fail for code "${code}"`);
    if (!outcome.ok) {
      assert.equal(outcome.status, 403, `Status code must be 403 for "${code}"`);
      assert.equal(outcome.code, code, `Returned code must match expected canonical failure code "${code}"`);
    }

    // 7. Directly query real Firestore Emulator collection reviewerAuthorizationAudit
    const revokeAuditSnap = await db
      .collection(REVIEWER_AUDIT_COLLECTION)
      .where('questionId', '==', questionId)
      .where('action', '==', 'revoke')
      .get();

    // Assert exactly 2 revoke audit events exist for this attempt
    assert.equal(
      revokeAuditSnap.docs.length,
      2,
      `Exactly 2 revoke audit events expected for attempt on question "${questionId}"`
    );
    const revokeEvents = revokeAuditSnap.docs.map((d) => d.data());

    // 8. Assert initial authorization audit event exists
    const initialEvent = revokeEvents.find((e) => e.decision === 'authorized');
    assert.ok(initialEvent, `Initial authorization audit event must exist for revoke "${code}"`);
    assert.equal(initialEvent.allowed, true, 'Initial revoke event must have allowed=true');
    assert.equal(initialEvent.code, 'authorized', 'Initial revoke event code must be "authorized"');
    assert.equal(initialEvent.action, 'revoke', 'Initial revoke event action must be "revoke"');
    assert.equal(initialEvent.callerUid, testUid);
    assert.equal(initialEvent.resolvedReviewerId, reviewerId);
    assert.equal(initialEvent.questionId, questionId, 'Initial event must contain the correct questionId');
    assert.equal(initialEvent.requestedSubject, 'physics');

    // 9. Assert compensating denial event exists
    const compensatingDenialEvent = revokeEvents.find((e) => e.decision === 'denied');
    assert.ok(compensatingDenialEvent, `Compensating denial event must exist for revoke "${code}"`);
    assert.equal(compensatingDenialEvent.allowed, false, 'The compensating denial event has allowed=false');
    assert.equal(compensatingDenialEvent.code, code, `Compensating denial code must match canonical failure code "${code}"`);
    assert.equal(compensatingDenialEvent.action, 'revoke');
    assert.equal(compensatingDenialEvent.callerUid, testUid);
    assert.equal(compensatingDenialEvent.resolvedReviewerId, reviewerId);
    assert.equal(compensatingDenialEvent.questionId, questionId, 'Compensating denial event must contain correct questionId');
    assert.equal(compensatingDenialEvent.requestedSubject, 'physics');
    assert.ok(compensatingDenialEvent.reason, 'Compensating denial event must contain failure reason');
    assert.match(compensatingDenialEvent.reason, /Commit check failed/);

    // 10. Assert both events share the same server-generated requestId
    assert.ok(initialEvent.requestId, 'Initial event must have a non-empty requestId');
    assert.equal(
      initialEvent.requestId,
      compensatingDenialEvent.requestId,
      'Both revoke events must share the same server-generated requestId'
    );
    assert.notEqual(initialEvent.requestId, questionId, 'requestId must be a unique attempt UUID, not questionId');
    assert.match(
      initialEvent.requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    // 11. Assert total audit records for questionId: exactly 3 (1 initial approve + 2 revoke)
    const totalAuditSnap = await db
      .collection(REVIEWER_AUDIT_COLLECTION)
      .where('questionId', '==', questionId)
      .get();
    assert.equal(
      totalAuditSnap.docs.length,
      3,
      `Exactly 3 audit events total (1 approve + 2 revoke) expected for "${questionId}"`
    );

    // 12. Assert the approval record remains active and approved in real Firestore (transaction aborted before mutation)
    const activeApproval = await approvalRepo.getActiveApproval(questionId);
    assert.ok(activeApproval, `Approval record for "${questionId}" must still exist`);
    assert.equal(activeApproval.lifecycleStatus, 'approved', 'Approval record must remain approved (unrevoked)');
  }
});

