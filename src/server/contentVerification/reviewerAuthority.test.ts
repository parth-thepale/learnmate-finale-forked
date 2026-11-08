import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  FirestoreReviewerRegistry,
  FirestoreReviewerAuditRepository,
  FailingReviewerAuditRepository,
  MemoryReviewerRegistry,
  MemoryReviewerAuditRepository,
  RegistryLookupError,
  RegistryUnavailableError,
  ServerReviewerAuthority,
  TRUSTED_REVIEWER_COLLECTION,
  REVIEWER_AUDIT_COLLECTION,
  UnavailableReviewerRegistry,
  validateReviewerProfile,
} from './reviewerAuthority.ts';
import type {
  AuthorizedReviewerProfile,
  ContentApprovalRequest,
  ContentRevocationRequest,
  ReviewerRegistry,
  StagedQuestionRecord,
} from './types.ts';
import { StrictFakeFirestore } from '../firestoreTestDouble.ts';
import { approveQuestionContent, revokeQuestionApproval } from './contentApprovalService.ts';
import { MemoryStagedContentRepository } from './contentRepository.ts';
import { MemoryApprovalRecordRepository } from './approvalRepository.ts';
import { LocalAsymmetricTestSigningService } from './signingService.ts';
import type { AssessmentQuestion } from '../../features/roadmaps/types/checkpoint.types.ts';
import type { VerifiedIdentity } from '../authMiddleware.ts';
import { registerContentApprovalRoutes } from './approvalRoutes.ts';
import { createApiAccessControl, MEDIA_BODY_PATHS } from '../apiAccessControl.ts';
import { withTestServer } from '../testHttp.ts';
import { FixedWindowRateLimiter } from '../rateLimiter.ts';
import { MemoryDailyQuotaStore } from '../quotaStore.ts';
import { REQUEST_LIMITS } from '../requestValidation.ts';

// ============================================================================
// Fixtures
// ============================================================================

const ACTIVE_PHYSICS_REVIEWER: AuthorizedReviewerProfile = {
  uid: 'uid-sme-phys-01',
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
};

const ACTIVE_CHEMISTRY_REVIEWER: AuthorizedReviewerProfile = {
  uid: 'uid-sme-chem-01',
  reviewerId: 'sme-chem-dr-roy',
  displayName: 'Dr. Roy',
  email: 'roy@chem.learnmate.org',
  role: 'reviewer',
  status: 'active',
  registryVersion: '2026.1',
  recordVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'admin-council',
  permissions: [
    {
      subject: 'chemistry',
      active: true,
      grantedAt: '2026-01-01T00:00:00.000Z',
      grantedBy: 'admin-council',
      canApprove: true,
      canRevoke: false,
    },
  ],
};

const REVOKED_REVIEWER: AuthorizedReviewerProfile = {
  uid: 'uid-sme-revoked-01',
  reviewerId: 'sme-math-dr-revoked',
  displayName: 'Dr. Revoked',
  role: 'reviewer',
  status: 'revoked',
  registryVersion: '2026.1',
  recordVersion: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'admin-council',
  revokedAt: '2026-02-01T00:00:00.000Z',
  revokedBy: 'admin-compliance',
  revocationReason: 'Academic affiliation expired.',
  permissions: [
    {
      subject: 'mathematics',
      active: true,
      grantedAt: '2026-01-01T00:00:00.000Z',
      grantedBy: 'admin-council',
    },
  ],
};

const DISABLED_REVIEWER: AuthorizedReviewerProfile = {
  uid: 'uid-sme-disabled-01',
  reviewerId: 'sme-phys-dr-disabled',
  displayName: 'Dr. Disabled',
  role: 'reviewer',
  status: 'disabled',
  registryVersion: '2026.1',
  recordVersion: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'admin-council',
  disabledAt: '2026-02-15T00:00:00.000Z',
  disabledBy: 'admin-security',
  disableReason: 'Security rotation in progress.',
  permissions: [
    {
      subject: 'physics',
      active: true,
      grantedAt: '2026-01-01T00:00:00.000Z',
      grantedBy: 'admin-council',
    },
  ],
};

const SUSPENDED_REVIEWER: AuthorizedReviewerProfile = {
  uid: 'uid-sme-suspended-01',
  reviewerId: 'sme-phys-dr-suspended',
  displayName: 'Dr. Suspended',
  role: 'reviewer',
  status: 'suspended',
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
    },
  ],
};

// ============================================================================
// Sprint 3D.1 Required Tests
// ============================================================================

test('sprint3d: 1. Authorized reviewer succeeds with resolved identity and audit trail', async () => {
  const authority = new ServerReviewerAuthority([ACTIVE_PHYSICS_REVIEWER]);

  const outcome = await authority.authorizeReviewer(
    ACTIVE_PHYSICS_REVIEWER.uid,
    'physics',
    { requestId: 'PHY-01-Q1' }
  );

  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.profile.uid, ACTIVE_PHYSICS_REVIEWER.uid);
    assert.equal(outcome.profile.reviewerId, 'sme-phys-dr-sharma');
    assert.equal(outcome.profile.role, 'senior_reviewer');
    assert.equal(outcome.profile.status, 'active');

    // Verify audit record attached to outcome
    assert.equal(outcome.auditRecord.decision, 'authorized');
    assert.equal(outcome.auditRecord.code, 'authorized');
    assert.equal(outcome.auditRecord.allowed, true);
    assert.equal(outcome.auditRecord.callerUid, ACTIVE_PHYSICS_REVIEWER.uid);
    assert.equal(outcome.auditRecord.resolvedReviewerId, 'sme-phys-dr-sharma');
    assert.equal(outcome.auditRecord.requestedSubject, 'physics');
    assert.equal(outcome.auditRecord.requestId, 'PHY-01-Q1');
    assert.equal(outcome.auditRecord.registryVersion, '2026.1');
    assert.ok(outcome.auditRecord.timestamp);
    assert.ok(outcome.auditRecord.auditId);
  }

  // Verify audit log storage in authority
  const auditTrail = await authority.getAuditTrail({ requestId: 'PHY-01-Q1' });
  assert.equal(auditTrail.length, 1);
  assert.equal(auditTrail[0].decision, 'authorized');
});

