import { randomUUID } from 'node:crypto';
import type {
  AuthorizedReviewerProfile,
  ReviewerAuditRepository,
  ReviewerAuthority,
  ReviewerAuthorizationAuditRecord,
  ReviewerAuthorizationContext,
  ReviewerAuthorizationDecision,
  ReviewerAuthorizationOutcome,
  ReviewerRegistry,
  ReviewerRole,
  ReviewerStatus,
  ReviewerSubjectPermission,
  SubjectDomain,
} from './types.ts';
import { isValidReviewerIdFormat } from '../../features/roadmaps/engine/contentGovernance.ts';
import type { QuotaFirestore } from '../quotaStore.ts';
import { toFirestoreData } from '../../utils/firestoreData.ts';

export const TRUSTED_REVIEWER_COLLECTION = 'trustedReviewers';
export const REVIEWER_AUDIT_COLLECTION = 'reviewerAuthorizationAudit';

const VALID_SUBJECT_DOMAINS = new Set<SubjectDomain>(['physics', 'chemistry', 'mathematics']);
const VALID_REVIEWER_STATUSES = new Set<ReviewerStatus>(['active', 'disabled', 'revoked', 'suspended']);
const VALID_REVIEWER_ROLES = new Set<ReviewerRole>(['reviewer', 'senior_reviewer', 'lead_reviewer', 'admin']);

export function generateAuditId(): string {
  return `rev_audit_${randomUUID()}`;
}

/**
 * Thrown when the trusted reviewer registry backing store cannot be reached
 * or is completely unconfigured.
 */
export class RegistryUnavailableError extends Error {
  readonly code = 'registry_unavailable' as const;
  constructor(message: string = 'Trusted reviewer registry is currently unavailable.') {
    super(message);
    this.name = 'RegistryUnavailableError';
  }
}

/**
 * Thrown when an error occurs during reviewer lookup from the backing store
 * or when data integrity constraints (such as schema or uniqueness) are violated.
 */
export class RegistryLookupError extends Error {
  readonly code = 'registry_lookup_failed' as const;
  constructor(message: string = 'Failed to lookup reviewer in registry.') {
    super(message);
    this.name = 'RegistryLookupError';
  }
}

/**
 * Validates a reviewer profile loaded from any store (Firestore, memory, or config).
 * Fails closed on any schema violation, missing identity field, unsupported status,
 * or malformed permissions.
 */
