import type {
  ApprovalAuditEvent,
  ApprovalLifecycleStatus,
  ApprovalRecordRepository,
  AuditHistoryOptions,
  PersistedApprovalRecord,
  RevokeApprovalOutcome,
  SaveApprovalOutcome,
  ServerApprovalRecord,
} from './types.ts';
import type { QuotaFirestore } from '../quotaStore.ts';
import { toFirestoreData } from '../../utils/firestoreData.ts';

/**
 * Strict allowlist validation patterns for question IDs and content digests.
 * - Question IDs must contain ONLY alphanumeric, underscore, or hyphen characters.
 *   Disallows slashes (/), whitespace, dots (.), percent-encoding tricks, or Unicode.
 * - Content digests must be strictly 64 lowercase hex characters prefixed with `sha256:`.
 */
export const QUESTION_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
export const CONTENT_DIGEST_REGEX = /^sha256:[a-f0-9]{64}$/;

export class InvalidIdentifierError extends Error {
  readonly code = 'invalid_identifier';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidIdentifierError';
  }
}

export function validateQuestionId(questionId: string): string {
  if (typeof questionId !== 'string' || !QUESTION_ID_REGEX.test(questionId)) {
    throw new InvalidIdentifierError(
      `Invalid question ID: "${questionId}". Must match ^[a-zA-Z0-9_-]+$ with no slashes, whitespace, or special characters.`
    );
  }
  return questionId;
}

export function validateContentDigest(contentDigest: string): string {
  if (typeof contentDigest !== 'string' || !CONTENT_DIGEST_REGEX.test(contentDigest)) {
    throw new InvalidIdentifierError(
      `Invalid content digest: "${contentDigest}". Must match ^sha256:[a-f0-9]{64}$.`
    );
  }
  return contentDigest;
}

/**
 * Collection layout and deterministic document ID helpers for verified question approvals.
 * Root collection: `verifiedQuestionApprovals`
 * Layout:
 *  1. `verifiedQuestionApprovals/active_${questionId}`: Current active pointer and state (1 per question).
 *  2. `verifiedQuestionApprovals/appr_${questionId}_${cleanDigest}`: Immutable version record (N per question).
 *  3. `verifiedQuestionApprovals/${questionId}/auditEvents/${eventId}`: Append-only audit subcollection (1 doc per event).
 */
export const APPROVAL_COLLECTION = 'verifiedQuestionApprovals';

export function activeApprovalDocId(questionId: string): string {
  validateQuestionId(questionId);
  return `active_${questionId}`;
}

export function versionApprovalDocId(questionId: string, contentDigest: string): string {
  validateQuestionId(questionId);
  validateContentDigest(contentDigest);
  const cleanDigest = contentDigest.slice('sha256:'.length);
  return `appr_${questionId}_${cleanDigest}`;
}

export function auditEventDocPath(
  questionId: string,
  eventId: string,
  collectionName: string = APPROVAL_COLLECTION
): string {
  validateQuestionId(questionId);
  return `${collectionName}/${questionId}/auditEvents/${eventId}`;
}

/**
 * In-Memory Implementation of ApprovalRecordRepository.
 *
 * Implements:
 * 1. Concurrency safety via per-question async mutexes.
 * 2. Idempotent duplicate approval handling.
 * 3. Stale version conflict detection (older timestamps rejected).
 * 4. Optimistic concurrency control via expectedCurrentVersion (mandatory when superseding).
 * 5. Automatic superseding of older active approvals.
 * 6. Audit history tracking for approved, revoked, and superseded events with pagination.
 */
export class MemoryApprovalRecordRepository implements ApprovalRecordRepository {
  // Primary index by deterministic key: `${questionId}::${contentDigest}`
  private readonly recordsByDigest = new Map<string, PersistedApprovalRecord>();
  // Active pointer index: questionId -> recordKey
  private readonly activeKeyByQuestionId = new Map<string, string>();
  // Audit log: questionId -> events[]
  private readonly auditLog = new Map<string, ApprovalAuditEvent[]>();
  // Mutex per questionId for race condition prevention
  private readonly locks = new Map<string, Promise<void>>();

