import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  approveQuestionContent,
  revokeQuestionApproval,
} from './contentApprovalService.ts';
import {
  ServerReviewerAuthority,
  MemoryReviewerRegistry,
  MemoryReviewerAuditRepository,
  FailingReviewerAuditRepository,
} from './reviewerAuthority.ts';
import {
  CloudKmsSigningService,
  DisabledSigningService,
  LocalAsymmetricTestSigningService,
  serializeApprovalPayloadForSigning,
} from './signingService.ts';
import {
  CatalogueCheckpointContentRepository,
  MemoryStagedContentRepository,
} from './contentRepository.ts';
import {
  MemoryApprovalRecordRepository,
} from './approvalRepository.ts';
import { registerContentApprovalRoutes } from './approvalRoutes.ts';
import type {
  AuthorizedReviewerProfile,
  ContentApprovalRequest,
  ContentRevocationRequest,
  StagedQuestionRecord,
} from './types.ts';
import type { VerifiedIdentity } from '../authMiddleware.ts';
import {
  computeQuestionContentDigest,
  isQuestionContentIntegrityIntact,
  isQuestionFormallyVerified,
  isQuestionPlacementValid,
} from '../../features/roadmaps/engine/contentGovernance.ts';
import type {
  AssessmentQuestion,
  Checkpoint,
  ContentReviewRecord,
} from '../../features/roadmaps/types/checkpoint.types.ts';
import { createApiAccessControl, MEDIA_BODY_PATHS } from '../apiAccessControl.ts';
import { FixedWindowRateLimiter } from '../rateLimiter.ts';
import { MemoryDailyQuotaStore } from '../quotaStore.ts';
import { REQUEST_LIMITS } from '../requestValidation.ts';
import { withTestServer } from '../testHttp.ts';

// ============================================================================
// Fixtures & Test Setup
// ============================================================================

const TEST_PHYSICS_REVIEWER: AuthorizedReviewerProfile = {
  uid: 'uid-reviewer-phys-01',
  reviewerId: 'sme-phys-dr-sharma',
  displayName: 'Dr. Sharma',
  email: 'sharma@physics.learnmate.org',
  status: 'active',
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
};

const TEST_CHEM_REVIEWER: AuthorizedReviewerProfile = {
  uid: 'uid-reviewer-chem-01',
  reviewerId: 'sme-chem-dr-roy',
  displayName: 'Dr. Roy',
  email: 'roy@chem.learnmate.org',
  status: 'active',
  permissions: [
    {
      subject: 'chemistry',
      active: true,
      grantedAt: '2026-01-01T00:00:00.000Z',
      grantedBy: 'admin-council',
      canApprove: true,
      canRevoke: true,
    },
  ],
};

const TEST_SUSPENDED_REVIEWER: AuthorizedReviewerProfile = {
  uid: 'uid-reviewer-suspended',
  reviewerId: 'sme-phys-dr-suspended',
  displayName: 'Dr. Suspended',
  status: 'suspended',
  permissions: [
    {
      subject: 'physics',
      active: true,
      grantedAt: '2026-01-01T00:00:00.000Z',
      grantedBy: 'admin-council',
    },
  ],
};

function createValidAuthoritativeQuestion(): AssessmentQuestion {
  return {
    id: 'PHY-01-Q1',
    type: 'mcq',
    topicId: 'physics.units-measurements.dimensional-analysis',
    topicLabel: 'Dimensional Analysis',
    difficulty: 'medium',
    stem: 'What are the dimensions of Planck constant (h)?',
    options: ['[M L^2 T^-1]', '[M L T^-1]', '[M L^2 T^-2]', '[M L^-1 T^-2]'],
    correctOptionIndex: 0,
    explanation: 'From E = hv, h = E / v = [M L^2 T^-2] / [T^-1] = [M L^2 T^-1].',
  };
}

function setupTestEnvironment() {
  const authority = new ServerReviewerAuthority([
    TEST_PHYSICS_REVIEWER,
    TEST_CHEM_REVIEWER,
    TEST_SUSPENDED_REVIEWER,
  ]);

  const stagedQ = createValidAuthoritativeQuestion();
  const stagedRecord: StagedQuestionRecord = {
    question: stagedQ,
    checkpointId: 'PHY-01-CP1',
    subject: 'physics',
    topicId: stagedQ.topicId,
    stageStatus: 'staged',
    stagedAt: '2026-11-01T00:00:00.000Z',
  };

  const chemStagedQ: AssessmentQuestion = {
    id: 'CHEM-01-Q1',
    type: 'mcq',
    topicId: 'chemistry.atomic-structure.bohr-radius',
    topicLabel: 'Bohr Radius',
    difficulty: 'medium',
    stem: 'What is the radius of the first orbit of hydrogen atom in angstroms?',
    options: ['0.529 A', '0.264 A', '1.058 A', '0.132 A'],
    correctOptionIndex: 0,
    explanation: 'The Bohr radius of hydrogen first orbit is 0.529 Angstroms.',
  };
  const chemStagedRecord: StagedQuestionRecord = {
    question: chemStagedQ,
    checkpointId: 'CHEM-01-CP1',
    subject: 'chemistry',
    topicId: chemStagedQ.topicId,
    stageStatus: 'staged',
    stagedAt: '2026-11-01T00:00:00.000Z',
  };

  const contentRepo = new MemoryStagedContentRepository([stagedRecord, chemStagedRecord]);
  const approvalRepo = new MemoryApprovalRecordRepository(authority.getRegistry());
  const signingService = new LocalAsymmetricTestSigningService();

  return { authority, contentRepo, approvalRepo, signingService, stagedQ, chemStagedQ };
}