test('sprint3d: 2. Unknown reviewer is rejected with 403 not_authorized (deny by default)', async () => {
  const authority = new ServerReviewerAuthority([ACTIVE_PHYSICS_REVIEWER]);

  const outcome = await authority.authorizeReviewer(
    'uid-unknown-attacker',
    'physics',
    { requestId: 'PHY-01-Q1' }
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 403);
    assert.equal(outcome.code, 'not_authorized');
    assert.match(outcome.message, /not have SME content review privileges/);

    assert.equal(outcome.auditRecord.decision, 'denied');
    assert.equal(outcome.auditRecord.code, 'not_authorized');
    assert.equal(outcome.auditRecord.allowed, false);
    assert.equal(outcome.auditRecord.callerUid, 'uid-unknown-attacker');
    assert.equal(outcome.auditRecord.resolvedReviewerId, undefined);
    assert.equal(outcome.auditRecord.requestedSubject, 'physics');
    assert.equal(outcome.auditRecord.requestId, 'PHY-01-Q1');
  }
});

test('sprint3d: 3. Revoked reviewer is rejected with 403 reviewer_revoked', async () => {
  const authority = new ServerReviewerAuthority([REVOKED_REVIEWER]);

  const outcome = await authority.authorizeReviewer(
    REVOKED_REVIEWER.uid,
    'mathematics',
    { requestId: 'MATH-01-Q1' }
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 403);
    assert.equal(outcome.code, 'reviewer_revoked');
    assert.match(outcome.message, /has been revoked/);

    assert.equal(outcome.auditRecord.decision, 'denied');
    assert.equal(outcome.auditRecord.code, 'reviewer_revoked');
    assert.equal(outcome.auditRecord.allowed, false);
    assert.equal(outcome.auditRecord.callerUid, REVOKED_REVIEWER.uid);
    assert.equal(outcome.auditRecord.resolvedReviewerId, 'sme-math-dr-revoked');
  }
});

test('sprint3d: 4. Disabled reviewer is rejected with 403 reviewer_disabled', async () => {
  const authority = new ServerReviewerAuthority([DISABLED_REVIEWER, SUSPENDED_REVIEWER]);

  // Test disabled reviewer
  const outcomeDisabled = await authority.authorizeReviewer(
    DISABLED_REVIEWER.uid,
    'physics',
    { requestId: 'PHY-01-Q1' }
  );

  assert.equal(outcomeDisabled.ok, false);
  if (!outcomeDisabled.ok) {
    assert.equal(outcomeDisabled.status, 403);
    assert.equal(outcomeDisabled.code, 'reviewer_disabled');
    assert.match(outcomeDisabled.message, /is disabled/);

    assert.equal(outcomeDisabled.auditRecord.decision, 'denied');
    assert.equal(outcomeDisabled.auditRecord.code, 'reviewer_disabled');
    assert.equal(outcomeDisabled.auditRecord.callerUid, DISABLED_REVIEWER.uid);
    assert.equal(outcomeDisabled.auditRecord.resolvedReviewerId, 'sme-phys-dr-disabled');
  }

  // Test suspended reviewer
  const outcomeSuspended = await authority.authorizeReviewer(
    SUSPENDED_REVIEWER.uid,
    'physics',
    { requestId: 'PHY-01-Q2' }
  );

  assert.equal(outcomeSuspended.ok, false);
  if (!outcomeSuspended.ok) {
    assert.equal(outcomeSuspended.status, 403);
    assert.equal(outcomeSuspended.code, 'reviewer_suspended');
    assert.match(outcomeSuspended.message, /suspended/);
  }
});

test('sprint3d: 5. Wrong subject domain is rejected with 403 subject_unauthorized', async () => {
  // Dr. Sharma is authorized for physics only
  const authority = new ServerReviewerAuthority([ACTIVE_PHYSICS_REVIEWER]);

  const outcome = await authority.authorizeReviewer(
    ACTIVE_PHYSICS_REVIEWER.uid,
    'chemistry',
    { requestId: 'CHEM-01-Q1' }
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 403);
    assert.equal(outcome.code, 'subject_unauthorized');
    assert.match(outcome.message, /does not hold active review authorization for subject "chemistry"/);

    assert.equal(outcome.auditRecord.decision, 'denied');
    assert.equal(outcome.auditRecord.code, 'subject_unauthorized');
    assert.equal(outcome.auditRecord.callerUid, ACTIVE_PHYSICS_REVIEWER.uid);
    assert.equal(outcome.auditRecord.resolvedReviewerId, 'sme-phys-dr-sharma');
    assert.equal(outcome.auditRecord.requestedSubject, 'chemistry');
  }
});

test('sprint3d: 6. Missing authentication is rejected with 401 auth_required', async () => {
  const authority = new ServerReviewerAuthority([ACTIVE_PHYSICS_REVIEWER]);

  // Case A: undefined UID
  const outcomeUndefined = await authority.authorizeReviewer(
    undefined,
    'physics',
    { requestId: 'PHY-01-Q1' }
  );
  assert.equal(outcomeUndefined.ok, false);
  if (!outcomeUndefined.ok) {
    assert.equal(outcomeUndefined.status, 401);
    assert.equal(outcomeUndefined.code, 'auth_required');
    assert.equal(outcomeUndefined.auditRecord.callerUid, undefined);
    assert.equal(outcomeUndefined.auditRecord.decision, 'denied');
  }

  // Case B: empty string UID
  const outcomeEmpty = await authority.authorizeReviewer(
    '   ',
    'physics',
    { requestId: 'PHY-01-Q2' }
  );
  assert.equal(outcomeEmpty.ok, false);
  if (!outcomeEmpty.ok) {
    assert.equal(outcomeEmpty.status, 401);
    assert.equal(outcomeEmpty.code, 'auth_required');
  }
});

