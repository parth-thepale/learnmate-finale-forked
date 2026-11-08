import { randomUUID } from 'node:crypto';
import { computeQuestionContentDigest } from '../../features/roadmaps/engine/contentGovernance.ts';
import type { VerifiedIdentity } from '../authMiddleware.ts';
import type {
  ApprovalRecordRepository,
  ApprovalSigningPayload,
  AuthoritativeContentRepository,
  ContentApprovalOutcome,
  ContentApprovalRequest,
  ContentRevocationOutcome,
  ContentRevocationRequest,
  ContentSigningService,
  ReviewerAuthority,
  ReviewerAuthorizationAuditRecord,
  ServerApprovalRecord,
  SubjectDomain,
} from './types.ts';
import { isReviewerCommitFailureCode } from './types.ts';
import { generateAuditId } from './reviewerAuthority.ts';

const VALID_SUBJECTS = new Set<SubjectDomain>(['physics', 'chemistry', 'mathematics']);

/**
 * Authoritative Server-Side Content Approval Service (P0).
 *
 * ELIMINATES CLIENT-SUPPLIED CONTENT SIGNING ORACLE:
 * 1. Client specifies `questionId` and `checkpointId` (and optional expected version).
 * 2. Server retrieves the authoritative question from AuthoritativeContentRepository.
 * 3. Client-supplied question JSON is never accepted or treated as authoritative.
 * 4. Unknown question IDs or checkpoint IDs are rejected with 404 question_not_found.
 * 5. Recomputes canonical SHA-256 digest directly from authoritative repository question.
 * 6. Signs compound payload binding questionId, contentDigest, checkpointId, topicId, subject.
 * 7. Persists approval record to ApprovalRecordRepository with atomic duplicate and lifecycle checks.
 */