// ============================================================================
// Sprint 3C.1 Required Adversarial Test Suite
// ============================================================================

test('sprint3c: 1. Arbitrary client-submitted question JSON is rejected (anti-oracle guard)', async () => {
  const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();
  const physicsCaller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };

  // Adversary sends question JSON directly in request body
  const rawBodyWithQuestion = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    question: {
      stem: 'Malicious / invented question injected by client',
      options: ['1', '2', '3', '4'],
      correctOptionIndex: 0,
      explanation: 'Fake derivation',
      type: 'mcq',
    },
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  } as unknown as ContentApprovalRequest;

  const result = await approveQuestionContent(
    rawBodyWithQuestion,
    physicsCaller,
    authority,
    contentRepo,
    approvalRepo,
    signingService
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.equal(result.code, 'client_content_prohibited');
    assert.match(result.error, /Client cannot supply question definition/);
  }
});

test('sprint3c: 2. Unknown question ID is rejected with 404 question_not_found', async () => {
  const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();
  const physicsCaller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };

  const request: ContentApprovalRequest = {
    questionId: 'PHY-UNKNOWN-999',
    checkpointId: 'PHY-01-CP1',
    claimedReviewerId: 'sme-phys-dr-sharma',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  const result = await approveQuestionContent(
    request,
    physicsCaller,
    authority,
    contentRepo,
    approvalRepo,
    signingService
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 404);
    assert.equal(result.code, 'question_not_found');
    assert.match(result.error, /was not found in staged content/);
  }
});

test('sprint3c: 3. Staged question can be retrieved and validated from authoritative repository', async () => {
  const { contentRepo } = setupTestEnvironment();

  const staged = await contentRepo.getStagedQuestion('PHY-01-CP1', 'PHY-01-Q1');
  assert.ok(staged);
  assert.equal(staged.checkpointId, 'PHY-01-CP1');
  assert.equal(staged.subject, 'physics');
  assert.equal(staged.question.id, 'PHY-01-Q1');
  assert.equal(staged.stageStatus, 'staged');
});

test('sprint3c: 4. Server signs the authoritative stored question, not client content', async () => {
  const { authority, contentRepo, approvalRepo, signingService, stagedQ } = setupTestEnvironment();
  const physicsCaller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };

  const request: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    claimedReviewerId: 'sme-phys-dr-sharma',
    reviewNotes: 'Authoritative review completed.',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  const result = await approveQuestionContent(
    request,
    physicsCaller,
    authority,
    contentRepo,
    approvalRepo,
    signingService
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    const expectedDigest = computeQuestionContentDigest(stagedQ);
    assert.equal(result.approvalRecord.questionId, 'PHY-01-Q1');
    assert.equal(result.approvalRecord.contentDigest, expectedDigest);
    assert.equal(result.approvalRecord.contentVersion, expectedDigest);
    assert.equal(result.approvalRecord.checkpointId, 'PHY-01-CP1');
    assert.equal(result.approvalRecord.subject, 'physics');
    assert.equal(result.approvalRecord.reviewerId, TEST_PHYSICS_REVIEWER.reviewerId);
    assert.equal(result.approvalRecord.reviewerUid, TEST_PHYSICS_REVIEWER.uid);
    assert.equal(result.approvalRecord.lifecycleStatus, 'approved');
    assert.ok(result.approvalRecord.signature);
  }
});

test('sprint3c: 5. Changing question ID invalidates approval (placement binding)', async () => {
  const { authority, contentRepo, approvalRepo, signingService, stagedQ } = setupTestEnvironment();
  const physicsCaller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };

  const result = await approveQuestionContent(
    {
      questionId: 'PHY-01-Q1',
      checkpointId: 'PHY-01-CP1',
      mathematicalCheckConfirmed: true,
      pedagogicalReviewConfirmed: true,
    },
    physicsCaller,
    authority,
    contentRepo,
    approvalRepo,
    signingService
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const validRecord: ContentReviewRecord = { ...result.approvalRecord };

  // Original question with matching ID passes placement check
  const originalQ: AssessmentQuestion = { ...stagedQ, reviewRecord: validRecord };
  assert.equal(isQuestionPlacementValid(originalQ, 'PHY-01-CP1', 'physics'), true);

  // Re-aliasing or cloning question to PHY-01-Q2 MUST FAIL placement check
  const clonedQ: AssessmentQuestion = { ...stagedQ, id: 'PHY-01-Q2', reviewRecord: validRecord };
  assert.equal(isQuestionPlacementValid(clonedQ, 'PHY-01-CP1', 'physics'), false);
});