test('sprint3d: 7. Forged client reviewer ID is rejected with 403 reviewer_id_spoofing_detected', async () => {
  const authority = new ServerReviewerAuthority([ACTIVE_PHYSICS_REVIEWER]);

  // Authenticated caller is Dr. Sharma, but client claims to be Dr. Roy
  const outcome = await authority.authorizeReviewer(
    ACTIVE_PHYSICS_REVIEWER.uid,
    'physics',
    {
      claimedReviewerId: 'sme-chem-dr-roy',
      requestId: 'PHY-01-Q1',
    }
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 403);
    assert.equal(outcome.code, 'reviewer_id_spoofing_detected');
    assert.match(outcome.message, /does not match authenticated identity/);

    assert.equal(outcome.auditRecord.decision, 'denied');
    assert.equal(outcome.auditRecord.code, 'reviewer_id_spoofing_detected');
    assert.equal(outcome.auditRecord.callerUid, ACTIVE_PHYSICS_REVIEWER.uid);
    assert.equal(outcome.auditRecord.resolvedReviewerId, 'sme-phys-dr-sharma');
  }
});

test('sprint3d: 8. Registry unavailable fails closed with 503 registry_unavailable', async () => {
  const unavailableRegistry = new UnavailableReviewerRegistry('Database credentials missing.');
  const authority = new ServerReviewerAuthority(unavailableRegistry);

  const outcome = await authority.authorizeReviewer(
    ACTIVE_PHYSICS_REVIEWER.uid,
    'physics',
    { requestId: 'PHY-01-Q1' }
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 503);
    assert.equal(outcome.code, 'registry_unavailable');
    assert.match(outcome.message, /Reviewer registry is unavailable/);

    assert.equal(outcome.auditRecord.decision, 'error');
    assert.equal(outcome.auditRecord.code, 'registry_unavailable');
    assert.equal(outcome.auditRecord.allowed, false);
    assert.equal(outcome.auditRecord.callerUid, ACTIVE_PHYSICS_REVIEWER.uid);
  }
});

test('sprint3d: 9. Registry lookup failure fails closed with 503 registry_lookup_failed', async () => {
  // Fault-injecting mock registry
  const faultyRegistry: ReviewerRegistry = {
    registryVersion: '2026.1',
    async getReviewerByUid(_uid: string) {
      throw new Error('Connection reset by peer during registry query.');
    },
  };
  const authority = new ServerReviewerAuthority(faultyRegistry);

  const outcome = await authority.authorizeReviewer(
    ACTIVE_PHYSICS_REVIEWER.uid,
    'physics',
    { requestId: 'PHY-01-Q1' }
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 503);
    assert.equal(outcome.code, 'registry_lookup_failed');
    assert.match(outcome.message, /Connection reset by peer/);

    assert.equal(outcome.auditRecord.decision, 'error');
    assert.equal(outcome.auditRecord.code, 'registry_lookup_failed');
    assert.equal(outcome.auditRecord.allowed, false);
  }
});

test('sprint3d: 10. Authorization changes between requests are immediately enforced without caching', async () => {
  const registry = new MemoryReviewerRegistry([ACTIVE_PHYSICS_REVIEWER]);
  const authority = new ServerReviewerAuthority(registry);

  // Request 1: Active physics reviewer succeeds
  const firstOutcome = await authority.authorizeReviewer(
    ACTIVE_PHYSICS_REVIEWER.uid,
    'physics',
    { requestId: 'PHY-01-Q1' }
  );
  assert.equal(firstOutcome.ok, true);

  // Dynamic mutation: Admin revokes reviewer status
  registry.updateReviewerStatus(ACTIVE_PHYSICS_REVIEWER.uid, 'revoked', {
    actor: 'admin-lead',
    reason: 'Credential compromise reported.',
  });

  // Request 2: Immediate re-check fails with reviewer_revoked
  const secondOutcome = await authority.authorizeReviewer(
    ACTIVE_PHYSICS_REVIEWER.uid,
    'physics',
    { requestId: 'PHY-01-Q2' }
  );
  assert.equal(secondOutcome.ok, false);
  if (!secondOutcome.ok) {
    assert.equal(secondOutcome.status, 403);
    assert.equal(secondOutcome.code, 'reviewer_revoked');
  }

  // Dynamic mutation: Admin restores reviewer to active, but removes physics permission
  registry.updateReviewerStatus(ACTIVE_PHYSICS_REVIEWER.uid, 'active');
  registry.updateSubjectPermissions(ACTIVE_PHYSICS_REVIEWER.uid, [
    {
      subject: 'chemistry',
      active: true,
      grantedAt: '2026-03-01T00:00:00.000Z',
      grantedBy: 'admin-lead',
      canApprove: true,
      canRevoke: true,
    },
  ]);

  // Request 3: Attempting physics fails with subject_unauthorized
  const thirdOutcome = await authority.authorizeReviewer(
    ACTIVE_PHYSICS_REVIEWER.uid,
    'physics',
    { requestId: 'PHY-01-Q3' }
  );
  assert.equal(thirdOutcome.ok, false);
  if (!thirdOutcome.ok) {
    assert.equal(thirdOutcome.status, 403);
    assert.equal(thirdOutcome.code, 'subject_unauthorized');
  }

  // Request 4: Attempting chemistry now succeeds!
  const fourthOutcome = await authority.authorizeReviewer(
    ACTIVE_PHYSICS_REVIEWER.uid,
    'chemistry',
    { requestId: 'CHEM-01-Q1' }
  );
  assert.equal(fourthOutcome.ok, true);

  // Verify all 4 decisions in audit trail
  const trail = await authority.getAuditTrail();
  assert.equal(trail.length, 4);
  assert.equal(trail[0].decision, 'authorized');
  assert.equal(trail[1].decision, 'denied');
  assert.equal(trail[1].code, 'reviewer_revoked');
  assert.equal(trail[2].decision, 'denied');
  assert.equal(trail[2].code, 'subject_unauthorized');
  assert.equal(trail[3].decision, 'authorized');
});

