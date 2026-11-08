import type {
  AssessmentQuestion,
  Checkpoint,
  PracticeQuestion,
} from '../../features/roadmaps/types/checkpoint.types.ts';

export type SubjectDomain = 'physics' | 'chemistry' | 'mathematics';

export type ReviewerStatus = 'active' | 'disabled' | 'revoked' | 'suspended';

export type ReviewerRole = 'reviewer' | 'senior_reviewer' | 'lead_reviewer' | 'admin';

export interface ReviewerSubjectPermission {
  readonly subject: SubjectDomain;
  readonly active: boolean;
  readonly grantedAt: string;
  readonly grantedBy: string;
  readonly canApprove?: boolean;
  readonly canRevoke?: boolean;
}

export interface AuthorizedReviewerProfile {
  readonly uid: string;
  readonly reviewerId: string; // The canonical SME ID, e.g. 'sme-phys-dr-sharma'
  readonly displayName: string;
  readonly email?: string;
  readonly role?: ReviewerRole;
  readonly permissions: readonly ReviewerSubjectPermission[];
  readonly status: ReviewerStatus;
  readonly registryVersion?: string;
  readonly recordVersion?: number;
  readonly createdAt?: string;
  readonly createdBy?: string;
  readonly updatedAt?: string;
  readonly updatedBy?: string;
  readonly revokedAt?: string;
  readonly revokedBy?: string;
  readonly revocationReason?: string;
  readonly disabledAt?: string;
  readonly disabledBy?: string;
  readonly disableReason?: string;
}

export type ReviewerAuthorizationDecision = 'authorized' | 'denied' | 'error';

export type ReviewerCommitFailureCode =
  | 'reviewer_authorization_revoked'
  | 'reviewer_permission_denied'
  | 'reviewer_subject_unauthorized'
  | 'reviewer_not_found'
  | 'reviewer_uid_mismatch'
  | 'reviewer_id_mismatch';

export function isReviewerCommitFailureCode(code: string): code is ReviewerCommitFailureCode {
  return (
    code === 'reviewer_authorization_revoked' ||
    code === 'reviewer_permission_denied' ||
    code === 'reviewer_subject_unauthorized' ||
    code === 'reviewer_not_found' ||
    code === 'reviewer_uid_mismatch' ||
    code === 'reviewer_id_mismatch'
  );
}

export type ReviewerAuthorizationFailureCode =
  | 'auth_required'
  | 'not_authorized'
  | 'subject_unauthorized'
  | 'reviewer_suspended'
  | 'reviewer_disabled'
  | 'reviewer_revoked'
  | 'reviewer_id_spoofing_detected'
  | 'registry_unavailable'
  | 'registry_lookup_failed'
  | 'audit_persistence_failed'
  | ReviewerCommitFailureCode;

export interface ReviewerAuthorizationAuditRecord {
  readonly auditId: string;
  readonly callerUid?: string;
  readonly resolvedReviewerId?: string;
  readonly action: 'approve' | 'revoke';
  readonly decision: ReviewerAuthorizationDecision;
  readonly code: ReviewerAuthorizationFailureCode | 'authorized';
  readonly allowed: boolean;
  readonly requestedSubject: SubjectDomain;
  readonly requestId: string; // unique UUID per attempt
  readonly questionId?: string; // dedicated question ID
  readonly timestamp: string; // ISO 8601
  readonly registryVersion: string;
  readonly reason?: string;
}

export interface ReviewerAuthorizationContext {
  readonly claimedReviewerId?: string;
  readonly requestId?: string;
  readonly questionId?: string;
  readonly action?: 'approve' | 'revoke';
}

export type ReviewerAuthorizationOutcome =
  | { ok: true; profile: AuthorizedReviewerProfile; auditRecord: ReviewerAuthorizationAuditRecord }
  | {
      ok: false;
      status: 401 | 403 | 500 | 503;
      code: ReviewerAuthorizationFailureCode;
      message: string;
      auditRecord: ReviewerAuthorizationAuditRecord;
    };

export interface ReviewerRegistry {
  readonly registryVersion: string;
  getReviewerByUid(uid: string): Promise<AuthorizedReviewerProfile | null>;
  getReviewerById?(reviewerId: string): Promise<AuthorizedReviewerProfile | null>;
}