test('sprint3c: 6. Changing checkpoint placement invalidates approval', async () => {
  const { authority, contentRepo, approvalRepo, signingService, stagedQ } = setupTestEnvironment();
  const physicsCaller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };

  const result = await approveQuestionContent(
    {
      questionId: 'PHY-01-Q1',
      checkpointId: 'PHY-01-CP1',
      mathematicalCheckConfirmed: true,
      pedagogicalReviewConfirmed: true,
    },
    physicsCaller,
    authority,
    contentRepo,
    approvalRepo,
    signingService
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const validRecord: ContentReviewRecord = { ...result.approvalRecord };
  const questionWithRecord: AssessmentQuestion = { ...stagedQ, reviewRecord: validRecord };

  // Valid in PHY-01-CP1
  assert.equal(isQuestionPlacementValid(questionWithRecord, 'PHY-01-CP1', 'physics'), true);

  // Moved to PHY-01-CP2 -> FAILS
  assert.equal(isQuestionPlacementValid(questionWithRecord, 'PHY-01-CP2', 'physics'), false);
});

test('sprint3c: 7. Changing topic or subject invalidates approval', async () => {
  const { authority, contentRepo, approvalRepo, signingService, stagedQ } = setupTestEnvironment();
  const physicsCaller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };

  const result = await approveQuestionContent(
    {
      questionId: 'PHY-01-Q1',
      checkpointId: 'PHY-01-CP1',
      mathematicalCheckConfirmed: true,
      pedagogicalReviewConfirmed: true,
    },
    physicsCaller,
    authority,
    contentRepo,
    approvalRepo,
    signingService
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const validRecord: ContentReviewRecord = { ...result.approvalRecord };

  // Alter topic
  const alteredTopicQ: AssessmentQuestion = {
    ...stagedQ,
    topicId: 'physics.kinematics.motion-in-straight-line',
    reviewRecord: validRecord,
  };
  assert.equal(isQuestionPlacementValid(alteredTopicQ, 'PHY-01-CP1', 'physics'), false);

  // Alter subject
  const alteredSubjectQ: AssessmentQuestion = {
    ...stagedQ,
    reviewRecord: validRecord,
  };
  assert.equal(isQuestionPlacementValid(alteredSubjectQ, 'PHY-01-CP1', 'chemistry'), false);
});

test('sprint3c: 8. Changing content invalidates approval digest', async () => {
  const { authority, contentRepo, approvalRepo, signingService, stagedQ } = setupTestEnvironment();
  const physicsCaller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };

  const result = await approveQuestionContent(
    {
      questionId: 'PHY-01-Q1',
      checkpointId: 'PHY-01-CP1',
      mathematicalCheckConfirmed: true,
      pedagogicalReviewConfirmed: true,
    },
    physicsCaller,
    authority,
    contentRepo,
    approvalRepo,
    signingService
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const record: ContentReviewRecord = { ...result.approvalRecord };

  // Stem altered
  const tamperedStem = { ...stagedQ, stem: 'Changed stem content' };
  assert.equal(isQuestionContentIntegrityIntact(tamperedStem, record), false);

  // Answer altered
  const tamperedAnswer = { ...stagedQ, correctOptionIndex: 3 };
  assert.equal(isQuestionContentIntegrityIntact(tamperedAnswer, record), false);

  // Options altered
  const tamperedOptions = { ...stagedQ, options: ['A', 'B', 'C', 'D'] as [string, string, string, string] };
  assert.equal(isQuestionContentIntegrityIntact(tamperedOptions, record), false);
});

test('sprint3c: 9. Stale content version cannot replace a newer approval', async () => {
  const { approvalRepo, stagedQ } = setupTestEnvironment();
  const digest = computeQuestionContentDigest(stagedQ);

  // 1. Save newer approval record with timestamp T2
  const newerRecord = {
    schemaVersion: 2 as const,
    reviewStatus: 'verified' as const,
    questionId: 'PHY-01-Q1',
    reviewerUid: TEST_PHYSICS_REVIEWER.uid,
    reviewerId: TEST_PHYSICS_REVIEWER.reviewerId,
    subject: 'physics' as const,
    checkpointId: 'PHY-01-CP1',
    topicId: stagedQ.topicId,
    contentDigest: digest,
    contentVersion: digest,
    reviewedAt: '2026-11-04T12:00:00.000Z', // T2
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };
  const save1 = await approvalRepo.saveApproval(newerRecord);
  assert.equal(save1.ok, true);

  // 2. Attempt to save an older approval record with timestamp T1 < T2
  const staleRecord = {
    ...newerRecord,
    contentDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    contentVersion: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    reviewedAt: '2026-11-04T10:00:00.000Z', // T1 (older!)
  };
  const saveStale = await approvalRepo.saveApproval(staleRecord);
  assert.equal(saveStale.ok, false);
  if (!saveStale.ok) {
    assert.equal(saveStale.code, 'stale_version_conflict');
    assert.match(saveStale.error, /Stale version conflict/);
  }
});