export async function approveQuestionContent(
  request: ContentApprovalRequest,
  caller: VerifiedIdentity | undefined,
  authority: ReviewerAuthority,
  contentRepository: AuthoritativeContentRepository,
  approvalRepository: ApprovalRecordRepository,
  signingService: ContentSigningService
): Promise<ContentApprovalOutcome> {
  // 1. Authentication check
  if (!caller || !caller.uid) {
    return {
      ok: false,
      status: 401,
      code: 'auth_required',
      error: 'Authentication required. Please sign in with an authorized SME reviewer account.',
    };
  }

  // 2. Request payload validation
  if (!request || typeof request !== 'object') {
    return {
      ok: false,
      status: 400,
      code: 'invalid_request',
      error: 'Approval request body is missing or malformed.',
    };
  }

  // Client-supplied question text is strictly rejected (anti-oracle guard)
  if ('question' in request && request.question !== undefined) {
    return {
      ok: false,
      status: 400,
      code: 'client_content_prohibited',
      error: 'Client cannot supply question definition. Approvals must reference existing staged question IDs.',
    };
  }

  if (typeof request.questionId !== 'string' || request.questionId.trim().length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_question_id',
      error: 'A valid questionId must be specified to approve authoritative content.',
    };
  }

  if (typeof request.checkpointId !== 'string' || request.checkpointId.trim().length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_checkpoint_id',
      error: 'A valid checkpointId must be specified for placement binding.',
    };
  }

  if (request.mathematicalCheckConfirmed !== true) {
    return {
      ok: false,
      status: 400,
      code: 'unconfirmed_check',
      error: 'mathematicalCheckConfirmed must be true to approve educational content.',
    };
  }

  if (request.pedagogicalReviewConfirmed !== true) {
    return {
      ok: false,
      status: 400,
      code: 'unconfirmed_review',
      error: 'pedagogicalReviewConfirmed must be true to approve educational content.',
    };
  }

  const questionId = request.questionId.trim();
  const checkpointId = request.checkpointId.trim();
  const attemptId = randomUUID();

  // 3. Retrieve authoritative staged question from repository (Anti-Oracle)
  const stagedRecord = await contentRepository.getStagedQuestion(checkpointId, questionId);
  if (!stagedRecord) {
    return {
      ok: false,
      status: 404,
      code: 'question_not_found',
      error: `Question "${questionId}" was not found in staged content for checkpoint "${checkpointId}".`,
    };
  }

  const { question, subject, topicId } = stagedRecord;

  if (!VALID_SUBJECTS.has(subject)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_subject',
      error: `Authoritative question subject "${subject}" is not a recognized subject domain.`,
    };
  }

  // 4. Reviewer authorization check (deny-by-default for caller's permissions in this subject)
  const authOutcome = await authority.authorizeReviewer(
    caller.uid,
    subject,
    {
      claimedReviewerId: request.claimedReviewerId,
      requestId: attemptId,
      questionId,
      action: 'approve',
    }
  );

  if (!authOutcome.ok) {
    return {
      ok: false,
      status: authOutcome.status,
      code: authOutcome.code,
      error: authOutcome.message,
    };
  }

  const reviewerProfile = authOutcome.profile;

  // 5. Server-side SHA-256 digest recomputation directly on authoritative question
  const recomputedDigest = computeQuestionContentDigest(question);
  if (!recomputedDigest || !recomputedDigest.startsWith('sha256:')) {
    return {
      ok: false,
      status: 500,
      code: 'digest_computation_failed',
      error: 'Failed to compute canonical cryptographic digest for authoritative question.',
    };
  }

  // 6. Optimistic concurrency check (if client specified expected version)
  if (
    request.expectedContentVersion &&
    request.expectedContentVersion.trim() !== recomputedDigest
  ) {
    return {
      ok: false,
      status: 409,
      code: 'version_conflict',
      error: `Expected content version "${request.expectedContentVersion}" does not match authoritative question digest "${recomputedDigest}".`,
    };
  }

  // 7. Cryptographic signing gate (fails closed if unconfigured)
  if (!signingService.isConfigured) {
    return {
      ok: false,
      status: 503,
      code: 'signing_unavailable',
      error: 'Content signing service is unconfigured. Approvals cannot be issued without managed Cloud KMS asymmetric signatures.',
    };
  }

  const serverTimestamp = new Date().toISOString();

  // Compound signing payload binding question ID, content, and curriculum placement
  const signingPayload: ApprovalSigningPayload = {
    schemaVersion: 2,
    questionId: question.id,
    contentDigest: recomputedDigest,
    contentVersion: recomputedDigest,
    checkpointId,
    topicId,
    subject,
    reviewerUid: reviewerProfile.uid,
    reviewerId: reviewerProfile.reviewerId,
    reviewedAt: serverTimestamp,
  };

  const signResult = await signingService.signApprovalPayload(signingPayload);
  if (!signResult.ok) {
    return {
      ok: false,
      status: 500,
      code: signResult.code,
      error: `Cryptographic signing failed: ${signResult.error}`,
    };
  }

  // 8. Assemble ServerApprovalRecord
  const approvalRecord: ServerApprovalRecord = {
    schemaVersion: 2,
    reviewStatus: 'verified',
    questionId: question.id,
    reviewerUid: reviewerProfile.uid,
    reviewerId: reviewerProfile.reviewerId,
    subject,
    checkpointId,
    topicId,
    contentDigest: recomputedDigest,
    contentVersion: recomputedDigest,
    reviewedAt: serverTimestamp,
    reviewNotes: request.reviewNotes?.trim() || undefined,
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
    signature: signResult.signature,
    signingKeyId: signResult.keyId,
    signatureAlgorithm: signResult.algorithm,
    lifecycleStatus: 'approved',
  };

  // 9. Persist to ApprovalRecordRepository (with duplicate & concurrency protection, plus TOCTOU commit check)
  const saveOutcome = await approvalRepository.saveApproval(approvalRecord, {
    expectedCurrentVersion: request.expectedContentVersion,
    expectedReviewer: {
      uid: reviewerProfile.uid,
      reviewerId: reviewerProfile.reviewerId,
      subject,
      expectedRecordVersion: reviewerProfile.recordVersion,
      expectedRegistryVersion: reviewerProfile.registryVersion,
    },
  });

  if (!saveOutcome.ok) {
    if (isReviewerCommitFailureCode(saveOutcome.code)) {
      const commitDeniedEvent: ReviewerAuthorizationAuditRecord = {
        auditId: generateAuditId(),
        callerUid: caller.uid,
        resolvedReviewerId: reviewerProfile.reviewerId,
        action: 'approve',
        decision: 'denied',
        code: saveOutcome.code,
        allowed: false,
        requestedSubject: subject,
        requestId: attemptId,
        questionId,
        timestamp: new Date().toISOString(),
        registryVersion: reviewerProfile.registryVersion || authority.registryVersion || '2026.1',
        reason: saveOutcome.error,
      };

      try {
        if (typeof authority.recordDecision === 'function') {
          await authority.recordDecision(commitDeniedEvent);
        } else if (typeof authority.getAuditRepository === 'function') {
          const auditRepo = authority.getAuditRepository();
          if (auditRepo) {
            await auditRepo.recordDecision(commitDeniedEvent);
          } else {
            throw new Error('Reviewer authority returned null/undefined audit repository.');
          }
        } else {
          throw new Error('Reviewer authority does not provide an audit repository for mandatory audit persistence.');
        }
      } catch (auditErr) {
        return {
          ok: false,
          status: 503,
          code: 'audit_persistence_failed',
          error: `Mandatory commit-time authorization audit persistence failed: ${
            auditErr instanceof Error ? auditErr.message : String(auditErr)
          }`,
        };
      }
    }

    const status =
      saveOutcome.code === 'concurrency_conflict' || saveOutcome.code === 'expected_version_required'
        ? 409
        : isReviewerCommitFailureCode(saveOutcome.code)
        ? 403
        : saveOutcome.code === 'repository_unavailable'
        ? 503
        : 400;
    return {
      ok: false,
      status,
      code: saveOutcome.code,
      error: saveOutcome.error,
    };
  }

  return {
    ok: true,
    approvalRecord: saveOutcome.record,
    isDuplicate: saveOutcome.isDuplicate,
    message: saveOutcome.isDuplicate
      ? `Approval record for ${question.id} already verified (idempotent).`
      : `Question ${question.id} successfully approved and signed by ${reviewerProfile.reviewerId} for ${checkpointId}.`,
  };
}