test('sprint3d: 11. Audit records never contain secrets, tokens, or credentials', async () => {
  const authority = new ServerReviewerAuthority([ACTIVE_PHYSICS_REVIEWER]);

  await authority.authorizeReviewer(ACTIVE_PHYSICS_REVIEWER.uid, 'physics', { requestId: 'Q-AUDIT-1' });
  await authority.authorizeReviewer('uid-bad', 'physics', { requestId: 'Q-AUDIT-2' });

  const trail = await authority.getAuditTrail();
  assert.equal(trail.length, 2);

  for (const record of trail) {
    const raw = JSON.stringify(record);
    assert.ok(!raw.includes('password'), 'Audit trail must not contain password');
    assert.ok(!raw.includes('token'), 'Audit trail must not contain token');
    assert.ok(!raw.includes('secret'), 'Audit trail must not contain secret');
    assert.ok(!raw.includes('Bearer'), 'Audit trail must not contain Bearer headers');
    assert.ok(!raw.includes('privateKey'), 'Audit trail must not contain private keys');

    // Confirm presence of all required audit metadata
    assert.ok(record.auditId);
    assert.ok(record.timestamp);
    assert.ok(record.registryVersion);
    assert.ok(record.requestId);
    assert.ok(record.requestedSubject);
    assert.ok(typeof record.allowed === 'boolean');
    assert.ok(record.decision);
    assert.ok(record.code);
  }
});

test('sprint3d: 12. Reviewer profile schema validation in MemoryReviewerRegistry', () => {
  const registry = new MemoryReviewerRegistry([]);

  // Valid registration
  registry.registerReviewer(ACTIVE_PHYSICS_REVIEWER);
  assert.equal(registry.getAllReviewers().length, 1);

  // Missing or empty UID rejected
  assert.throws(() => {
    registry.registerReviewer({
      ...ACTIVE_PHYSICS_REVIEWER,
      uid: '',
    });
  }, /non-empty authenticated uid string/);

  // Invalid reviewer ID format rejected
  assert.throws(() => {
    registry.registerReviewer({
      ...ACTIVE_PHYSICS_REVIEWER,
      uid: 'uid-test-invalid',
      reviewerId: 'invalid-non-sme-id',
    });
  }, /Invalid canonical reviewerId format/);
});

test('sprint3d: 13. FirestoreReviewerRegistry integration with StrictFakeFirestore', async () => {
  const db = new StrictFakeFirestore();
  const registry = new FirestoreReviewerRegistry(db, '2026.1');
  const authority = new ServerReviewerAuthority(registry);

  // Initially empty in Firestore -> Unknown reviewer rejected
  const unauth = await authority.authorizeReviewer('uid-sme-phys-01', 'physics', { requestId: 'PHY-01-Q1' });
  assert.equal(unauth.ok, false);
  if (!unauth.ok) {
    assert.equal(unauth.code, 'not_authorized');
  }

  // Populate reviewer document in Firestore collection `trustedReviewers/uid-sme-phys-01`
  db.docs.set(`${TRUSTED_REVIEWER_COLLECTION}/uid-sme-phys-01`, {
    ...ACTIVE_PHYSICS_REVIEWER,
  });

  // Now retrieval succeeds and reviewer is authorized
  const authorized = await authority.authorizeReviewer('uid-sme-phys-01', 'physics', { requestId: 'PHY-01-Q1' });
  assert.equal(authorized.ok, true);
  if (authorized.ok) {
    assert.equal(authorized.profile.reviewerId, 'sme-phys-dr-sharma');
    assert.equal(authorized.profile.status, 'active');
  }

  // Querying with null db fails closed with registry_unavailable
  const brokenRegistry = new FirestoreReviewerRegistry(null as any);
  const brokenAuthority = new ServerReviewerAuthority(brokenRegistry);
  const failClosed = await brokenAuthority.authorizeReviewer('uid-sme-phys-01', 'physics');
  assert.equal(failClosed.ok, false);
  if (!failClosed.ok) {
    assert.equal(failClosed.code, 'registry_unavailable');
  }
});

test('sprint3d: 14. Action permission enforcement (canRevoke = false)', async () => {
  // Dr. Roy (Chemistry) has canRevoke = false
  const authority = new ServerReviewerAuthority([ACTIVE_CHEMISTRY_REVIEWER]);

  // Approval action succeeds
  const approveOutcome = await authority.authorizeReviewer(
    ACTIVE_CHEMISTRY_REVIEWER.uid,
    'chemistry',
    {
      requestId: 'CHEM-01-Q1',
      action: 'approve',
    }
  );
  assert.equal(approveOutcome.ok, true);

  // Revocation action is rejected
  const revokeOutcome = await authority.authorizeReviewer(
    ACTIVE_CHEMISTRY_REVIEWER.uid,
    'chemistry',
    {
      requestId: 'CHEM-01-Q1',
      action: 'revoke',
    }
  );
  assert.equal(revokeOutcome.ok, false);
  if (!revokeOutcome.ok) {
    assert.equal(revokeOutcome.status, 403);
    assert.equal(revokeOutcome.code, 'not_authorized');
    assert.match(revokeOutcome.message, /does not have revocation privileges/);
  }
});