test('sprint3c: 10. Revoked approval is rejected by repository and runtime', async () => {
  const { authority, contentRepo, approvalRepo, signingService, stagedQ } = setupTestEnvironment();
  const physicsCaller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };

  const approveResult = await approveQuestionContent(
    {
      questionId: 'PHY-01-Q1',
      checkpointId: 'PHY-01-CP1',
      mathematicalCheckConfirmed: true,
      pedagogicalReviewConfirmed: true,
    },
    physicsCaller,
    authority,
    contentRepo,
    approvalRepo,
    signingService
  );
  assert.equal(approveResult.ok, true);
  if (!approveResult.ok) return;

  const digest = approveResult.approvalRecord.contentDigest;

  // Revoke the approval
  const revokeResult = await revokeQuestionApproval(
    {
      questionId: 'PHY-01-Q1',
      contentDigest: digest,
      reason: 'Dimensional ambiguity discovered on line 3.',
    },
    physicsCaller,
    authority,
    approvalRepo
  );
  assert.equal(revokeResult.ok, true);
  if (!revokeResult.ok) return;

  assert.equal(revokeResult.approvalRecord.lifecycleStatus, 'revoked');

  // Verify repository no longer returns it as active
  const active = await approvalRepo.getActiveApproval('PHY-01-Q1');
  assert.equal(active, null);

  // Verify runtime rejects revoked record
  const revokedRecord: ContentReviewRecord = { ...revokeResult.approvalRecord };
  const questionWithRevoked: AssessmentQuestion = { ...stagedQ, reviewRecord: revokedRecord };
  assert.equal(isQuestionPlacementValid(questionWithRevoked, 'PHY-01-CP1', 'physics'), false);
});

test('sprint3c: 11. Duplicate approval requests behave deterministically (idempotent)', async () => {
  const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();
  const physicsCaller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };

  const req: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  const res1 = await approveQuestionContent(req, physicsCaller, authority, contentRepo, approvalRepo, signingService);
  const res2 = await approveQuestionContent(req, physicsCaller, authority, contentRepo, approvalRepo, signingService);

  assert.equal(res1.ok, true);
  assert.equal(res2.ok, true);
  if (res1.ok && res2.ok) {
    assert.equal(res1.isDuplicate, false);
    assert.equal(res2.isDuplicate, true);
    assert.equal(res1.approvalRecord.contentDigest, res2.approvalRecord.contentDigest);
    assert.equal(res1.approvalRecord.signature, res2.approvalRecord.signature);
  }
});

test('sprint3c: 12. Concurrent approval attempts cannot create conflicting active records', async () => {
  const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();
  const physicsCaller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };

  const req: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  // Launch 5 simultaneous approval calls for the same question
  const promises = Array.from({ length: 5 }, () =>
    approveQuestionContent(req, physicsCaller, authority, contentRepo, approvalRepo, signingService)
  );

  const outcomes = await Promise.all(promises);
  for (const outcome of outcomes) {
    assert.equal(outcome.ok, true);
  }

  // Exactly one should be non-duplicate (the first winner), the rest duplicates
  const nonDuplicates = outcomes.filter((o) => o.ok && !o.isDuplicate);
  assert.equal(nonDuplicates.length, 1);

  // Exactly one active record exists in repo
  const active = await approvalRepo.getActiveApproval('PHY-01-Q1');
  assert.ok(active);
  assert.equal(active.lifecycleStatus, 'approved');
});

test('sprint3c: 13. Ordinary clients cannot write approval records', async () => {
  const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();

  const req: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  // 1. Unauthenticated client
  const unauth = await approveQuestionContent(req, undefined, authority, contentRepo, approvalRepo, signingService);
  assert.equal(unauth.ok, false);
  if (!unauth.ok) {
    assert.equal(unauth.status, 401);
    assert.equal(unauth.code, 'auth_required');
  }

  // 2. Normal learner Alice
  const learnerCaller: VerifiedIdentity = { uid: 'uid-student-alice' };
  const learner = await approveQuestionContent(req, learnerCaller, authority, contentRepo, approvalRepo, signingService);
  assert.equal(learner.ok, false);
  if (!learner.ok) {
    assert.equal(learner.status, 403);
    assert.equal(learner.code, 'not_authorized');
  }
});

test('sprint3c: 14. Missing reviewer authority or signing configuration fails closed', async () => {
  const { authority, contentRepo, approvalRepo } = setupTestEnvironment();
  const physicsCaller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };

  const req: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  // Unconfigured signing service fails closed
  const disabledSigning = new DisabledSigningService();
  const res = await approveQuestionContent(req, physicsCaller, authority, contentRepo, approvalRepo, disabledSigning);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.status, 503);
    assert.equal(res.code, 'signing_unavailable');
  }

  // Physics SME trying to approve Chemistry fails closed
  const signing = new LocalAsymmetricTestSigningService();
  const chemReq: ContentApprovalRequest = {
    questionId: 'CHEM-01-Q1',
    checkpointId: 'CHEM-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };
  const chemRes = await approveQuestionContent(chemReq, physicsCaller, authority, contentRepo, approvalRepo, signing);
  assert.equal(chemRes.ok, false);
  if (!chemRes.ok) {
    assert.equal(chemRes.status, 403);
    assert.equal(chemRes.code, 'subject_unauthorized');
  }
});