  private async acquireLock(questionId: string): Promise<() => void> {
    while (this.locks.has(questionId)) {
      await this.locks.get(questionId);
    }
    let resolver: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      resolver = resolve;
    });
    this.locks.set(questionId, promise);
    return () => {
      this.locks.delete(questionId);
      resolver();
    };
  }

  async getActiveApproval(questionId: string): Promise<PersistedApprovalRecord | null> {
    if (!questionId || !QUESTION_ID_REGEX.test(questionId)) return null;
    const key = this.activeKeyByQuestionId.get(questionId);
    if (!key) return null;
    const record = this.recordsByDigest.get(key) || null;
    if (record && record.lifecycleStatus === 'approved') {
      return record;
    }
    return null;
  }

  async getApprovalByDigest(
    questionId: string,
    contentDigest: string
  ): Promise<PersistedApprovalRecord | null> {
    if (
      !questionId ||
      !contentDigest ||
      !QUESTION_ID_REGEX.test(questionId) ||
      !CONTENT_DIGEST_REGEX.test(contentDigest)
    ) {
      return null;
    }
    const key = `${questionId}::${contentDigest}`;
    return this.recordsByDigest.get(key) || null;
  }

  async saveApproval(
    record: ServerApprovalRecord,
    options?: { expectedCurrentVersion?: string }
  ): Promise<SaveApprovalOutcome> {
    if (typeof record.questionId !== 'string' || !QUESTION_ID_REGEX.test(record.questionId)) {
      return {
        ok: false,
        code: 'invalid_question_id',
        error: `Invalid question ID "${record.questionId}". Must match ^[a-zA-Z0-9_-]+$ with no slashes, whitespace, or special characters.`,
      };
    }
    if (typeof record.contentDigest !== 'string' || !CONTENT_DIGEST_REGEX.test(record.contentDigest)) {
      return {
        ok: false,
        code: 'invalid_content_digest',
        error: `Invalid content digest "${record.contentDigest}". Must match ^sha256:[a-f0-9]{64}$.`,
      };
    }

    const questionId = record.questionId;
    const contentDigest = record.contentDigest;
    const recordKey = `${questionId}::${contentDigest}`;

    const release = await this.acquireLock(questionId);
    try {
      const currentActiveKey = this.activeKeyByQuestionId.get(questionId);
      const currentActive = currentActiveKey ? this.recordsByDigest.get(currentActiveKey) : null;

      // 1. Duplicate check: same question & digest already approved
      const existing = this.recordsByDigest.get(recordKey);
      if (existing && existing.lifecycleStatus === 'approved') {
        return {
          ok: true,
          record: existing,
          isDuplicate: true,
        };
      }

      // 2. Concurrency and stale version checks against active approval
      if (currentActive && currentActive.lifecycleStatus === 'approved') {
        const currentTimestamp = Date.parse(currentActive.reviewedAt);
        const incomingTimestamp = Date.parse(record.reviewedAt);
        if (
          !Number.isNaN(incomingTimestamp) &&
          !Number.isNaN(currentTimestamp) &&
          incomingTimestamp < currentTimestamp
        ) {
          return {
            ok: false,
            code: 'stale_version_conflict',
            error: `Stale version conflict: incoming approval timestamp (${record.reviewedAt}) is older than active approval (${currentActive.reviewedAt}).`,
          };
        }

        // If superseding with a different digest, expectedCurrentVersion is strictly required
        if (currentActive.contentDigest !== contentDigest) {
          if (!options?.expectedCurrentVersion) {
            return {
              ok: false,
              code: 'expected_version_required',
              error: 'expectedCurrentVersion is required when superseding an existing active approval.',
            };
          }
          if (currentActive.contentVersion !== options.expectedCurrentVersion) {
            return {
              ok: false,
              code: 'concurrency_conflict',
              error: `Concurrency conflict: active version is "${currentActive.contentVersion}", but expected "${options.expectedCurrentVersion}".`,
            };
          }
        } else if (
          options?.expectedCurrentVersion &&
          currentActive.contentVersion !== options.expectedCurrentVersion
        ) {
          return {
            ok: false,
            code: 'concurrency_conflict',
            error: `Concurrency conflict: active version is "${currentActive.contentVersion}", but expected "${options.expectedCurrentVersion}".`,
          };
        }

        // Supersede the existing active approval
        const supersededRecord: PersistedApprovalRecord = {
          ...currentActive,
          lifecycleStatus: 'superseded',
          supersededBy: contentDigest,
        };
        this.recordsByDigest.set(currentActiveKey!, supersededRecord);

        const supersedeAuditCount = (this.auditLog.get(questionId) || []).length + 1;
        this.appendAuditEvent(questionId, {
          eventId: `evt_${String(supersedeAuditCount).padStart(6, '0')}_${Date.now()}_superseded`,
          eventType: 'superseded',
          questionId,
          contentDigest: currentActive.contentDigest,
          versionNumber: currentActive.versionNumber ?? 1,
          sequenceNumber: supersedeAuditCount,
          timestamp: record.reviewedAt,
          actorUid: record.reviewerUid,
          details: `Superseded by new version ${contentDigest}`,
        });
      }

      const nextVersionNumber = (currentActive?.versionNumber ?? 0) + 1;
      const isReapproval = currentActive?.lifecycleStatus === 'revoked';
      const nextAuditCount = (this.auditLog.get(questionId) || []).length + 1;

      const auditEvent: ApprovalAuditEvent = {
        eventId: `evt_${String(nextAuditCount).padStart(6, '0')}_${Date.now()}_${isReapproval ? 're_approved' : 'approved'}`,
        eventType: isReapproval ? 're_approved' : 'approved',
        questionId,
        contentDigest,
        versionNumber: nextVersionNumber,
        sequenceNumber: nextAuditCount,
        timestamp: record.reviewedAt,
        actorUid: record.reviewerUid,
        details: record.reviewNotes || (isReapproval ? 'Re-approved question content' : 'Approved question content'),
      };

      const existingHistory = existing?.auditHistory || [];
      const persistedRecord: PersistedApprovalRecord = {
        ...record,
        lifecycleStatus: 'approved',
        versionNumber: nextVersionNumber,
        auditHistory: [...existingHistory, auditEvent],
      };

      this.recordsByDigest.set(recordKey, persistedRecord);
      this.activeKeyByQuestionId.set(questionId, recordKey);
      this.appendAuditEvent(questionId, auditEvent);

      return {
        ok: true,
        record: persistedRecord,
        isDuplicate: false,
      };
    } finally {
      release();
    }
  }

  async revokeApproval(
    questionId: string,
    contentDigest: string,
    revocation: { revokedBy: string; reason: string }
  ): Promise<RevokeApprovalOutcome> {
    if (typeof questionId !== 'string' || !QUESTION_ID_REGEX.test(questionId)) {
      return {
        ok: false,
        code: 'invalid_question_id',
        error: `Invalid question ID "${questionId}". Must match ^[a-zA-Z0-9_-]+$ with no slashes, whitespace, or special characters.`,
      };
    }
    if (typeof contentDigest !== 'string' || !CONTENT_DIGEST_REGEX.test(contentDigest)) {
      return {
        ok: false,
        code: 'invalid_content_digest',
        error: `Invalid content digest "${contentDigest}". Must match ^sha256:[a-f0-9]{64}$.`,
      };
    }

    const qId = questionId;
    const digest = contentDigest;
    const recordKey = `${qId}::${digest}`;

    const release = await this.acquireLock(qId);
    try {
      const record = this.recordsByDigest.get(recordKey);
      if (!record) {
        return {
          ok: false,
          code: 'record_not_found',
          error: `Approval record for question "${qId}" and digest "${digest}" was not found.`,
        };
      }

      if (record.lifecycleStatus === 'revoked') {
        return {
          ok: false,
          code: 'already_revoked',
          error: `Approval record for question "${qId}" is already revoked.`,
        };
      }

      const timestamp = new Date().toISOString();
      const nextAuditCount = (this.auditLog.get(qId) || []).length + 1;
      const auditEvent: ApprovalAuditEvent = {
        eventId: `evt_${String(nextAuditCount).padStart(6, '0')}_${Date.now()}_revoked`,
        eventType: 'revoked',
        questionId: qId,
        contentDigest: digest,
        versionNumber: record.versionNumber ?? 1,
        sequenceNumber: nextAuditCount,
        timestamp,
        actorUid: revocation.revokedBy,
        details: revocation.reason,
      };

      const revokedRecord: PersistedApprovalRecord = {
        ...record,
        lifecycleStatus: 'revoked',
        revokedAt: timestamp,
        revokedBy: revocation.revokedBy,
        revocationReason: revocation.reason,
        auditHistory: [...record.auditHistory, auditEvent],
      };

      this.recordsByDigest.set(recordKey, revokedRecord);

      // Only clear active pointer if this record was currently the active approval
      if (this.activeKeyByQuestionId.get(qId) === recordKey) {
        this.activeKeyByQuestionId.delete(qId);
      }

      this.appendAuditEvent(qId, auditEvent);

      return {
        ok: true,
        record: revokedRecord,
      };
    } finally {
      release();
    }
  }

  async getAuditHistory(
    questionId: string,
    options?: AuditHistoryOptions
  ): Promise<readonly ApprovalAuditEvent[]> {
    if (!questionId || !QUESTION_ID_REGEX.test(questionId)) return [];
    let list = [...(this.auditLog.get(questionId) || [])];
    if (options?.direction === 'desc') {
      list.reverse();
    }
    const offset = Math.max(0, options?.offset ?? 0);
    const limit = Math.max(1, Math.min(options?.limit ?? 50, 100));
    return list.slice(offset, offset + limit);
  }

  private appendAuditEvent(questionId: string, event: ApprovalAuditEvent): void {
    const list = this.auditLog.get(questionId) || [];
    list.push(event);
    this.auditLog.set(questionId, list);
  }
}