test('sprint3d: 15. End-to-end service integration binds requestId to reviewer audit trail', async () => {
  const authority = new ServerReviewerAuthority([ACTIVE_PHYSICS_REVIEWER]);

  const stagedQ: AssessmentQuestion = {
    id: 'PHY-01-Q1',
    type: 'mcq',
    topicId: 'physics.units-measurements.dimensional-analysis',
    topicLabel: 'Dimensional Analysis',
    difficulty: 'medium',
    stem: 'What are the dimensions of Planck constant (h)?',
    options: ['[M L^2 T^-1]', '[M L T^-1]', '[M L^2 T^-2]', '[M L^-1 T^-2]'],
    correctOptionIndex: 0,
    explanation: 'From E = hv, h = E / v = [M L^2 T^-1].',
  };

  const stagedRecord: StagedQuestionRecord = {
    question: stagedQ,
    checkpointId: 'PHY-01-CP1',
    subject: 'physics',
    topicId: stagedQ.topicId,
    stageStatus: 'staged',
    stagedAt: '2026-11-01T00:00:00.000Z',
  };

  const contentRepo = new MemoryStagedContentRepository([stagedRecord]);
  const approvalRepo = new MemoryApprovalRecordRepository();
  const signingService = new LocalAsymmetricTestSigningService();

  const caller: VerifiedIdentity = { uid: ACTIVE_PHYSICS_REVIEWER.uid };
  const request: ContentApprovalRequest = {
    questionId: 'PHY-01-Q1',
    checkpointId: 'PHY-01-CP1',
    claimedReviewerId: 'sme-phys-dr-sharma',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  const result = await approveQuestionContent(
    request,
    caller,
    authority,
    contentRepo,
    approvalRepo,
    signingService
  );

  assert.equal(result.ok, true);

  // Verify that the authority recorded PHY-01-Q1 as the questionId and bound a fresh UUID requestId
  const auditEntries = await authority.getAuditTrail({ questionId: 'PHY-01-Q1' });
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].callerUid, ACTIVE_PHYSICS_REVIEWER.uid);
  assert.equal(auditEntries[0].resolvedReviewerId, 'sme-phys-dr-sharma');
  assert.equal(auditEntries[0].requestedSubject, 'physics');
  assert.equal(auditEntries[0].questionId, 'PHY-01-Q1');
  assert.notEqual(auditEntries[0].requestId, 'PHY-01-Q1');
  assert.match(auditEntries[0].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(auditEntries[0].decision, 'authorized');
});

// ============================================================================
// Sprint 3D.1.2 Remediation Tests
// ============================================================================

test('sprint3d.1.2: Phase 1 — Explicit action permissions and role non-inference', async () => {
  const profileBase: AuthorizedReviewerProfile = {
    uid: 'uid-test-perm-01',
    reviewerId: 'sme-phys-dr-test',
    displayName: 'Dr. Test',
    role: 'admin', // High-privilege role: MUST NOT infer canApprove or canRevoke!
    status: 'active',
    registryVersion: '2026.1',
    permissions: [],
  };

  // 1. canApprove === true -> Authorized for approve
  const profileApproveTrue: AuthorizedReviewerProfile = {
    ...profileBase,
    permissions: [
      {
        subject: 'physics',
        active: true,
        grantedAt: '2026-01-01T00:00:00.000Z',
        grantedBy: 'council',
        canApprove: true,
        canRevoke: false,
      },
    ],
  };
  const auth1 = new ServerReviewerAuthority([profileApproveTrue]);
  const res1 = await auth1.authorizeReviewer(profileBase.uid, 'physics', { action: 'approve' });
  assert.equal(res1.ok, true);

  // 2. canApprove === false -> Denied for approve (even though role is 'admin'!)
  const profileApproveFalse: AuthorizedReviewerProfile = {
    ...profileBase,
    permissions: [
      {
        subject: 'physics',
        active: true,
        grantedAt: '2026-01-01T00:00:00.000Z',
        grantedBy: 'council',
        canApprove: false,
        canRevoke: true,
      },
    ],
  };
  const auth2 = new ServerReviewerAuthority([profileApproveFalse]);
  const res2 = await auth2.authorizeReviewer(profileBase.uid, 'physics', { action: 'approve' });
  assert.equal(res2.ok, false);
  if (!res2.ok) {
    assert.equal(res2.status, 403);
    assert.equal(res2.code, 'not_authorized');
    assert.match(res2.message, /does not have approval privileges/);
  }

  // 3. canApprove === undefined (missing) -> Denied for approve
  const profileApproveMissing: AuthorizedReviewerProfile = {
    ...profileBase,
    permissions: [
      {
        subject: 'physics',
        active: true,
        grantedAt: '2026-01-01T00:00:00.000Z',
        grantedBy: 'council',
        // canApprove omitted
      },
    ],
  };
  const auth3 = new ServerReviewerAuthority([profileApproveMissing]);
  const res3 = await auth3.authorizeReviewer(profileBase.uid, 'physics', { action: 'approve' });
  assert.equal(res3.ok, false);
  if (!res3.ok) {
    assert.equal(res3.status, 403);
    assert.equal(res3.code, 'not_authorized');
  }

  // 4. canRevoke === true -> Authorized for revoke
  const profileRevokeTrue: AuthorizedReviewerProfile = {
    ...profileBase,
    permissions: [
      {
        subject: 'physics',
        active: true,
        grantedAt: '2026-01-01T00:00:00.000Z',
        grantedBy: 'council',
        canApprove: false,
        canRevoke: true,
      },
    ],
  };
  const auth4 = new ServerReviewerAuthority([profileRevokeTrue]);
  const res4 = await auth4.authorizeReviewer(profileBase.uid, 'physics', { action: 'revoke' });
  assert.equal(res4.ok, true);

  // 5. canRevoke === false -> Denied for revoke
  const profileRevokeFalse: AuthorizedReviewerProfile = {
    ...profileBase,
    permissions: [
      {
        subject: 'physics',
        active: true,
        grantedAt: '2026-01-01T00:00:00.000Z',
        grantedBy: 'council',
        canApprove: true,
        canRevoke: false,
      },
    ],
  };
  const auth5 = new ServerReviewerAuthority([profileRevokeFalse]);
  const res5 = await auth5.authorizeReviewer(profileBase.uid, 'physics', { action: 'revoke' });
  assert.equal(res5.ok, false);
  if (!res5.ok) {
    assert.equal(res5.status, 403);
    assert.equal(res5.code, 'not_authorized');
    assert.match(res5.message, /does not have revocation privileges/);
  }

  // 6. canRevoke === undefined (missing) -> Denied for revoke
  const auth6 = new ServerReviewerAuthority([profileApproveMissing]);
  const res6 = await auth6.authorizeReviewer(profileBase.uid, 'physics', { action: 'revoke' });
  assert.equal(res6.ok, false);
  if (!res6.ok) {
    assert.equal(res6.status, 403);
    assert.equal(res6.code, 'not_authorized');
  }
});