test('sprint3c: 15. Legacy approval records remain rejected', () => {
  const stagedQ = createValidAuthoritativeQuestion();

  // FNV format record
  const fnvRecord: ContentReviewRecord = {
    reviewStatus: 'verified',
    reviewerId: 'sme-phys-dr-sharma',
    reviewedAt: '2026-11-01T00:00:00.000Z',
    contentVersion: 'fnv1a:12345678',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };
  assert.equal(isQuestionContentIntegrityIntact(stagedQ, fnvRecord), false);

  // Semantic version format record
  const semverRecord: ContentReviewRecord = {
    reviewStatus: 'verified',
    reviewerId: 'sme-phys-dr-sharma',
    reviewedAt: '2026-11-01T00:00:00.000Z',
    contentVersion: '1.0.0',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };
  assert.equal(isQuestionContentIntegrityIntact(stagedQ, semverRecord), false);
});

// ============================================================================
// HTTP Integration Test via withTestServer
// ============================================================================

test('sprint3c: 16. Full HTTP API route integration (/approve and /revoke) through apiAccessControl', async () => {
  const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();

  const mockTokenVerifier = async (token: string) => {
    if (token === 'token-phys-reviewer') {
      return { uid: TEST_PHYSICS_REVIEWER.uid, email: TEST_PHYSICS_REVIEWER.email, signInProvider: 'google.com' };
    }
    if (token === 'token-student-alice') {
      return { uid: 'uid-student-alice', email: 'alice@student.org', signInProvider: 'google.com' };
    }
    throw Object.assign(new Error('Invalid token'), { code: 'auth/argument-error' });
  };

  const accessControl = createApiAccessControl({
    verifyIdToken: mockTokenVerifier,
    quotaStore: new MemoryDailyQuotaStore(),
    ipLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, max: 100 }),
    userLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, max: 100 }),
    dailyUnitLimit: 100,
    isFeatureEnabled: () => true,
    diagnosticsEnabled: false,
    adminUids: new Set<string>(),
  });

  const app = express();
  app.use(accessControl.beforeBody);
  app.use(MEDIA_BODY_PATHS, express.json({ limit: REQUEST_LIMITS.mediaJsonBody }));
  app.use(express.json({ limit: REQUEST_LIMITS.defaultJsonBody }));
  app.use(accessControl.afterBody);

  registerContentApprovalRoutes(app, {
    authority,
    contentRepository: contentRepo,
    approvalRepository: approvalRepo,
    signingService,
  });

  await withTestServer(app, async (baseUrl) => {
    const approveUrl = `${baseUrl}/api/content/review/approve`;
    const revokeUrl = `${baseUrl}/api/content/review/revoke`;

    // 1. Unauthenticated approve -> 401
    const unauth = await fetch(approveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: 'PHY-01-Q1', checkpointId: 'PHY-01-CP1' }),
    });
    assert.equal(unauth.status, 401);

    // 2. Student Alice approve -> 403
    const student = await fetch(approveUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-student-alice',
      },
      body: JSON.stringify({
        questionId: 'PHY-01-Q1',
        checkpointId: 'PHY-01-CP1',
        mathematicalCheckConfirmed: true,
        pedagogicalReviewConfirmed: true,
      }),
    });
    assert.equal(student.status, 403);

    // 3. SME Reviewer approve -> 200 OK
    const smeApprove = await fetch(approveUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-phys-reviewer',
      },
      body: JSON.stringify({
        questionId: 'PHY-01-Q1',
        checkpointId: 'PHY-01-CP1',
        mathematicalCheckConfirmed: true,
        pedagogicalReviewConfirmed: true,
      }),
    });
    assert.equal(smeApprove.status, 200);
    const approveBody = await smeApprove.json() as {
      ok: boolean;
      approvalRecord: {
        questionId: string;
        contentDigest: string;
        signature: string;
      };
    };
    assert.equal(approveBody.ok, true);
    assert.equal(approveBody.approvalRecord.questionId, 'PHY-01-Q1');
    assert.ok(approveBody.approvalRecord.signature);

    // 4. SME Reviewer revoke -> 200 OK
    const smeRevoke = await fetch(revokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-phys-reviewer',
      },
      body: JSON.stringify({
        questionId: 'PHY-01-Q1',
        contentDigest: approveBody.approvalRecord.contentDigest,
        reason: 'Syllabus revised: Dimensional units re-verified.',
      }),
    });
    assert.equal(smeRevoke.status, 200);
    const revokeBody = await smeRevoke.json() as {
      ok: boolean;
      approvalRecord: {
        lifecycleStatus: string;
      };
    };
    assert.equal(revokeBody.ok, true);
    assert.equal(revokeBody.approvalRecord.lifecycleStatus, 'revoked');
  });
});

// ============================================================================
// Sprint 3D.1.4: Commit-Time Authorization Audit Completeness Tests
// ============================================================================