export interface ReviewerAuditRepository {
  recordDecision(event: ReviewerAuthorizationAuditRecord): Promise<void>;
  getAuditEvents(filter?: {
    callerUid?: string;
    requestId?: string;
    questionId?: string;
    limit?: number;
  }): Promise<readonly ReviewerAuthorizationAuditRecord[]>;
}

export interface ReviewerAuthority {
  readonly registryVersion?: string;
  getReviewerProfile(uid: string): Promise<AuthorizedReviewerProfile | null>;
  authorizeReviewer(
    uid: string | undefined,
    subject: SubjectDomain,
    context?: string | ReviewerAuthorizationContext
  ): Promise<ReviewerAuthorizationOutcome>;
  recordDecision?(record: ReviewerAuthorizationAuditRecord): Promise<void>;
  getAuditRepository?(): ReviewerAuditRepository;
  getAuditTrail?(filter?: {
    callerUid?: string;
    requestId?: string;
    questionId?: string;
    decision?: ReviewerAuthorizationDecision;
  }): Promise<readonly ReviewerAuthorizationAuditRecord[]>;
}

// ============================================================================
// Authoritative Staged Content Source (P0)
// ============================================================================

export interface StagedQuestionRecord {
  readonly question: AssessmentQuestion | PracticeQuestion;
  readonly checkpointId: string;
  readonly subject: SubjectDomain;
  readonly topicId: string;
  readonly stageStatus: 'staged' | 'draft' | 'under_review';
  readonly stagedAt: string;
  readonly stagingAuthor?: string;
}

export interface AuthoritativeContentRepository {
  getStagedQuestion(
    checkpointId: string,
    questionId: string
  ): Promise<StagedQuestionRecord | null>;

  getCheckpoint(checkpointId: string): Promise<Checkpoint | null>;
}

// ============================================================================
// Cryptographic Signing Contracts (P0)
// ============================================================================

export interface ApprovalSigningPayload {
  readonly schemaVersion: 2;
  readonly questionId: string; // Bound in Sprint 3C.1
  readonly contentDigest: string; // sha256:...
  readonly contentVersion: string; // sha256:...
  readonly checkpointId: string;
  readonly topicId: string;
  readonly subject: SubjectDomain;
  readonly reviewerUid: string;
  readonly reviewerId: string;
  readonly reviewedAt: string; // ISO 8601
}

export interface ServerApprovalRecord {
  readonly schemaVersion: 2;
  readonly reviewStatus: 'verified';
  readonly questionId: string; // Bound in Sprint 3C.1
  readonly reviewerUid: string;
  readonly reviewerId: string;
  readonly subject: SubjectDomain;
  readonly checkpointId: string;
  readonly topicId: string;
  readonly contentDigest: string; // sha256:...
  readonly contentVersion: string; // sha256:...
  readonly reviewedAt: string; // ISO 8601
  readonly reviewNotes?: string;
  readonly mathematicalCheckConfirmed: boolean;
  readonly pedagogicalReviewConfirmed: boolean;
  readonly signature?: string;
  readonly signingKeyId?: string;
  readonly signatureAlgorithm?: string;
  readonly lifecycleStatus?: ApprovalLifecycleStatus;
}

export type SigningOutcome =
  | { ok: true; signature: string; keyId: string; algorithm: string }
  | { ok: false; code: 'signing_disabled' | 'kms_unconfigured' | 'signing_failed'; error: string };

export interface ContentSigningService {
  readonly isConfigured: boolean;
  readonly serviceType: 'cloud_kms' | 'disabled' | 'local_asymmetric_test';
  signApprovalPayload(payload: ApprovalSigningPayload): Promise<SigningOutcome>;
  verifyApprovalSignature(payload: ApprovalSigningPayload, signature: string, keyId?: string): Promise<boolean>;
}

// ============================================================================
// Approval Persistence & Lifecycle Contracts (P0)
// ============================================================================

export type ApprovalLifecycleStatus = 'staged' | 'approved' | 'revoked' | 'superseded';

export interface ApprovalAuditEvent {
  readonly eventId: string;
  readonly eventType: 'approved' | 'revoked' | 'superseded' | 're_approved';
  readonly questionId: string;
  readonly contentDigest: string;
  readonly versionNumber: number;
  readonly sequenceNumber: number;
  readonly timestamp: string;
  readonly actorUid: string;
  readonly actorRole?: string;
  readonly details?: string;
}

export interface AuditHistoryOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly direction?: 'asc' | 'desc';
}