export function validateReviewerProfile(raw: unknown, expectedUid?: string): AuthorizedReviewerProfile {
  if (!raw || typeof raw !== 'object') {
    throw new RegistryLookupError('Malformed reviewer profile: expected a non-null object.');
  }

  const p = raw as Record<string, unknown>;

  if (typeof p.uid !== 'string' || p.uid.trim().length === 0) {
    throw new RegistryLookupError('Malformed reviewer profile: non-empty authenticated uid string is required.');
  }
  const cleanUid = p.uid.trim();
  if (expectedUid && cleanUid !== expectedUid) {
    throw new RegistryLookupError(
      `Malformed reviewer profile: document UID "${cleanUid}" does not match requested UID "${expectedUid}".`
    );
  }

  if (typeof p.reviewerId !== 'string' || !isValidReviewerIdFormat(p.reviewerId)) {
    throw new RegistryLookupError(
      `Malformed reviewer profile: Invalid canonical reviewerId format ("${p.reviewerId}"). Must match ^sme-[a-z]{3,12}-[a-z0-9_-]{2,40}$`
    );
  }
  const cleanReviewerId = p.reviewerId.trim();

  if (typeof p.displayName !== 'string' || p.displayName.trim().length === 0) {
    throw new RegistryLookupError('Malformed reviewer profile: missing or empty "displayName".');
  }

  if (typeof p.status !== 'string' || !VALID_REVIEWER_STATUSES.has(p.status as ReviewerStatus)) {
    throw new RegistryLookupError(`Malformed reviewer profile: unsupported status "${p.status}".`);
  }

  if (p.role !== undefined && (typeof p.role !== 'string' || !VALID_REVIEWER_ROLES.has(p.role as ReviewerRole))) {
    throw new RegistryLookupError(`Malformed reviewer profile: unsupported role "${p.role}".`);
  }

  if (!Array.isArray(p.permissions) || p.permissions.length === 0) {
    throw new RegistryLookupError('Malformed reviewer profile: "permissions" must be a non-empty array.');
  }

  const validatedPermissions: ReviewerSubjectPermission[] = [];
  for (const [idx, perm] of p.permissions.entries()) {
    if (!perm || typeof perm !== 'object') {
      throw new RegistryLookupError(`Malformed reviewer permission at index ${idx}: expected an object.`);
    }
    const permObj = perm as Record<string, unknown>;
    if (typeof permObj.subject !== 'string' || !VALID_SUBJECT_DOMAINS.has(permObj.subject as SubjectDomain)) {
      throw new RegistryLookupError(
        `Malformed reviewer permission at index ${idx}: invalid subject domain "${permObj.subject}".`
      );
    }
    if (typeof permObj.active !== 'boolean') {
      throw new RegistryLookupError(`Malformed reviewer permission at index ${idx}: "active" must be a boolean.`);
    }
    if (typeof permObj.grantedAt !== 'string' || Number.isNaN(Date.parse(permObj.grantedAt))) {
      throw new RegistryLookupError(`Malformed reviewer permission at index ${idx}: "grantedAt" must be a valid ISO date.`);
    }
    if (typeof permObj.grantedBy !== 'string' || permObj.grantedBy.trim().length === 0) {
      throw new RegistryLookupError(`Malformed reviewer permission at index ${idx}: "grantedBy" must be non-empty.`);
    }
    if (permObj.canApprove !== undefined && typeof permObj.canApprove !== 'boolean') {
      throw new RegistryLookupError(`Malformed reviewer permission at index ${idx}: "canApprove" must be a boolean if specified.`);
    }
    if (permObj.canRevoke !== undefined && typeof permObj.canRevoke !== 'boolean') {
      throw new RegistryLookupError(`Malformed reviewer permission at index ${idx}: "canRevoke" must be a boolean if specified.`);
    }

    validatedPermissions.push({
      subject: permObj.subject as SubjectDomain,
      active: permObj.active,
      grantedAt: permObj.grantedAt,
      grantedBy: permObj.grantedBy.trim(),
      canApprove: permObj.canApprove,
      canRevoke: permObj.canRevoke,
    });
  }

  return {
    uid: cleanUid,
    reviewerId: cleanReviewerId,
    displayName: p.displayName.trim(),
    email: typeof p.email === 'string' ? p.email.trim() : undefined,
    role: p.role as ReviewerRole | undefined,
    permissions: validatedPermissions,
    status: p.status as ReviewerStatus,
    registryVersion: typeof p.registryVersion === 'string' ? p.registryVersion.trim() : undefined,
    recordVersion: typeof p.recordVersion === 'number' ? p.recordVersion : undefined,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : undefined,
    createdBy: typeof p.createdBy === 'string' ? p.createdBy : undefined,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : undefined,
    updatedBy: typeof p.updatedBy === 'string' ? p.updatedBy : undefined,
    revokedAt: typeof p.revokedAt === 'string' ? p.revokedAt : undefined,
    revokedBy: typeof p.revokedBy === 'string' ? p.revokedBy : undefined,
    revocationReason: typeof p.revocationReason === 'string' ? p.revocationReason : undefined,
    disabledAt: typeof p.disabledAt === 'string' ? p.disabledAt : undefined,
    disabledBy: typeof p.disabledBy === 'string' ? p.disabledBy : undefined,
    disableReason: typeof p.disableReason === 'string' ? p.disableReason : undefined,
  };
}

/**
 * In-Memory Trusted Reviewer Registry.
 *
 * Provides isolated, mutable registry storage for testing, development,
 * and deterministic state updates with persistence-layer uniqueness checks.
 */
export class MemoryReviewerRegistry implements ReviewerRegistry {
  readonly registryVersion: string;
  private readonly reviewersByUid = new Map<string, AuthorizedReviewerProfile>();
  private readonly reviewersById = new Map<string, AuthorizedReviewerProfile>();

  constructor(
    initialReviewers: readonly AuthorizedReviewerProfile[] = [],
    version: string = '2026.1'
  ) {
    this.registryVersion = version;
    for (const reviewer of initialReviewers) {
      this.registerReviewer(reviewer);
    }
  }

  registerReviewer(reviewer: AuthorizedReviewerProfile): void {
    const validated = validateReviewerProfile(reviewer);

    const cleanUid = validated.uid;
    const cleanId = validated.reviewerId;

    // Uniqueness enforcement: A reviewerId cannot be assigned to two distinct UIDs
    const existingWithId = this.reviewersById.get(cleanId);
    if (existingWithId && existingWithId.uid !== cleanUid) {
      throw new RegistryLookupError(
        `Integrity violation: duplicate reviewerId "${cleanId}" detected; already bound to UID "${existingWithId.uid}".`
      );
    }

    const record: AuthorizedReviewerProfile = {
      ...validated,
      registryVersion: validated.registryVersion || this.registryVersion,
      recordVersion: validated.recordVersion ?? 1,
      createdAt: validated.createdAt || new Date().toISOString(),
      updatedAt: validated.updatedAt || new Date().toISOString(),
    };

    this.reviewersByUid.set(cleanUid, record);
    this.reviewersById.set(cleanId, record);
  }

  async getReviewerByUid(uid: string): Promise<AuthorizedReviewerProfile | null> {
    if (!uid || typeof uid !== 'string') return null;
    return this.reviewersByUid.get(uid.trim()) || null;
  }

  async getReviewerById(reviewerId: string): Promise<AuthorizedReviewerProfile | null> {
    if (!reviewerId || typeof reviewerId !== 'string') return null;
    return this.reviewersById.get(reviewerId.trim()) || null;
  }