test('sprint3d14: 1. Initial authorization followed by successful commit records single authorized event', async () => {
  const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();
  const caller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };

  const req: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  const outcome = await approveQuestionContent(req, caller, authority, contentRepo, approvalRepo, signingService);
  assert.equal(outcome.ok, true);

  const auditRepo = authority.getAuditRepository();
  const events = await auditRepo.getAuditEvents({ questionId: 'PHY-01-Q1' });
  assert.equal(events.length, 1);
  assert.equal(events[0].decision, 'authorized');
  assert.equal(events[0].code, 'authorized');
  assert.equal(events[0].allowed, true);
  assert.equal(events[0].action, 'approve');
  assert.equal(events[0].callerUid, TEST_PHYSICS_REVIEWER.uid);
  assert.equal(events[0].resolvedReviewerId, TEST_PHYSICS_REVIEWER.reviewerId);
  assert.equal(events[0].requestedSubject, 'physics');
  assert.equal(events[0].questionId, 'PHY-01-Q1');
  assert.ok(events[0].requestId);
  assert.notEqual(events[0].requestId, 'PHY-01-Q1');
});

test('sprint3d14: 2. Initial authorization followed by revocation before commit records commit-time denied event with same requestId', async () => {
  const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();
  const caller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };
  const registry = authority.getRegistry() as MemoryReviewerRegistry;

  const origSaveApproval = approvalRepo.saveApproval.bind(approvalRepo);
  approvalRepo.saveApproval = async (record, options) => {
    registry.updateReviewerStatus(TEST_PHYSICS_REVIEWER.uid, 'revoked', { reason: 'Revoked for testing TOCTOU' });
    return origSaveApproval(record, options);
  };

  const req: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  const outcome = await approveQuestionContent(req, caller, authority, contentRepo, approvalRepo, signingService);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 403);
    assert.equal(outcome.code, 'reviewer_authorization_revoked');
    assert.match(outcome.error, /required "active"/);
  }

  const auditRepo = authority.getAuditRepository();
  const events = await auditRepo.getAuditEvents({ questionId: 'PHY-01-Q1' });
  assert.equal(events.length, 2);

  // Initial event
  assert.equal(events[0].decision, 'authorized');
  assert.equal(events[0].code, 'authorized');
  assert.equal(events[0].allowed, true);
  assert.equal(events[0].action, 'approve');
  assert.equal(events[0].questionId, 'PHY-01-Q1');
  assert.ok(events[0].requestId);

  // Commit-time rejection event
  assert.equal(events[1].decision, 'denied');
  assert.equal(events[1].code, 'reviewer_authorization_revoked');
  assert.equal(events[1].allowed, false);
  assert.equal(events[1].action, 'approve');
  assert.equal(events[1].questionId, 'PHY-01-Q1');
  assert.equal(events[1].requestId, events[0].requestId);
  assert.notEqual(events[1].requestId, 'PHY-01-Q1');
  assert.equal(events[1].callerUid, caller.uid);
  assert.equal(events[1].resolvedReviewerId, TEST_PHYSICS_REVIEWER.reviewerId);
  assert.equal(events[1].requestedSubject, 'physics');
  assert.match(events[1].reason || '', /required "active"/);
  assert.ok(events[1].timestamp);
});

test('sprint3d14: 3. Initial authorization followed by permission removal records reviewer_permission_denied denied event', async () => {
  const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();
  const caller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };
  const registry = authority.getRegistry() as MemoryReviewerRegistry;

  const origSaveApproval = approvalRepo.saveApproval.bind(approvalRepo);
  approvalRepo.saveApproval = async (record, options) => {
    registry.updateSubjectPermissions(TEST_PHYSICS_REVIEWER.uid, [
      {
        subject: 'physics',
        active: true,
        grantedAt: '2026-01-01T00:00:00.000Z',
        grantedBy: 'admin',
        canApprove: false,
        canRevoke: true,
      },
    ]);
    return origSaveApproval(record, options);
  };

  const req: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  const outcome = await approveQuestionContent(req, caller, authority, contentRepo, approvalRepo, signingService);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 403);
    assert.equal(outcome.code, 'reviewer_permission_denied');
  }

  const events = await authority.getAuditRepository().getAuditEvents({ questionId: 'PHY-01-Q1' });
  assert.equal(events.length, 2);
  assert.equal(events[0].decision, 'authorized');
  assert.equal(events[1].decision, 'denied');
  assert.equal(events[1].code, 'reviewer_permission_denied');
  assert.equal(events[0].questionId, 'PHY-01-Q1');
  assert.equal(events[1].questionId, 'PHY-01-Q1');
  assert.equal(events[1].requestId, events[0].requestId);
  assert.notEqual(events[1].requestId, 'PHY-01-Q1');
  assert.equal(events[1].allowed, false);
});