test('sprint3d.1.2: Phase 2 — validateReviewerProfile runtime schema validation', () => {
  const base = {
    uid: 'uid-val-01',
    reviewerId: 'sme-phys-dr-val',
    displayName: 'Dr. Val',
    status: 'active',
    permissions: [
      {
        subject: 'physics',
        active: true,
        grantedAt: '2026-01-01T00:00:00.000Z',
        grantedBy: 'council',
        canApprove: true,
      },
    ],
  };

  // Unsupported status
  assert.throws(
    () => validateReviewerProfile({ ...base, status: 'pending_approval' }),
    /unsupported status "pending_approval"/
  );

  // Invalid subject domain
  assert.throws(
    () =>
      validateReviewerProfile({
        ...base,
        permissions: [{ subject: 'astrology', active: true, grantedAt: 'x', grantedBy: 'y' }],
      }),
    /invalid subject domain "astrology"/
  );

  // Empty permissions array
  assert.throws(
    () => validateReviewerProfile({ ...base, permissions: [] }),
    /non-empty array/
  );

  // Missing displayName
  assert.throws(
    () => validateReviewerProfile({ ...base, displayName: '' }),
    /missing or empty "displayName"/
  );

  // UID mismatch
  assert.throws(
    () => validateReviewerProfile(base, 'different-uid'),
    /does not match requested UID/
  );
});

test('sprint3d.1.2: Phase 2 — FirestoreReviewerRegistry query uniqueness and error preservation', async () => {
  const store = new Map<string, Record<string, unknown>>();
  const mockDbWithWhere = {
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = store.get(`${col}/${id}`);
          return { exists: data !== undefined, data: () => data };
        },
      }),
      where: (field: string, _op: string, val: unknown) => ({
        limit: (n: number) => ({
          get: async () => {
            const matches = Array.from(store.entries())
              .filter(([k, v]) => k.startsWith(`${col}/`) && v[field] === val)
              .map(([_, v]) => ({ data: () => v }));
            return {
              empty: matches.length === 0,
              docs: matches.slice(0, n),
            };
          },
        }),
      }),
    }),
  } as any;
  const registry = new FirestoreReviewerRegistry(mockDbWithWhere);

  // Genuinely missing document returns null without error
  const missing = await registry.getReviewerByUid('uid-not-there');
  assert.equal(missing, null);

  const missingId = await registry.getReviewerById('sme-phys-dr-not-there');
  assert.equal(missingId, null);

  // Duplicate reviewer IDs in Firestore collection triggers RegistryLookupError
  const dupId = 'sme-chem-dr-dup';
  store.set(`${TRUSTED_REVIEWER_COLLECTION}/uid-dup-a`, {
    ...ACTIVE_CHEMISTRY_REVIEWER,
    uid: 'uid-dup-a',
    reviewerId: dupId,
  });
  store.set(`${TRUSTED_REVIEWER_COLLECTION}/uid-dup-b`, {
    ...ACTIVE_CHEMISTRY_REVIEWER,
    uid: 'uid-dup-b',
    reviewerId: dupId,
  });

  await assert.rejects(
    async () => {
      await registry.getReviewerById(dupId);
    },
    (err: unknown) => {
      assert.ok(err instanceof RegistryLookupError);
      assert.match((err as Error).message, /duplicate reviewerId/);
      return true;
    }
  );
});