  updateReviewerStatus(
    uid: string,
    status: ReviewerStatus,
    metadata?: { reason?: string; actor?: string }
  ): void {
    const existing = this.reviewersByUid.get(uid.trim());
    if (!existing) {
      throw new Error(`Reviewer with UID "${uid}" not found in registry.`);
    }

    const now = new Date().toISOString();
    const updated: AuthorizedReviewerProfile = {
      ...existing,
      status,
      recordVersion: (existing.recordVersion ?? 1) + 1,
      updatedAt: now,
      updatedBy: metadata?.actor,
      ...(status === 'revoked'
        ? {
            revokedAt: now,
            revokedBy: metadata?.actor,
            revocationReason: metadata?.reason,
          }
        : {}),
      ...(status === 'disabled'
        ? {
            disabledAt: now,
            disabledBy: metadata?.actor,
            disableReason: metadata?.reason,
          }
        : {}),
    };

    this.registerReviewer(updated);
  }

  updateSubjectPermissions(
    uid: string,
    permissions: readonly ReviewerSubjectPermission[],
    metadata?: { actor?: string }
  ): void {
    const existing = this.reviewersByUid.get(uid.trim());
    if (!existing) {
      throw new Error(`Reviewer with UID "${uid}" not found in registry.`);
    }

    const updated: AuthorizedReviewerProfile = {
      ...existing,
      permissions,
      recordVersion: (existing.recordVersion ?? 1) + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: metadata?.actor,
    };

    this.registerReviewer(updated);
  }

  removeReviewer(uid: string): void {
    const existing = this.reviewersByUid.get(uid.trim());
    if (existing) {
      this.reviewersByUid.delete(existing.uid);
      this.reviewersById.delete(existing.reviewerId);
    }
  }

  getAllReviewers(): readonly AuthorizedReviewerProfile[] {
    return Array.from(this.reviewersByUid.values());
  }
}

/**
 * Unavailable Reviewer Registry.
 *
 * Strictly fails closed whenever database credentials or registry backing services are missing.
 */
export class UnavailableReviewerRegistry implements ReviewerRegistry {
  readonly registryVersion: string = 'unavailable';

  constructor(private readonly reason: string = 'Trusted reviewer registry is currently unconfigured or unavailable.') {}

  async getReviewerByUid(_uid: string): Promise<AuthorizedReviewerProfile | null> {
    throw new RegistryUnavailableError(this.reason);
  }

  async getReviewerById(_reviewerId: string): Promise<AuthorizedReviewerProfile | null> {
    throw new RegistryUnavailableError(this.reason);
  }
}

/**
 * Firestore-Backed Trusted Reviewer Registry.
 *
 * Reads authoritative reviewer profiles from Firestore collection `trustedReviewers`.
 * Document ID = Authenticated user `uid`.
 * Enforces persistence-layer schema validation and reviewerId uniqueness.
 * Never converts infrastructure errors to null.
 */
export class FirestoreReviewerRegistry implements ReviewerRegistry {
  readonly registryVersion: string;

  constructor(
    private readonly db: QuotaFirestore,
    version: string = '2026.1',
    private readonly collectionName: string = TRUSTED_REVIEWER_COLLECTION
  ) {
    this.registryVersion = version;
  }