export interface PersistedApprovalRecord extends ServerApprovalRecord {
  readonly lifecycleStatus: ApprovalLifecycleStatus;
  readonly supersededBy?: string; // Digest of replacing approval
  readonly revokedAt?: string;
  readonly revokedBy?: string;
  readonly revocationReason?: string;
  readonly auditHistory: readonly ApprovalAuditEvent[];
  readonly versionNumber?: number; // Monotonic version sequence counter
}

export interface FirestoreActiveApprovalDoc {
  readonly docType: 'active_pointer';
  readonly questionId: string;
  readonly activeDigest: string | null;
  readonly lifecycleStatus: 'approved' | 'revoked';
  readonly versionNumber: number;
  readonly auditCount: number;
  readonly record: PersistedApprovalRecord | null;
  readonly updatedAt: string;
}

export interface FirestoreVersionApprovalDoc extends PersistedApprovalRecord {
  readonly docType: 'version_record';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FirestoreAuditEventDoc extends ApprovalAuditEvent {
  readonly docType: 'audit_event';
  readonly createdAt: string;
}

export interface ExpectedReviewerCommitCheck {
  readonly uid: string;
  readonly reviewerId: string;
  readonly subject: SubjectDomain;
  readonly expectedRecordVersion?: number;
  readonly expectedRegistryVersion?: string;
  readonly requireCanRevoke?: boolean;
}

export interface SaveApprovalOptions {
  readonly expectedCurrentVersion?: string;
  readonly expectedReviewer?: ExpectedReviewerCommitCheck;
}

export interface RevokeApprovalOptions {
  readonly expectedReviewer?: ExpectedReviewerCommitCheck;
}

export type SaveApprovalOutcome =
  | { ok: true; record: PersistedApprovalRecord; isDuplicate: boolean }
  | {
      ok: false;
      code:
        | 'stale_version_conflict'
        | 'already_revoked'
        | 'concurrency_conflict'
        | 'expected_version_required'
        | 'invalid_question_id'
        | 'invalid_content_digest'
        | 'repository_unavailable'
        | ReviewerCommitFailureCode;
      error: string;
    };

export type RevokeApprovalOutcome =
  | { ok: true; record: PersistedApprovalRecord }
  | {
      ok: false;
      code:
        | 'record_not_found'
        | 'already_revoked'
        | 'invalid_question_id'
        | 'invalid_content_digest'
        | 'repository_unavailable'
        | ReviewerCommitFailureCode;
      error: string;
    };

export interface ApprovalRecordRepository {
  getActiveApproval(questionId: string): Promise<PersistedApprovalRecord | null>;
  getApprovalByDigest(questionId: string, contentDigest: string): Promise<PersistedApprovalRecord | null>;
  saveApproval(
    record: ServerApprovalRecord,
    options?: SaveApprovalOptions
  ): Promise<SaveApprovalOutcome>;
  revokeApproval(
    questionId: string,
    contentDigest: string,
    revocation: { revokedBy: string; reason: string },
    options?: RevokeApprovalOptions
  ): Promise<RevokeApprovalOutcome>;
  getAuditHistory(
    questionId: string,
    options?: AuditHistoryOptions
  ): Promise<readonly ApprovalAuditEvent[]>;
}

// ============================================================================
// API Request & Outcome Types
// ============================================================================

export interface ContentApprovalRequest {
  readonly questionId: string; // Identifies existing authoritative question
  readonly checkpointId: string; // Target placement
  readonly expectedContentVersion?: string; // Optimistic concurrency check
  readonly claimedReviewerId?: string; // Spoofing verification
  readonly reviewNotes?: string;
  readonly mathematicalCheckConfirmed: boolean;
  readonly pedagogicalReviewConfirmed: boolean;
}

export type ContentApprovalOutcome =
  | { ok: true; approvalRecord: PersistedApprovalRecord; isDuplicate: boolean; message: string }
  | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 500 | 503; code: string; error: string };

export interface ContentRevocationRequest {
  readonly questionId: string;
  readonly contentDigest: string;
  readonly reason: string;
  readonly claimedReviewerId?: string;
}

export type ContentRevocationOutcome =
  | { ok: true; approvalRecord: PersistedApprovalRecord; message: string }
  | { ok: false; status: 400 | 401 | 403 | 404 | 500 | 503; code: string; error: string };