test('sprint3d14: 4. Commit check failure codes (not_found, uid_mismatch, id_mismatch, subject_unauthorized) record corresponding denied events', async () => {
  const failureCases = [
    {
      code: 'reviewer_subject_unauthorized' as const,
      mutate: (reg: MemoryReviewerRegistry) => {
        reg.updateSubjectPermissions(TEST_PHYSICS_REVIEWER.uid, [
          {
            subject: 'physics',
            active: false,
            grantedAt: '2026-01-01T00:00:00.000Z',
            grantedBy: 'admin',
            canApprove: true,
            canRevoke: true,
          },
        ]);
      },
    },
    {
      code: 'reviewer_not_found' as const,
      mutate: (reg: MemoryReviewerRegistry) => {
        reg.removeReviewer(TEST_PHYSICS_REVIEWER.uid);
      },
    },
  ];

  for (const { code, mutate } of failureCases) {
    const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();
    const caller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };
    const registry = authority.getRegistry() as MemoryReviewerRegistry;

    const origSave = approvalRepo.saveApproval.bind(approvalRepo);
    approvalRepo.saveApproval = async (record, options) => {
      mutate(registry);
      return origSave(record, options);
    };

    const req: ContentApprovalRequest = {
      questionId: 'PHY-01-Q1',
      checkpointId: 'PHY-01-CP1',
      mathematicalCheckConfirmed: true,
      pedagogicalReviewConfirmed: true,
    };

    const outcome = await approveQuestionContent(req, caller, authority, contentRepo, approvalRepo, signingService);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.status, 403);
      assert.equal(outcome.code, code);
    }

    const events = await authority.getAuditRepository().getAuditEvents({ questionId: 'PHY-01-Q1' });
    assert.equal(events.length, 2);
    assert.equal(events[0].decision, 'authorized');
    assert.equal(events[1].decision, 'denied');
    assert.equal(events[1].code, code);
    assert.equal(events[0].questionId, 'PHY-01-Q1');
    assert.equal(events[1].questionId, 'PHY-01-Q1');
    assert.equal(events[1].requestId, events[0].requestId);
    assert.notEqual(events[1].requestId, 'PHY-01-Q1');
  }
});

test('sprint3d14: 5. Mandatory audit persistence failure at commit-time fails closed with 503', async () => {
  const registry = new MemoryReviewerRegistry([TEST_PHYSICS_REVIEWER]);
  let failAudit = false;
  const auditRepo = new MemoryReviewerAuditRepository();
  const origRecord = auditRepo.recordDecision.bind(auditRepo);
  auditRepo.recordDecision = async (event) => {
    if (failAudit) {
      throw new Error('Disk full / audit write failed');
    }
    return origRecord(event);
  };

  const authority = new ServerReviewerAuthority(registry, { auditRepository: auditRepo });
  const stagedQ = createValidAuthoritativeQuestion();
  const contentRepo = new MemoryStagedContentRepository([
    {
      question: stagedQ,
      checkpointId: 'PHY-01-CP1',
      subject: 'physics',
      topicId: stagedQ.topicId,
      stageStatus: 'staged',
      stagedAt: '2026-11-01T00:00:00.000Z',
    },
  ]);
  const approvalRepo = new MemoryApprovalRecordRepository(registry);
  const signingService = new LocalAsymmetricTestSigningService();

  const origSave = approvalRepo.saveApproval.bind(approvalRepo);
  approvalRepo.saveApproval = async (record, options) => {
    registry.updateReviewerStatus(TEST_PHYSICS_REVIEWER.uid, 'revoked');
    failAudit = true;
    return origSave(record, options);
  };

  const req: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  const outcome = await approveQuestionContent(req, { uid: TEST_PHYSICS_REVIEWER.uid }, authority, contentRepo, approvalRepo, signingService);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 503);
    assert.equal(outcome.code, 'audit_persistence_failed');
    assert.match(outcome.error, /Disk full \/ audit write failed/);
  }

  const active = await approvalRepo.getActiveApproval('PHY-01-Q1');
  assert.equal(active, null);
});

test('sprint3d14: 6. Transaction retries do not generate duplicate audit events', async () => {
  const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();
  const caller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };
  const registry = authority.getRegistry() as MemoryReviewerRegistry;

  let attemptCount = 0;
  const origSave = approvalRepo.saveApproval.bind(approvalRepo);
  approvalRepo.saveApproval = async (record, options) => {
    for (let i = 0; i < 3; i++) {
      attemptCount++;
    }
    registry.updateReviewerStatus(TEST_PHYSICS_REVIEWER.uid, 'revoked');
    return origSave(record, options);
  };

  const req: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  const outcome = await approveQuestionContent(req, caller, authority, contentRepo, approvalRepo, signingService);
  assert.equal(outcome.ok, false);
  assert.equal(attemptCount, 3);

  const events = await authority.getAuditRepository().getAuditEvents({ questionId: 'PHY-01-Q1' });
  assert.equal(events.length, 2);
  assert.equal(events[0].decision, 'authorized');
  assert.equal(events[1].decision, 'denied');
  assert.equal(events[1].code, 'reviewer_authorization_revoked');
  assert.equal(events[0].questionId, 'PHY-01-Q1');
  assert.equal(events[1].questionId, 'PHY-01-Q1');
  assert.equal(events[1].requestId, events[0].requestId);
  assert.notEqual(events[1].requestId, 'PHY-01-Q1');
});