  async getReviewerByUid(uid: string): Promise<AuthorizedReviewerProfile | null> {
    if (!this.db) {
      throw new RegistryUnavailableError('Firestore database is not configured.');
    }
    if (!uid || typeof uid !== 'string') return null;
    const cleanUid = uid.trim();
    if (!cleanUid) return null;

    try {
      const docRef = this.db.collection(this.collectionName).doc(cleanUid);
      let snap: { exists: boolean; data?: () => unknown };
      if (typeof (docRef as { get?: () => Promise<{ exists: boolean; data: () => unknown }> }).get === 'function') {
        snap = await (docRef as { get(): Promise<{ exists: boolean; data(): unknown }> }).get();
      } else {
        snap = await this.db.runTransaction(async (tx) => {
          return await tx.get(docRef);
        });
      }

      if (!snap || !snap.exists) {
        return null; // Genuinely missing document -> return null
      }

      const raw = typeof snap.data === 'function' ? snap.data() : snap;
      // Runtime validation ensures data integrity and binds document UID to requested UID
      return validateReviewerProfile(raw, cleanUid);
    } catch (err) {
      if (err instanceof RegistryLookupError || err instanceof RegistryUnavailableError) {
        throw err;
      }
      // Infrastructure or network errors MUST NOT be converted to null
      throw new RegistryLookupError(
        `Failed to query reviewer registry from Firestore: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async getReviewerById(reviewerId: string): Promise<AuthorizedReviewerProfile | null> {
    if (!this.db) {
      throw new RegistryUnavailableError('Firestore database is not configured.');
    }
    if (!reviewerId || typeof reviewerId !== 'string') return null;
    const cleanId = reviewerId.trim();
    if (!cleanId) return null;

    try {
      const col = this.db.collection(this.collectionName) as unknown as {
        where(field: string, op: string, val: unknown): {
          limit(n: number): {
            get(): Promise<{ empty: boolean; docs: Array<{ data(): unknown }> }>;
          };
        };
      };

      if (typeof col.where !== 'function') {
        throw new RegistryLookupError('Firestore collection does not support query filtering.');
      }

      // Query with limit 2 to catch and reject duplicate reviewerIds at the persistence layer
      const query = col.where('reviewerId', '==', cleanId).limit(2);
      const snap = await query.get();

      if (!snap || snap.empty || snap.docs.length === 0) {
        return null;
      }

      if (snap.docs.length > 1) {
        throw new RegistryLookupError(
          `Integrity violation: duplicate reviewerId "${cleanId}" detected in reviewer registry.`
        );
      }

      const raw = snap.docs[0].data();
      return validateReviewerProfile(raw);
    } catch (err) {
      if (err instanceof RegistryLookupError || err instanceof RegistryUnavailableError) {
        throw err;
      }
      throw new RegistryLookupError(
        `Failed to query reviewer registry by reviewerId from Firestore: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/**
 * In-Memory Reviewer Audit Repository.
 *
 * Append-only storage for tests and development environments.
 * Does not expose methods to mutate or delete existing audit events.
 */
export class MemoryReviewerAuditRepository implements ReviewerAuditRepository {
  private readonly events: ReviewerAuthorizationAuditRecord[] = [];

  async recordDecision(event: ReviewerAuthorizationAuditRecord): Promise<void> {
    this.events.push(Object.freeze({ ...event }));
  }

  async getAuditEvents(filter?: {
    callerUid?: string;
    requestId?: string;
    questionId?: string;
    limit?: number;
  }): Promise<readonly ReviewerAuthorizationAuditRecord[]> {
    let list = [...this.events];
    if (filter?.callerUid) list = list.filter((e) => e.callerUid === filter.callerUid);
    if (filter?.requestId) list = list.filter((e) => e.requestId === filter.requestId);
    if (filter?.questionId) list = list.filter((e) => e.questionId === filter.questionId);
    const limit = Math.max(1, Math.min(filter?.limit ?? 50, 100));
    return list.slice(0, limit);
  }
}

/**
 * Unavailable Reviewer Audit Repository.
 * Strictly fails closed when audit logging credentials or backing store are unavailable.
 */
export class UnavailableReviewerAuditRepository implements ReviewerAuditRepository {
  constructor(private readonly reason: string = 'Reviewer authorization audit repository is currently unavailable.') {}

  async recordDecision(_event: ReviewerAuthorizationAuditRecord): Promise<void> {
    throw new Error(this.reason);
  }

  async getAuditEvents(): Promise<readonly ReviewerAuthorizationAuditRecord[]> {
    return [];
  }
}

/**
 * Failing Reviewer Audit Repository (Test Double).
 * Simulates audit database write failures to verify fail-closed semantics.
 */
export class FailingReviewerAuditRepository implements ReviewerAuditRepository {
  constructor(private readonly failureMessage: string = 'Simulated audit database connection timeout.') {}

  async recordDecision(_event: ReviewerAuthorizationAuditRecord): Promise<void> {
    throw new Error(this.failureMessage);
  }

  async getAuditEvents(): Promise<readonly ReviewerAuthorizationAuditRecord[]> {
    return [];
  }
}

/**
 * Firestore-Backed Reviewer Authorization Audit Repository.
 *
 * Append-only durable audit trail.
 * Each authorization decision is written as an independent document in `reviewerAuthorizationAudit/${eventId}`.
 * Does not expose update, delete, or clear methods.
 */
export class FirestoreReviewerAuditRepository implements ReviewerAuditRepository {
  constructor(
    private readonly db: QuotaFirestore,
    private readonly collectionName: string = REVIEWER_AUDIT_COLLECTION
  ) {}

  async recordDecision(event: ReviewerAuthorizationAuditRecord): Promise<void> {
    if (!this.db) {
      throw new Error('Firestore database is not configured for audit logging.');
    }
    const eventId = event.auditId || generateAuditId();
    const ref = this.db.collection(this.collectionName).doc(eventId);
    const data = toFirestoreData(
      {
        ...event,
        auditId: eventId,
        docType: 'reviewer_authorization_audit_event',
        createdAt: new Date().toISOString(),
      },
      {
        required: ['auditId', 'decision', 'code', 'action', 'requestedSubject', 'requestId', 'timestamp'],
        label: 'reviewer authorization audit event',
      }
    );

    try {
      if (typeof (ref as { create?: (d: unknown) => Promise<unknown> }).create === 'function') {
        await (ref as { create(d: unknown): Promise<unknown> }).create(data);
      } else {
        await this.db.runTransaction(async (tx) => {
          if (typeof (tx as { create?: (r: unknown, d: unknown) => unknown }).create === 'function') {
            (tx as { create(r: unknown, d: unknown): unknown }).create(ref, data);
          } else {
            throw new Error('Firestore transaction does not support native create operation.');
          }
        });
      }
    } catch (err: unknown) {
      const originalCode = (err as { code?: string | number })?.code;
      const originalMessage = err instanceof Error ? err.message : String(err);
      const isAlreadyExists =
        originalCode === 6 ||
        originalCode === '6' ||
        originalCode === 'ALREADY_EXISTS' ||
        originalMessage.includes('ALREADY_EXISTS');

      const wrappedError: any = new Error(
        `Failed to persist authorization audit decision to Firestore: ${originalMessage}`
      );
      wrappedError.code = isAlreadyExists ? 'ALREADY_EXISTS' : (originalCode ?? 'audit_persistence_failed');
      wrappedError.firestoreErrorCode = originalCode;
      wrappedError.originalCode = originalCode;
      wrappedError.cause = err;
      throw wrappedError;
    }
  }

  async getAuditEvents(filter?: {
    callerUid?: string;
    requestId?: string;
    questionId?: string;
    limit?: number;
  }): Promise<readonly ReviewerAuthorizationAuditRecord[]> {
    if (!this.db) return [];
    const limit = Math.max(1, Math.min(filter?.limit ?? 50, 100));
    try {
      const col = this.db.collection(this.collectionName) as unknown as {
        where?(field: string, op: string, val: unknown): any;
        limit?(n: number): any;
        get?(): Promise<{ docs: Array<{ data(): unknown }> }>;
      };
      if (typeof col.limit === 'function' && typeof col.get === 'function') {
        let q: any = col;
        if (filter?.callerUid && typeof q.where === 'function') {
          q = q.where('callerUid', '==', filter.callerUid);
        }
        if (filter?.requestId && typeof q.where === 'function') {
          q = q.where('requestId', '==', filter.requestId);
        }
        if (filter?.questionId && typeof q.where === 'function') {
          q = q.where('questionId', '==', filter.questionId);
        }
        const snap = await q.limit(limit).get();
        return snap.docs.map((d: any) => d.data() as ReviewerAuthorizationAuditRecord);
      }
      return [];
    } catch {
      return [];
    }
  }
}

/**
 * Server-Side Reviewer Authority.
 *
 * Enforces strict authorization policies:
 * 1. Identity Resolution: Reviewer identity is resolved strictly from the verified authentication UID.
 * 2. Deny by Default: Unknown UIDs or missing authentication are immediately rejected.
 * 3. Status Enforcement: Disabled, revoked, or suspended reviewer profiles are rejected.
 * 4. Subject Domain Scoping: Reviewers may only approve content within explicitly granted subject domains.
 * 5. Explicit Action Permissions:
 *    - `action === 'approve'` strictly requires `perm.canApprove === true`.
 *    - `action === 'revoke'` strictly requires `perm.canRevoke === true`.
 *    - Missing, false, or malformed permissions fail closed. Roles never infer permissions.
 * 6. Spoofing Prevention: Client-claimed reviewer IDs are strictly cross-checked; mismatch is rejected.
 * 7. Fail Closed: Registry unavailability or lookup failure immediately aborts with 503 error.
 * 8. Durable Audit Trail: Every authorization decision is recorded with auditId, callerUid, resolved reviewer ID,
 *    action, requested subject, request ID, timestamp, and registry version. No secrets or tokens are stored.
 *    If mandatory audit persistence fails, approval operations fail closed.
 */
export class ServerReviewerAuthority implements ReviewerAuthority {
  private readonly registry: ReviewerRegistry;
  private readonly auditRepo: ReviewerAuditRepository;
  readonly registryVersion: string;
  private readonly onAudit?: (record: ReviewerAuthorizationAuditRecord) => void | Promise<void>;

  constructor(
    registryOrReviewers: ReviewerRegistry | readonly AuthorizedReviewerProfile[] = [],
    options?: {
      registryVersion?: string;
      auditRepository?: ReviewerAuditRepository;
      onAudit?: (record: ReviewerAuthorizationAuditRecord) => void | Promise<void>;
    }
  ) {
    if ('getReviewerByUid' in registryOrReviewers && typeof registryOrReviewers.getReviewerByUid === 'function') {
      this.registry = registryOrReviewers;
    } else {
      this.registry = new MemoryReviewerRegistry(
        registryOrReviewers as readonly AuthorizedReviewerProfile[],
        options?.registryVersion ?? '2026.1'
      );
    }
    this.registryVersion = this.registry.registryVersion || options?.registryVersion || '2026.1';
    this.auditRepo = options?.auditRepository || new MemoryReviewerAuditRepository();
    this.onAudit = options?.onAudit;
  }

  getRegistry(): ReviewerRegistry {
    return this.registry;
  }

  getAuditRepository(): ReviewerAuditRepository {
    return this.auditRepo;
  }

  async recordDecision(record: ReviewerAuthorizationAuditRecord): Promise<void> {
    await this.recordAudit(record);
  }

  private async recordAudit(record: ReviewerAuthorizationAuditRecord): Promise<void> {
    try {
      await this.auditRepo.recordDecision(record);
    } catch (err) {
      // Re-throw so authorizeReviewer can fail closed if audit recording fails
      throw err;
    }
    if (this.onAudit) {
      try {
        await this.onAudit(record);
      } catch {
        // Do not crash on optional secondary listener failure
      }
    }
  }

  async getReviewerProfile(uid: string): Promise<AuthorizedReviewerProfile | null> {
    if (!uid || typeof uid !== 'string') {
      return null;
    }
    try {
      return await this.registry.getReviewerByUid(uid.trim());
    } catch {
      return null;
    }
  }

  async authorizeReviewer(
    uid: string | undefined,
    subject: SubjectDomain,
    context?: string | ReviewerAuthorizationContext
  ): Promise<ReviewerAuthorizationOutcome> {
    const claimedReviewerId = typeof context === 'string' ? context.trim() : context?.claimedReviewerId?.trim();
    const requestId = typeof context === 'object' && context?.requestId ? context.requestId.trim() : 'unknown';
    const questionId = typeof context === 'object' && context?.questionId ? context.questionId.trim() : undefined;
    const action: 'approve' | 'revoke' = typeof context === 'object' && context?.action ? context.action : 'approve';

    // 1. Authentication check
    if (!uid || typeof uid !== 'string' || uid.trim().length === 0) {
      const auditRecord: ReviewerAuthorizationAuditRecord = {
        auditId: generateAuditId(),
        callerUid: undefined,
        resolvedReviewerId: undefined,
        action,
        requestedSubject: subject,
        requestId,
        questionId,
        decision: 'denied',
        code: 'auth_required',
        allowed: false,
        timestamp: new Date().toISOString(),
        registryVersion: this.registryVersion,
        reason: 'Authentication required. Missing caller UID.',
      };
      try {
        await this.recordAudit(auditRecord);
      } catch {
        // Audit recording error on unauthenticated request does not grant access
      }
      return {
        ok: false,
        status: 401,
        code: 'auth_required',
        message: 'Authentication required. Please sign in with an authorized SME account.',
        auditRecord,
      };
    }

    const cleanUid = uid.trim();

    // 2. Registry lookup (fail-closed)
    let profile: AuthorizedReviewerProfile | null = null;
    try {
      profile = await this.registry.getReviewerByUid(cleanUid);
    } catch (err) {
      if (err instanceof RegistryUnavailableError || (err as { code?: string })?.code === 'registry_unavailable') {
        const auditRecord: ReviewerAuthorizationAuditRecord = {
          auditId: generateAuditId(),
          callerUid: cleanUid,
          resolvedReviewerId: undefined,
          action,
          requestedSubject: subject,
          requestId,
          questionId,
          decision: 'error',
          code: 'registry_unavailable',
          allowed: false,
          timestamp: new Date().toISOString(),
          registryVersion: this.registryVersion,
          reason: err instanceof Error ? err.message : 'Reviewer registry is unavailable.',
        };
        try {
          await this.recordAudit(auditRecord);
        } catch {
          // Failure to log error audit cannot compromise security
        }
        return {
          ok: false,
          status: 503,
          code: 'registry_unavailable',
          message:
            'Reviewer registry is unavailable. Content approvals cannot be issued without authoritative registry access.',
          auditRecord,
        };
      }

      const auditRecord: ReviewerAuthorizationAuditRecord = {
        auditId: generateAuditId(),
        callerUid: cleanUid,
        resolvedReviewerId: undefined,
        action,
        requestedSubject: subject,
        requestId,
        questionId,
        decision: 'error',
        code: 'registry_lookup_failed',
        allowed: false,
        timestamp: new Date().toISOString(),
        registryVersion: this.registryVersion,
        reason: err instanceof Error ? err.message : 'Registry lookup failed.',
      };
      try {
        await this.recordAudit(auditRecord);
      } catch {
        // Failure to log error audit cannot compromise security
      }
      return {
        ok: false,
        status: 503,
        code: 'registry_lookup_failed',
        message: `Reviewer registry lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        auditRecord,
      };
    }

    // 3. Authorization check (deny by default if UID not registered)
    if (!profile) {
      const auditRecord: ReviewerAuthorizationAuditRecord = {
        auditId: generateAuditId(),
        callerUid: cleanUid,
        resolvedReviewerId: undefined,
        action,
        requestedSubject: subject,
        requestId,
        questionId,
        decision: 'denied',
        code: 'not_authorized',
        allowed: false,
        timestamp: new Date().toISOString(),
        registryVersion: this.registryVersion,
        reason: `Caller UID "${cleanUid}" is not registered in trusted reviewer registry.`,
      };
      try {
        await this.recordAudit(auditRecord);
      } catch {
        // Denied attempt remains denied
      }
      return {
        ok: false,
        status: 403,
        code: 'not_authorized',
        message: 'You do not have SME content review privileges.',
        auditRecord,
      };
    }

    const regVersion = profile.registryVersion || this.registryVersion;

    // 4. Status check: reject revoked, disabled, suspended
    if (profile.status === 'revoked') {
      const auditRecord: ReviewerAuthorizationAuditRecord = {
        auditId: generateAuditId(),
        callerUid: cleanUid,
        resolvedReviewerId: profile.reviewerId,
        action,
        requestedSubject: subject,
        requestId,
        questionId,
        decision: 'denied',
        code: 'reviewer_revoked',
        allowed: false,
        timestamp: new Date().toISOString(),
        registryVersion: regVersion,
        reason: `Reviewer account "${profile.reviewerId}" has been revoked.${
          profile.revocationReason ? ` Reason: ${profile.revocationReason}` : ''
        }`,
      };
      try {
        await this.recordAudit(auditRecord);
      } catch {
        // Denied attempt remains denied
      }
      return {
        ok: false,
        status: 403,
        code: 'reviewer_revoked',
        message: `Reviewer account "${profile.reviewerId}" has been revoked.`,
        auditRecord,
      };
    }

    if (profile.status === 'disabled') {
      const auditRecord: ReviewerAuthorizationAuditRecord = {
        auditId: generateAuditId(),
        callerUid: cleanUid,
        resolvedReviewerId: profile.reviewerId,
        action,
        requestedSubject: subject,
        requestId,
        questionId,
        decision: 'denied',
        code: 'reviewer_disabled',
        allowed: false,
        timestamp: new Date().toISOString(),
        registryVersion: regVersion,
        reason: `Reviewer account "${profile.reviewerId}" is disabled.${
          profile.disableReason ? ` Reason: ${profile.disableReason}` : ''
        }`,
      };
      try {
        await this.recordAudit(auditRecord);
      } catch {
        // Denied attempt remains denied
      }
      return {
        ok: false,
        status: 403,
        code: 'reviewer_disabled',
        message: `Reviewer account "${profile.reviewerId}" is disabled. Contact administrator.`,
        auditRecord,
      };
    }

    if (profile.status === 'suspended') {
      const auditRecord: ReviewerAuthorizationAuditRecord = {
        auditId: generateAuditId(),
        callerUid: cleanUid,
        resolvedReviewerId: profile.reviewerId,
        action,
        requestedSubject: subject,
        requestId,
        questionId,
        decision: 'denied',
        code: 'reviewer_suspended',
        allowed: false,
        timestamp: new Date().toISOString(),
        registryVersion: regVersion,
        reason: `Reviewer account "${profile.reviewerId}" is suspended.`,
      };
      try {
        await this.recordAudit(auditRecord);
      } catch {
        // Denied attempt remains denied
      }
      return {
        ok: false,
        status: 403,
        code: 'reviewer_suspended',
        message: `Reviewer account is suspended. Contact administrator.`,
        auditRecord,
      };
    }

    if (profile.status !== 'active') {
      const auditRecord: ReviewerAuthorizationAuditRecord = {
        auditId: generateAuditId(),
        callerUid: cleanUid,
        resolvedReviewerId: profile.reviewerId,
        action,
        requestedSubject: subject,
        requestId,
        questionId,
        decision: 'denied',
        code: 'not_authorized',
        allowed: false,
        timestamp: new Date().toISOString(),
        registryVersion: regVersion,
        reason: `Reviewer account "${profile.reviewerId}" is in unrecognized status "${profile.status}".`,
      };
      try {
        await this.recordAudit(auditRecord);
      } catch {
        // Denied attempt remains denied
      }
      return {
        ok: false,
        status: 403,
        code: 'not_authorized',
        message: `Reviewer account status is "${profile.status}". Contact administrator.`,
        auditRecord,
      };
    }

    // 5. Anti-spoofing check: client-claimed reviewer ID must match authenticated profile ID
    if (claimedReviewerId && claimedReviewerId.length > 0 && claimedReviewerId !== profile.reviewerId) {
      const auditRecord: ReviewerAuthorizationAuditRecord = {
        auditId: generateAuditId(),
        callerUid: cleanUid,
        resolvedReviewerId: profile.reviewerId,
        action,
        requestedSubject: subject,
        requestId,
        questionId,
        decision: 'denied',
        code: 'reviewer_id_spoofing_detected',
        allowed: false,
        timestamp: new Date().toISOString(),
        registryVersion: regVersion,
        reason: `Client-supplied reviewer ID "${claimedReviewerId}" does not match authenticated identity "${profile.reviewerId}".`,
      };
      try {
        await this.recordAudit(auditRecord);
      } catch {
        // Denied attempt remains denied
      }
      return {
        ok: false,
        status: 403,
        code: 'reviewer_id_spoofing_detected',
        message: `Client-supplied reviewer ID "${claimedReviewerId}" does not match authenticated identity "${profile.reviewerId}".`,
        auditRecord,
      };
    }

    // 6. Subject domain permission check
    const subjectPerm = profile.permissions.find(
      (perm) => perm && perm.subject === subject && perm.active === true
    );

    if (!subjectPerm) {
      const auditRecord: ReviewerAuthorizationAuditRecord = {
        auditId: generateAuditId(),
        callerUid: cleanUid,
        resolvedReviewerId: profile.reviewerId,
        action,
        requestedSubject: subject,
        requestId,
        questionId,
        decision: 'denied',
        code: 'subject_unauthorized',
        allowed: false,
        timestamp: new Date().toISOString(),
        registryVersion: regVersion,
        reason: `Reviewer "${profile.reviewerId}" does not hold active review authorization for subject "${subject}".`,
      };
      try {
        await this.recordAudit(auditRecord);
      } catch {
        // Denied attempt remains denied
      }
      return {
        ok: false,
        status: 403,
        code: 'subject_unauthorized',
        message: `Reviewer "${profile.reviewerId}" does not hold active review authorization for subject "${subject}".`,
        auditRecord,
      };
    }

    // 7. Action-specific permission checks (Phase 1 remediation)
    // NEVER infer permissions from reviewer roles. Values must be strictly true.
    if (action === 'approve') {
      if (subjectPerm.canApprove !== true) {
        const auditRecord: ReviewerAuthorizationAuditRecord = {
          auditId: generateAuditId(),
          callerUid: cleanUid,
          resolvedReviewerId: profile.reviewerId,
          action,
          requestedSubject: subject,
          requestId,
          questionId,
          decision: 'denied',
          code: 'not_authorized',
          allowed: false,
          timestamp: new Date().toISOString(),
          registryVersion: regVersion,
          reason: `Reviewer "${profile.reviewerId}" lacks explicit canApprove permission for subject "${subject}".`,
        };
        try {
          await this.recordAudit(auditRecord);
        } catch {
          // Denied attempt remains denied
        }
        return {
          ok: false,
          status: 403,
          code: 'not_authorized',
          message: `Reviewer "${profile.reviewerId}" does not have approval privileges for subject "${subject}".`,
          auditRecord,
        };
      }
    } else if (action === 'revoke') {
      if (subjectPerm.canRevoke !== true) {
        const auditRecord: ReviewerAuthorizationAuditRecord = {
          auditId: generateAuditId(),
          callerUid: cleanUid,
          resolvedReviewerId: profile.reviewerId,
          action,
          requestedSubject: subject,
          requestId,
          questionId,
          decision: 'denied',
          code: 'not_authorized',
          allowed: false,
          timestamp: new Date().toISOString(),
          registryVersion: regVersion,
          reason: `Reviewer "${profile.reviewerId}" lacks explicit canRevoke permission for subject "${subject}".`,
        };
        try {
          await this.recordAudit(auditRecord);
        } catch {
          // Denied attempt remains denied
        }
        return {
          ok: false,
          status: 403,
          code: 'not_authorized',
          message: `Reviewer "${profile.reviewerId}" does not have revocation privileges for subject "${subject}".`,
          auditRecord,
        };
      }
    } else {
      const auditRecord: ReviewerAuthorizationAuditRecord = {
        auditId: generateAuditId(),
        callerUid: cleanUid,
        resolvedReviewerId: profile.reviewerId,
        action: 'approve',
        requestedSubject: subject,
        requestId,
        questionId,
        decision: 'denied',
        code: 'not_authorized',
        allowed: false,
        timestamp: new Date().toISOString(),
        registryVersion: regVersion,
        reason: `Unrecognized action "${action}".`,
      };
      try {
        await this.recordAudit(auditRecord);
      } catch {
        // Denied attempt remains denied
      }
      return {
        ok: false,
        status: 403,
        code: 'not_authorized',
        message: `Action "${action}" is not permitted.`,
        auditRecord,
      };
    }

    // 8. Authorization granted -> persist durable audit event
    const auditRecord: ReviewerAuthorizationAuditRecord = {
      auditId: generateAuditId(),
      callerUid: cleanUid,
      resolvedReviewerId: profile.reviewerId,
      action,
      requestedSubject: subject,
      requestId,
      questionId,
      decision: 'authorized',
      code: 'authorized',
      allowed: true,
      timestamp: new Date().toISOString(),
      registryVersion: regVersion,
      reason: `Authorized reviewer "${profile.reviewerId}" confirmed for ${action} in subject "${subject}".`,
    };

    // Mandatory audit persistence policy:
    // If durable audit logging fails for an authorized action, FAIL CLOSED.
    try {
      await this.recordAudit(auditRecord);
    } catch (err) {
      return {
        ok: false,
        status: 503,
        code: 'audit_persistence_failed',
        message: `Mandatory authorization audit persistence failed: ${
          err instanceof Error ? err.message : String(err)
        }. Content operation aborted.`,
        auditRecord: {
          ...auditRecord,
          decision: 'error',
          code: 'audit_persistence_failed',
          allowed: false,
        },
      };
    }

    return {
      ok: true,
      profile,
      auditRecord,
    };
  }

  async getAuditTrail(filter?: {
    callerUid?: string;
    requestId?: string;
    questionId?: string;
    decision?: ReviewerAuthorizationDecision;
  }): Promise<readonly ReviewerAuthorizationAuditRecord[]> {
    return this.auditRepo.getAuditEvents(filter);
  }
}