test('sprint3d.1.2: Phase 3 — Durable audit repository and mandatory fail-closed policy', async () => {
  const db = new StrictFakeFirestore();
  const durableAuditRepo = new FirestoreReviewerAuditRepository(db);

  const testAuditRecord = {
    auditId: 'audit-fake-01',
    callerUid: 'uid-test-caller',
    resolvedReviewerId: 'sme-phys-dr-sharma',
    action: 'approve' as const,
    requestedSubject: 'physics' as const,
    requestId: 'PHY-01-Q1',
    decision: 'authorized' as const,
    code: 'authorized' as const,
    allowed: true,
    timestamp: new Date().toISOString(),
    registryVersion: '2026.1',
    reason: 'Authorized test reviewer',
  };

  await durableAuditRepo.recordDecision(testAuditRecord);

  // Verify write occurred in `reviewerAuthorizationAudit/audit-fake-01`
  const docData = db.docs.get(`${REVIEWER_AUDIT_COLLECTION}/audit-fake-01`);
  assert.ok(docData);
  assert.equal(docData.callerUid, 'uid-test-caller');
  assert.equal(docData.resolvedReviewerId, 'sme-phys-dr-sharma');
  assert.equal(docData.decision, 'authorized');

  // Mandatory audit failure causes authorization to fail closed with 503
  const failingAuditRepo = new FailingReviewerAuditRepository('Simulated disk full');
  const authorityWithFailingAudit = new ServerReviewerAuthority([ACTIVE_PHYSICS_REVIEWER], {
    auditRepository: failingAuditRepo,
  });

  const outcome = await authorityWithFailingAudit.authorizeReviewer(
    ACTIVE_PHYSICS_REVIEWER.uid,
    'physics',
    { action: 'approve', requestId: 'PHY-01-Q1' }
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 503);
    assert.equal(outcome.code, 'audit_persistence_failed');
    assert.match(outcome.message, /Mandatory authorization audit persistence failed/);
  }
});

test('sprint3d.1.2: Phase 4 — TOCTOU revocation race aborted during commit', async () => {
  const registry = new MemoryReviewerRegistry([ACTIVE_PHYSICS_REVIEWER]);
  const authority = new ServerReviewerAuthority(registry);
  const approvalRepo = new MemoryApprovalRecordRepository(registry);
  const contentRepo = new MemoryStagedContentRepository([
    {
      question: {
        id: 'PHY-RACE-Q1',
        type: 'mcq',
        topicId: 'physics.mechanics',
        topicLabel: 'Mechanics',
        difficulty: 'medium',
        stem: 'What is force?',
        options: ['ma', 'mv', 'm/a', 'm'],
        correctOptionIndex: 0,
        explanation: 'F = ma',
      },
      checkpointId: 'PHY-01-CP1',
      subject: 'physics',
      topicId: 'physics.mechanics',
      stageStatus: 'staged',
      stagedAt: '2026-11-01T00:00:00.000Z',
    },
  ]);

  // Intercepting signing service: simulates dynamic revocation occurring AFTER authorizeReviewer
  // succeeds, while KMS signing is underway, right before saveApproval commit.
  const baseSigning = new LocalAsymmetricTestSigningService();
  const raceSigningService = {
    isConfigured: true,
    serviceType: baseSigning.serviceType,
    signApprovalPayload: async (payload: any) => {
      // Admin revokes reviewer in registry between initial check and commit
      registry.updateReviewerStatus(ACTIVE_PHYSICS_REVIEWER.uid, 'revoked', {
        reason: 'Security breach compromise during signing',
      });
      return baseSigning.signApprovalPayload(payload);
    },
    verifyApprovalSignature: baseSigning.verifyApprovalSignature.bind(baseSigning),
  };

  const caller: VerifiedIdentity = { uid: ACTIVE_PHYSICS_REVIEWER.uid };
  const request: ContentApprovalRequest = {
    questionId: 'PHY-RACE-Q1',
    checkpointId: 'PHY-01-CP1',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
  };

  // Attempt approval through content approval service:
  const approvalOutcome = await approveQuestionContent(
    request,
    caller,
    authority,
    contentRepo,
    approvalRepo,
    raceSigningService as any
  );

  // Commit-time check detects status is revoked -> aborts with 403
  assert.equal(approvalOutcome.ok, false);
  if (!approvalOutcome.ok) {
    assert.equal(approvalOutcome.status, 403);
    assert.equal(approvalOutcome.code, 'reviewer_authorization_revoked');
    assert.match(approvalOutcome.error, /required "active"/);
  }

  // Ensure active approval does NOT exist
  const active = await approvalRepo.getActiveApproval('PHY-RACE-Q1');
  assert.equal(active, null);
});