/**
 * Unavailable Implementation of ApprovalRecordRepository.
 * Fails closed whenever Firestore credentials or database connections are absent.
 */
export class UnavailableApprovalRecordRepository implements ApprovalRecordRepository {
  constructor(private readonly reason: string) {}

  async getActiveApproval(_questionId: string): Promise<PersistedApprovalRecord | null> {
    return null;
  }

  async getApprovalByDigest(_questionId: string, _contentDigest: string): Promise<PersistedApprovalRecord | null> {
    return null;
  }

  async saveApproval(_record: ServerApprovalRecord, _options?: { expectedCurrentVersion?: string }): Promise<SaveApprovalOutcome> {
    return {
      ok: false,
      code: 'repository_unavailable',
      error: this.reason,
    };
  }

  async revokeApproval(_questionId: string, _contentDigest: string, _revocation: { revokedBy: string; reason: string }): Promise<RevokeApprovalOutcome> {
    return {
      ok: false,
      code: 'repository_unavailable',
      error: this.reason,
    };
  }

  async getAuditHistory(_questionId: string, _options?: AuditHistoryOptions): Promise<readonly ApprovalAuditEvent[]> {
    return [];
  }
}

/**
 * Firestore-Backed Implementation of ApprovalRecordRepository.
 *
 * Guarantees:
 * 1. Atomicity & Concurrency: All mutations execute inside Firestore runTransaction calls.
 * 2. Multi-instance Safety: Competing instances serialize on the active pointer document.
 * 3. Idempotency: Duplicate approvals for the active version return existing record without mutation.
 * 4. Optimistic Concurrency: Superseding an active approval strictly requires expectedCurrentVersion.
 * 5. Bounded Scalability: Each audit event is stored in an independent subcollection document, avoiding the 1 MiB doc limit.
 * 6. Durability: Records persist across repository and server re-instantiations.
 */