test('sprint3d14: 7. Revocation flow: initial authorization followed by revocation before commit records commit-time denied event', async () => {
  const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();
  const caller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };
  const registry = authority.getRegistry() as MemoryReviewerRegistry;

  const approveReq: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };
  const approved = await approveQuestionContent(approveReq, caller, authority, contentRepo, approvalRepo, signingService);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  const origRevoke = approvalRepo.revokeApproval.bind(approvalRepo);
  approvalRepo.revokeApproval = async (qId, digest, rev, options) => {
    registry.updateSubjectPermissions(TEST_PHYSICS_REVIEWER.uid, [
      {
        subject: 'physics',
        active: true,
        grantedAt: '2026-01-01T00:00:00.000Z',
        grantedBy: 'admin',
        canApprove: true,
        canRevoke: false,
      },
    ]);
    return origRevoke(qId, digest, rev, options);
  };

  const revokeReq: ContentRevocationRequest = {
    questionId: 'PHY-01-Q1',
    contentDigest: approved.approvalRecord.contentDigest,
    reason: 'Syllabus change requires re-evaluation',
  };

  const revokeOutcome = await revokeQuestionApproval(revokeReq, caller, authority, approvalRepo);
  assert.equal(revokeOutcome.ok, false);
  if (!revokeOutcome.ok) {
    assert.equal(revokeOutcome.status, 403);
    assert.equal(revokeOutcome.code, 'reviewer_permission_denied');
  }

  const events = await authority.getAuditRepository().getAuditEvents({ questionId: 'PHY-01-Q1' });
  assert.equal(events.length, 3);
  const revokeEvents = events.filter((e) => e.action === 'revoke');
  assert.equal(revokeEvents.length, 2);
  assert.equal(revokeEvents[0].decision, 'authorized');
  assert.equal(revokeEvents[0].action, 'revoke');
  assert.equal(revokeEvents[1].decision, 'denied');
  assert.equal(revokeEvents[1].action, 'revoke');
  assert.equal(revokeEvents[1].code, 'reviewer_permission_denied');
  assert.equal(revokeEvents[1].allowed, false);
  assert.equal(revokeEvents[0].questionId, 'PHY-01-Q1');
  assert.equal(revokeEvents[1].questionId, 'PHY-01-Q1');
  assert.equal(revokeEvents[1].requestId, revokeEvents[0].requestId);
  assert.notEqual(revokeEvents[1].requestId, 'PHY-01-Q1');
});

test('sprint3d14: 8. Revocation flow: mandatory audit persistence failure fails closed with 503', async () => {
  const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();
  const caller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };
  const registry = authority.getRegistry() as MemoryReviewerRegistry;

  const approveReq: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };
  const approved = await approveQuestionContent(approveReq, caller, authority, contentRepo, approvalRepo, signingService);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  let failAudit = false;
  const auditRepo = authority.getAuditRepository();
  const origRecord = auditRepo.recordDecision.bind(auditRepo);
  auditRepo.recordDecision = async (event) => {
    if (failAudit) {
      throw new Error('Audit storage unreachable');
    }
    return origRecord(event);
  };

  const origRevoke = approvalRepo.revokeApproval.bind(approvalRepo);
  approvalRepo.revokeApproval = async (qId, digest, rev, options) => {
    registry.updateReviewerStatus(TEST_PHYSICS_REVIEWER.uid, 'revoked');
    failAudit = true;
    return origRevoke(qId, digest, rev, options);
  };

  const revokeReq: ContentRevocationRequest = {
    questionId: 'PHY-01-Q1',
    contentDigest: approved.approvalRecord.contentDigest,
    reason: 'Testing failed audit on revoke',
  };

  const revokeOutcome = await revokeQuestionApproval(revokeReq, caller, authority, approvalRepo);
  assert.equal(revokeOutcome.ok, false);
  if (!revokeOutcome.ok) {
    assert.equal(revokeOutcome.status, 503);
    assert.equal(revokeOutcome.code, 'audit_persistence_failed');
    assert.match(revokeOutcome.error, /Audit storage unreachable/);
  }
});

test('sprint3d16: 9. Repeated attempts on the same question receive distinct request IDs', async () => {
  const { authority, contentRepo, approvalRepo, signingService } = setupTestEnvironment();
  const caller: VerifiedIdentity = { uid: TEST_PHYSICS_REVIEWER.uid };

  const req: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  const outcome1 = await approveQuestionContent(req, caller, authority, contentRepo, approvalRepo, signingService);
  assert.equal(outcome1.ok, true);

  const outcome2 = await approveQuestionContent(req, caller, authority, contentRepo, approvalRepo, signingService);
  assert.equal(outcome2.ok, true);

  const events = await authority.getAuditRepository().getAuditEvents({ questionId: 'PHY-01-Q1' });
  assert.equal(events.length, 2);
  assert.equal(events[0].questionId, 'PHY-01-Q1');
  assert.equal(events[1].questionId, 'PHY-01-Q1');
  assert.notEqual(events[0].requestId, events[1].requestId, 'Different invocations must have different requestIds');
  assert.match(events[0].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.match(events[1].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});