test('sprint3d.1.2: Phase 7 — HTTP Express integration tests (/api/content/review/approve and /revoke)', async () => {
  const stagedQ: AssessmentQuestion = {
    id: 'PHY-HTTP-Q1',
    type: 'mcq',
    topicId: 'physics.units-measurements.dimensional-analysis',
    topicLabel: 'Dimensional Analysis',
    difficulty: 'medium',
    stem: 'What are the dimensions of Planck constant (h)?',
    options: ['[M L^2 T^-1]', '[M L T^-1]', '[M L^2 T^-2]', '[M L^-1 T^-2]'],
    correctOptionIndex: 0,
    explanation: 'From E = hv, h = E / v = [M L^2 T^-1].',
  };

  const stagedRecord: StagedQuestionRecord = {
    question: stagedQ,
    checkpointId: 'PHY-01-CP1',
    subject: 'physics',
    topicId: stagedQ.topicId,
    stageStatus: 'staged',
    stagedAt: '2026-11-01T00:00:00.000Z',
  };

  const contentRepo = new MemoryStagedContentRepository([stagedRecord]);
  const signingService = new LocalAsymmetricTestSigningService();

  const mockUsers: Record<string, VerifiedIdentity> = {
    'token-physics-dr-sharma': { uid: ACTIVE_PHYSICS_REVIEWER.uid, email: ACTIVE_PHYSICS_REVIEWER.email },
    'token-unauthorized-student': { uid: 'uid-student-alice', email: 'alice@student.org' },
    'token-revoked-reviewer': { uid: REVOKED_REVIEWER.uid, email: 'revoked@learnmate.org' },
  };

  async function createTestApp(overrideDeps?: {
    authority?: ServerReviewerAuthority;
    approvalRepo?: MemoryApprovalRecordRepository;
  }) {
    const registry = new MemoryReviewerRegistry([
      ACTIVE_PHYSICS_REVIEWER,
      REVOKED_REVIEWER,
    ]);
    const authority = overrideDeps?.authority || new ServerReviewerAuthority(registry);
    const approvalRepo = overrideDeps?.approvalRepo || new MemoryApprovalRecordRepository(registry);

    const app = express();
    const accessControl = createApiAccessControl({
      verifyIdToken: async (token) => {
        const u = mockUsers[token];
        if (!u) {
          const err = new Error('Invalid token') as Error & { code: string };
          err.code = 'auth/invalid-id-token';
          throw err;
        }
        return u;
      },
      quotaStore: new MemoryDailyQuotaStore(),
      ipLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, max: 100 }),
      userLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, max: 100 }),
      dailyUnitLimit: 100,
      isFeatureEnabled: () => true,
      diagnosticsEnabled: false,
      adminUids: new Set<string>(),
    });

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
    return { app, authority, approvalRepo };
  }

  // 1. Missing authentication returns 401
  const { app } = await createTestApp();
  await withTestServer(app, async (baseUrl) => {
    const unauthRes = await fetch(`${baseUrl}/api/content/review/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: 'PHY-HTTP-Q1', checkpointId: 'PHY-01-CP1' }),
    });
    assert.equal(unauthRes.status, 401);
    const unauthBody = await unauthRes.json();
    assert.equal(unauthBody.code, 'auth_required');

    // 2. Invalid bearer token returns 401
    const invalidTokenRes = await fetch(`${baseUrl}/api/content/review/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-garbage-token',
      },
      body: JSON.stringify({ questionId: 'PHY-HTTP-Q1', checkpointId: 'PHY-01-CP1' }),
    });
    assert.equal(invalidTokenRes.status, 401);
    const invalidTokenBody = await invalidTokenRes.json();
    assert.equal(invalidTokenBody.code, 'invalid_token');

    // 3. Authenticated but unauthorized user returns 403 not_authorized
    const unauthReviewerRes = await fetch(`${baseUrl}/api/content/review/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-unauthorized-student',
      },
      body: JSON.stringify({
        questionId: 'PHY-HTTP-Q1',
        checkpointId: 'PHY-01-CP1',
        mathematicalCheckConfirmed: true,
        pedagogicalReviewConfirmed: true,
      }),
    });
    assert.equal(unauthReviewerRes.status, 403);
    const unauthReviewerBody = await unauthReviewerRes.json();
    assert.equal(unauthReviewerBody.code, 'not_authorized');

    // 4. Revoked reviewer returns 403 reviewer_revoked
    const revokedRes = await fetch(`${baseUrl}/api/content/review/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-revoked-reviewer',
      },
      body: JSON.stringify({
        questionId: 'PHY-HTTP-Q1',
        checkpointId: 'PHY-01-CP1',
        mathematicalCheckConfirmed: true,
        pedagogicalReviewConfirmed: true,
      }),
    });
    assert.equal(revokedRes.status, 403);
    const revokedBody = await revokedRes.json();
    assert.equal(revokedBody.code, 'reviewer_revoked');

    // 5. Authorized reviewer succeeds with 200
    const okRes = await fetch(`${baseUrl}/api/content/review/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-physics-dr-sharma',
      },
      body: JSON.stringify({
        questionId: 'PHY-HTTP-Q1',
        checkpointId: 'PHY-01-CP1',
        claimedReviewerId: 'sme-phys-dr-sharma',
        mathematicalCheckConfirmed: true,
        pedagogicalReviewConfirmed: true,
      }),
    });
    assert.equal(okRes.status, 200);
    const okBody = await okRes.json();
    assert.equal(okBody.ok, true);
    assert.equal(okBody.approvalRecord.questionId, 'PHY-HTTP-Q1');
    assert.equal(okBody.approvalRecord.reviewerId, 'sme-phys-dr-sharma');

    // 6. Revoke approval endpoint succeeds for authorized reviewer
    const revokeRes = await fetch(`${baseUrl}/api/content/review/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-physics-dr-sharma',
      },
      body: JSON.stringify({
        questionId: 'PHY-HTTP-Q1',
        contentDigest: okBody.approvalRecord.contentDigest,
        reason: 'Typo correction needed in explanation',
      }),
    });
    assert.equal(revokeRes.status, 200);
    const revokeBody = await revokeRes.json();
    assert.equal(revokeBody.ok, true);
    assert.equal(revokeBody.approvalRecord.lifecycleStatus, 'revoked');
  });

  // 7. Registry outage returns 503
  const brokenRegistryApp = (
    await createTestApp({
      authority: new ServerReviewerAuthority(new UnavailableReviewerRegistry('Registry DB offline')),
    })
  ).app;
  await withTestServer(brokenRegistryApp, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/content/review/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-physics-dr-sharma',
      },
      body: JSON.stringify({
        questionId: 'PHY-HTTP-Q1',
        checkpointId: 'PHY-01-CP1',
        mathematicalCheckConfirmed: true,
        pedagogicalReviewConfirmed: true,
      }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'registry_unavailable');
  });

  // 8. Audit outage returns 503
  const failingAuditApp = (
    await createTestApp({
      authority: new ServerReviewerAuthority([ACTIVE_PHYSICS_REVIEWER], {
        auditRepository: new FailingReviewerAuditRepository('Audit disk write failure'),
      }),
    })
  ).app;
  await withTestServer(failingAuditApp, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/content/review/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-physics-dr-sharma',
      },
      body: JSON.stringify({
        questionId: 'PHY-HTTP-Q1',
        checkpointId: 'PHY-01-CP1',
        mathematicalCheckConfirmed: true,
        pedagogicalReviewConfirmed: true,
      }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'audit_persistence_failed');
  });
});