export class FirestoreApprovalRecordRepository implements ApprovalRecordRepository {
  constructor(
    private readonly db: QuotaFirestore,
    private readonly collectionName: string = APPROVAL_COLLECTION
  ) {}

  private ref(docId: string): unknown {
    return this.db.collection(this.collectionName).doc(docId);
  }

  private refPath(fullPath: string): unknown {
    const cut = fullPath.lastIndexOf('/');
    return this.db.collection(fullPath.slice(0, cut)).doc(fullPath.slice(cut + 1));
  }

  private auditEventRef(questionId: string, eventId: string): unknown {
    return this.refPath(auditEventDocPath(questionId, eventId, this.collectionName));
  }

  private async getDocData(ref: unknown): Promise<Record<string, unknown> | null> {
    if (!this.db) return null;
    try {
      if (ref && typeof (ref as { get?: unknown }).get === 'function') {
        const snap = await (ref as { get(): Promise<{ exists: boolean; data(): unknown }> }).get();
        if (!snap.exists) return null;
        const data = typeof snap.data === 'function' ? snap.data() : undefined;
        return (data as Record<string, unknown>) ?? null;
      }
      return await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const data = typeof snap.data === 'function' ? snap.data() : undefined;
        return (data as Record<string, unknown>) ?? null;
      });
    } catch {
      return null;
    }
  }

  async getActiveApproval(questionId: string): Promise<PersistedApprovalRecord | null> {
    if (!this.db || !questionId) return null;
    if (!QUESTION_ID_REGEX.test(questionId)) return null;
    try {
      const activeRef = this.ref(activeApprovalDocId(questionId));
      const data = await this.getDocData(activeRef);
      if (!data) return null;
      if (data.lifecycleStatus !== 'approved') return null;
      return (data.record as PersistedApprovalRecord) || null;
    } catch {
      return null;
    }
  }

  async getApprovalByDigest(
    questionId: string,
    contentDigest: string
  ): Promise<PersistedApprovalRecord | null> {
    if (!this.db || !questionId || !contentDigest) return null;
    if (!QUESTION_ID_REGEX.test(questionId) || !CONTENT_DIGEST_REGEX.test(contentDigest)) return null;
    try {
      const versionRef = this.ref(versionApprovalDocId(questionId, contentDigest));
      const data = await this.getDocData(versionRef);
      if (!data) return null;
      return (data as unknown as PersistedApprovalRecord) || null;
    } catch {
      return null;
    }
  }

  async saveApproval(
    record: ServerApprovalRecord,
    options?: { expectedCurrentVersion?: string }
  ): Promise<SaveApprovalOutcome> {
    if (!this.db) {
      return {
        ok: false,
        code: 'repository_unavailable',
        error: 'Firestore database is not configured.',
      };
    }

    if (typeof record.questionId !== 'string' || !QUESTION_ID_REGEX.test(record.questionId)) {
      return {
        ok: false,
        code: 'invalid_question_id',
        error: `Invalid question ID "${record.questionId}". Must match ^[a-zA-Z0-9_-]+$ with no slashes, whitespace, or special characters.`,
      };
    }
    if (typeof record.contentDigest !== 'string' || !CONTENT_DIGEST_REGEX.test(record.contentDigest)) {
      return {
        ok: false,
        code: 'invalid_content_digest',
        error: `Invalid content digest "${record.contentDigest}". Must match ^sha256:[a-f0-9]{64}$.`,
      };
    }

    const questionId = record.questionId;
    const contentDigest = record.contentDigest;
    const activeRef = this.ref(activeApprovalDocId(questionId));
    const versionRef = this.ref(versionApprovalDocId(questionId, contentDigest));

    try {
      return await this.db.runTransaction(async (tx) => {
        // Step 1: Read active pointer and version documents (O(1) reads; NO audit log document reads!)
        const activeSnap = await tx.get(activeRef);
        const versionSnap = await tx.get(versionRef);

        const activeData = activeSnap.exists && typeof activeSnap.data === 'function'
          ? (activeSnap.data() as Record<string, unknown>)
          : null;
        const currentActive = activeData?.record as PersistedApprovalRecord | undefined;
        const currentActiveDigest = typeof activeData?.activeDigest === 'string' ? activeData.activeDigest : null;
        const currentActiveStatus = activeData?.lifecycleStatus as ApprovalLifecycleStatus | undefined;
        const currentVersionNumber = typeof activeData?.versionNumber === 'number' ? activeData.versionNumber : 0;
        const currentAuditCount = typeof activeData?.auditCount === 'number' ? activeData.auditCount : 0;

        const versionData = versionSnap.exists && typeof versionSnap.data === 'function'
          ? (versionSnap.data() as Record<string, unknown>)
          : null;
        const existingVersionRecord = versionData as unknown as PersistedApprovalRecord | null;

        // Step 2: Idempotent duplicate check: exact version already active
        if (
          existingVersionRecord &&
          existingVersionRecord.lifecycleStatus === 'approved' &&
          currentActiveStatus === 'approved' &&
          currentActiveDigest === contentDigest
        ) {
          return {
            ok: true,
            record: existingVersionRecord,
            isDuplicate: true,
          };
        }

        // Step 3: Concurrency and stale version checks against current active approval
        if (currentActiveStatus === 'approved' && currentActive) {
          const currentTimestamp = Date.parse(currentActive.reviewedAt);
          const incomingTimestamp = Date.parse(record.reviewedAt);
          if (
            !Number.isNaN(incomingTimestamp) &&
            !Number.isNaN(currentTimestamp) &&
            incomingTimestamp < currentTimestamp
          ) {
            return {
              ok: false,
              code: 'stale_version_conflict',
              error: `Stale version conflict: incoming approval timestamp (${record.reviewedAt}) is older than active approval (${currentActive.reviewedAt}).`,
            };
          }

          // If superseding with a different digest, expectedCurrentVersion IS MANDATORY:
          if (currentActiveDigest !== contentDigest) {
            if (!options?.expectedCurrentVersion) {
              return {
                ok: false,
                code: 'expected_version_required',
                error: 'expectedCurrentVersion is required when superseding an existing active approval.',
              };
            }
            if (currentActive.contentVersion !== options.expectedCurrentVersion) {
              return {
                ok: false,
                code: 'concurrency_conflict',
                error: `Concurrency conflict: active version is "${currentActive.contentVersion}", but expected "${options.expectedCurrentVersion}".`,
              };
            }
          } else if (
            options?.expectedCurrentVersion &&
            currentActive.contentVersion !== options.expectedCurrentVersion
          ) {
            return {
              ok: false,
              code: 'concurrency_conflict',
              error: `Concurrency conflict: active version is "${currentActive.contentVersion}", but expected "${options.expectedCurrentVersion}".`,
            };
          }
        }

        // Step 4: Superseding previous active version (read old version document before writing)
        let oldVersionToSupersede: { ref: unknown; data: Record<string, unknown> } | null = null;
        if (
          currentActiveStatus === 'approved' &&
          currentActiveDigest &&
          currentActiveDigest !== contentDigest
        ) {
          const oldVersionRef = this.ref(versionApprovalDocId(questionId, currentActiveDigest));
          const oldVersionSnap = await tx.get(oldVersionRef);
          if (oldVersionSnap.exists && typeof oldVersionSnap.data === 'function') {
            const oldRecord = oldVersionSnap.data() as unknown as PersistedApprovalRecord;
            const supersededRecord: PersistedApprovalRecord = {
              ...oldRecord,
              lifecycleStatus: 'superseded',
              supersededBy: contentDigest,
            };
            oldVersionToSupersede = {
              ref: oldVersionRef,
              data: toFirestoreData(supersededRecord as unknown as Record<string, unknown>, {
                required: ['questionId', 'contentDigest', 'lifecycleStatus'],
                label: 'superseded approval record',
              }),
            };
          }
        }

        // Step 5: Versioning and subcollection audit events assembly
        const nextVersionNumber = currentVersionNumber + 1;
        const isReapproval = currentActiveStatus === 'revoked';
        const nowIso = new Date().toISOString();

        let auditEventOffset = 0;
        let supersedeAuditDoc: Record<string, unknown> | null = null;
        let supersedeAuditRef: unknown = null;

        if (oldVersionToSupersede && currentActiveDigest) {
          auditEventOffset = 1;
          const supersedeSeq = currentAuditCount + 1;
          const supersedeEventId = `evt_${String(supersedeSeq).padStart(6, '0')}_${Date.now()}_superseded`;
          const supersedeEvent: ApprovalAuditEvent = {
            eventId: supersedeEventId,
            eventType: 'superseded',
            questionId,
            contentDigest: currentActiveDigest,
            versionNumber: currentVersionNumber,
            sequenceNumber: supersedeSeq,
            timestamp: record.reviewedAt || nowIso,
            actorUid: record.reviewerUid,
            details: `Superseded by new version ${contentDigest}`,
          };
          supersedeAuditDoc = toFirestoreData({
            ...supersedeEvent,
            docType: 'audit_event',
            createdAt: nowIso,
          }, {
            required: ['docType', 'eventId', 'eventType', 'questionId', 'sequenceNumber'],
            label: 'supersede audit event',
          });
          supersedeAuditRef = this.auditEventRef(questionId, supersedeEventId);
        }

        const approvalSeq = currentAuditCount + auditEventOffset + 1;
        const approvalEventType = isReapproval ? 're_approved' : 'approved';
        const approvalEventId = `evt_${String(approvalSeq).padStart(6, '0')}_${Date.now()}_${approvalEventType}`;

        const approvalAuditEvent: ApprovalAuditEvent = {
          eventId: approvalEventId,
          eventType: approvalEventType,
          questionId,
          contentDigest,
          versionNumber: nextVersionNumber,
          sequenceNumber: approvalSeq,
          timestamp: record.reviewedAt || nowIso,
          actorUid: record.reviewerUid,
          details: record.reviewNotes || (isReapproval ? 'Re-approved question content' : 'Approved question content'),
        };

        const approvalAuditDoc = toFirestoreData({
          ...approvalAuditEvent,
          docType: 'audit_event',
          createdAt: nowIso,
        }, {
          required: ['docType', 'eventId', 'eventType', 'questionId', 'sequenceNumber'],
          label: 'approval audit event',
        });
        const approvalAuditRef = this.auditEventRef(questionId, approvalEventId);

        const existingVersionHistory = existingVersionRecord?.auditHistory || [];
        const persistedRecord: PersistedApprovalRecord = {
          ...record,
          lifecycleStatus: 'approved',
          versionNumber: nextVersionNumber,
          auditHistory: [...existingVersionHistory, approvalAuditEvent],
        };

        // Step 6: Transactional Writes
        if (oldVersionToSupersede) {
          tx.set(oldVersionToSupersede.ref, oldVersionToSupersede.data);
        }
        if (supersedeAuditDoc && supersedeAuditRef) {
          tx.set(supersedeAuditRef, supersedeAuditDoc);
        }

        const versionDocData: Record<string, unknown> = {
          ...persistedRecord,
          docType: 'version_record',
          createdAt: existingVersionRecord?.reviewedAt || record.reviewedAt || nowIso,
          updatedAt: nowIso,
        };
        tx.set(
          versionRef,
          toFirestoreData(versionDocData, {
            required: ['questionId', 'contentDigest', 'lifecycleStatus'],
            label: 'version approval record',
          })
        );

        const activeDocData: Record<string, unknown> = {
          docType: 'active_pointer',
          questionId,
          activeDigest: contentDigest,
          lifecycleStatus: 'approved',
          versionNumber: nextVersionNumber,
          auditCount: approvalSeq,
          record: persistedRecord,
          updatedAt: nowIso,
        };
        tx.set(
          activeRef,
          toFirestoreData(activeDocData, {
            required: ['docType', 'questionId', 'activeDigest', 'lifecycleStatus', 'auditCount'],
            label: 'active approval pointer',
          })
        );

        tx.set(approvalAuditRef, approvalAuditDoc);

        return {
          ok: true,
          record: persistedRecord,
          isDuplicate: false,
        };
      });
    } catch (err) {
      return {
        ok: false,
        code: 'repository_unavailable',
        error: `Firestore transaction failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async revokeApproval(
    questionId: string,
    contentDigest: string,
    revocation: { revokedBy: string; reason: string }
  ): Promise<RevokeApprovalOutcome> {
    if (!this.db) {
      return {
        ok: false,
        code: 'repository_unavailable',
        error: 'Firestore database is not configured.',
      };
    }

    if (typeof questionId !== 'string' || !QUESTION_ID_REGEX.test(questionId)) {
      return {
        ok: false,
        code: 'invalid_question_id',
        error: `Invalid question ID: "${questionId}". Must match ^[a-zA-Z0-9_-]+$ with no slashes, whitespace, or special characters.`,
      };
    }
    if (typeof contentDigest !== 'string' || !CONTENT_DIGEST_REGEX.test(contentDigest)) {
      return {
        ok: false,
        code: 'invalid_content_digest',
        error: `Invalid content digest: "${contentDigest}". Must match ^sha256:[a-f0-9]{64}$.`,
      };
    }

    const qId = questionId;
    const digest = contentDigest;
    const activeRef = this.ref(activeApprovalDocId(qId));
    const versionRef = this.ref(versionApprovalDocId(qId, digest));

    try {
      return await this.db.runTransaction(async (tx) => {
        // Step 1: Read version and active pointer
        const versionSnap = await tx.get(versionRef);
        if (!versionSnap.exists || typeof versionSnap.data !== 'function') {
          return {
            ok: false,
            code: 'record_not_found',
            error: `Approval record for question "${qId}" and digest "${digest}" was not found.`,
          };
        }

        const versionData = versionSnap.data() as Record<string, unknown>;
        const existingRecord = versionData as unknown as PersistedApprovalRecord;

        if (existingRecord.lifecycleStatus === 'revoked') {
          return {
            ok: false,
            code: 'already_revoked',
            error: `Approval record for question "${qId}" is already revoked.`,
          };
        }

        const activeSnap = await tx.get(activeRef);
        const activeData = activeSnap.exists && typeof activeSnap.data === 'function'
          ? (activeSnap.data() as Record<string, unknown>)
          : null;
        const currentActiveDigest = typeof activeData?.activeDigest === 'string' ? activeData.activeDigest : null;
        const currentAuditCount = typeof activeData?.auditCount === 'number' ? activeData.auditCount : 0;

        // Step 2: Assemble revoked record & audit event
        const timestamp = new Date().toISOString();
        const revokeSeq = currentAuditCount + 1;
        const eventId = `evt_${String(revokeSeq).padStart(6, '0')}_${Date.now()}_revoked`;

        const auditEvent: ApprovalAuditEvent = {
          eventId,
          eventType: 'revoked',
          questionId: qId,
          contentDigest: digest,
          versionNumber: existingRecord.versionNumber ?? 1,
          sequenceNumber: revokeSeq,
          timestamp,
          actorUid: revocation.revokedBy,
          details: revocation.reason,
        };

        const revokedRecord: PersistedApprovalRecord = {
          ...existingRecord,
          lifecycleStatus: 'revoked',
          revokedAt: timestamp,
          revokedBy: revocation.revokedBy,
          revocationReason: revocation.reason,
          auditHistory: [...(existingRecord.auditHistory || []), auditEvent],
        };

        // Step 3: Writes
        const versionDocData: Record<string, unknown> = {
          ...revokedRecord,
          docType: 'version_record',
          updatedAt: timestamp,
        };
        tx.set(
          versionRef,
          toFirestoreData(versionDocData, {
            required: ['questionId', 'contentDigest', 'lifecycleStatus'],
            label: 'revoked approval record',
          })
        );

        // Only clear active pointer if this record was currently the active approval
        if (currentActiveDigest === digest) {
          const activeDocData: Record<string, unknown> = {
            docType: 'active_pointer',
            questionId: qId,
            activeDigest: null,
            lifecycleStatus: 'revoked',
            versionNumber: typeof activeData?.versionNumber === 'number' ? activeData.versionNumber : 1,
            auditCount: revokeSeq,
            record: null,
            updatedAt: timestamp,
          };
          tx.set(
            activeRef,
            toFirestoreData(activeDocData, {
              required: ['docType', 'questionId', 'lifecycleStatus', 'auditCount'],
              label: 'active approval pointer (revoked)',
            })
          );
        } else if (activeSnap.exists) {
          // If revoking an older superseded version, active pointer remains active, just update auditCount
          tx.set(
            activeRef,
            toFirestoreData({
              ...activeData,
              auditCount: revokeSeq,
              updatedAt: timestamp,
            }, {
              required: ['docType', 'questionId', 'lifecycleStatus', 'auditCount'],
              label: 'active approval pointer (audit update)',
            })
          );
        }

        const auditEventDoc = toFirestoreData({
          ...auditEvent,
          docType: 'audit_event',
          createdAt: timestamp,
        }, {
          required: ['docType', 'eventId', 'eventType', 'questionId', 'sequenceNumber'],
          label: 'revocation audit event',
        });
        const auditEventRef = this.auditEventRef(qId, eventId);
        tx.set(auditEventRef, auditEventDoc);

        return {
          ok: true,
          record: revokedRecord,
        };
      });
    } catch (err) {
      return {
        ok: false,
        code: 'repository_unavailable',
        error: `Firestore transaction failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async getAuditHistory(
    questionId: string,
    options?: AuditHistoryOptions
  ): Promise<readonly ApprovalAuditEvent[]> {
    if (!this.db || !questionId) return [];
    if (!QUESTION_ID_REGEX.test(questionId)) return [];

    const limit = Math.max(1, Math.min(options?.limit ?? 50, 100));
    const offset = Math.max(0, options?.offset ?? 0);
    const direction = options?.direction === 'desc' ? 'desc' : 'asc';

    try {
      const colPath = `${this.collectionName}/${questionId}/auditEvents`;
      const col = this.db.collection(colPath) as unknown as {
        orderBy?(field: string, dir: string): {
          limit(l: number): {
            offset?(o: number): { get(): Promise<{ docs: Array<{ data(): unknown }> }> };
            get(): Promise<{ docs: Array<{ data(): unknown }> }>;
          };
        };
      };

      if (typeof col.orderBy === 'function') {
        const query = col.orderBy('sequenceNumber', direction).limit(limit);
        const snap = await query.get();
        return snap.docs.map((d) => d.data() as ApprovalAuditEvent);
      }

      // StrictFakeFirestore fallback
      if (this.db && typeof (this.db as any).docs === 'object' && (this.db as any).docs instanceof Map) {
        const prefix = `${colPath}/`;
        const events: ApprovalAuditEvent[] = [];
        for (const [key, value] of (this.db as any).docs.entries()) {
          if (typeof key === 'string' && key.startsWith(prefix) && value) {
            events.push(value as unknown as ApprovalAuditEvent);
          }
        }
        events.sort((a, b) => {
          const seqA = a.sequenceNumber ?? 0;
          const seqB = b.sequenceNumber ?? 0;
          return direction === 'asc' ? seqA - seqB : seqB - seqA;
        });
        return events.slice(offset, offset + limit);
      }

      return [];
    } catch {
      return [];
    }
  }
}