/**
 * Revokes an existing question approval.
 */
export async function revokeQuestionApproval(
  request: ContentRevocationRequest,
  caller: VerifiedIdentity | undefined,
  authority: ReviewerAuthority,
  approvalRepository: ApprovalRecordRepository
): Promise<ContentRevocationOutcome> {
  if (!caller || !caller.uid) {
    return {
      ok: false,
      status: 401,
      code: 'auth_required',
      error: 'Authentication required to revoke approvals.',
    };
  }

  if (!request.questionId || !request.contentDigest || !request.reason) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_request',
      error: 'questionId, contentDigest, and reason are required to revoke an approval.',
    };
  }

  const existing = await approvalRepository.getApprovalByDigest(
    request.questionId,
    request.contentDigest
  );
  if (!existing) {
    return {
      ok: false,
      status: 404,
      code: 'record_not_found',
      error: `Approval record for question "${request.questionId}" not found.`,
    };
  }

  const attemptId = randomUUID();

  // Authorize reviewer for the question's subject
  const authOutcome = await authority.authorizeReviewer(
    caller.uid,
    existing.subject,
    {
      claimedReviewerId: request.claimedReviewerId,
      requestId: attemptId,
      questionId: request.questionId,
      action: 'revoke',
    }
  );
  if (!authOutcome.ok) {
    return {
      ok: false,
      status: authOutcome.status,
      code: authOutcome.code,
      error: authOutcome.message,
    };
  }

  const reviewerProfile = authOutcome.profile;
  const revokeOutcome = await approvalRepository.revokeApproval(
    request.questionId,
    request.contentDigest,
    {
      revokedBy: caller.uid,
      reason: request.reason,
    },
    {
      expectedReviewer: {
        uid: reviewerProfile.uid,
        reviewerId: reviewerProfile.reviewerId,
        subject: existing.subject,
        expectedRecordVersion: reviewerProfile.recordVersion,
        expectedRegistryVersion: reviewerProfile.registryVersion,
        requireCanRevoke: true,
      },
    }
  );

  if (!revokeOutcome.ok) {
    if (isReviewerCommitFailureCode(revokeOutcome.code)) {
      const commitDeniedEvent: ReviewerAuthorizationAuditRecord = {
        auditId: generateAuditId(),
        callerUid: caller.uid,
        resolvedReviewerId: reviewerProfile.reviewerId,
        action: 'revoke',
        decision: 'denied',
        code: revokeOutcome.code,
        allowed: false,
        requestedSubject: existing.subject,
        requestId: attemptId,
        questionId: request.questionId,
        timestamp: new Date().toISOString(),
        registryVersion: reviewerProfile.registryVersion || authority.registryVersion || '2026.1',
        reason: revokeOutcome.error,
      };

      try {
        if (typeof authority.recordDecision === 'function') {
          await authority.recordDecision(commitDeniedEvent);
        } else if (typeof authority.getAuditRepository === 'function') {
          const auditRepo = authority.getAuditRepository();
          if (auditRepo) {
            await auditRepo.recordDecision(commitDeniedEvent);
          } else {
            throw new Error('Reviewer authority returned null/undefined audit repository.');
          }
        } else {
          throw new Error('Reviewer authority does not provide an audit repository for mandatory audit persistence.');
        }
      } catch (auditErr) {
        return {
          ok: false,
          status: 503,
          code: 'audit_persistence_failed',
          error: `Mandatory commit-time revocation audit persistence failed: ${
            auditErr instanceof Error ? auditErr.message : String(auditErr)
          }`,
        };
      }
    }

    const status =
      isReviewerCommitFailureCode(revokeOutcome.code)
        ? 403
        : revokeOutcome.code === 'repository_unavailable'
        ? 503
        : revokeOutcome.code === 'record_not_found'
        ? 404
        : 400;
    return {
      ok: false,
      status,
      code: revokeOutcome.code,
      error: revokeOutcome.error,
    };
  }

  return {
    ok: true,
    approvalRecord: revokeOutcome.record,
    message: `Approval for question ${request.questionId} successfully revoked.`,
  };
}
