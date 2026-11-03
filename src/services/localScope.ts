/**
 * Per-account isolation of browser storage.
 *
 * Private study data is stored under a scope prefix: `lm:guest:<key>` for signed-out use and
 * `lm:u_<uid>:<key>` for each signed-in account. Scopes are never merged automatically, so one
 * person's local data can never be uploaded into another person's account on a shared device.
 * Device preferences (theme, accessibility, tutor source mode) stay unscoped.
 */

export const STORAGE_KEYS = Object.freeze({
  DOCUMENTS: 'learnmate_documents_v1',
  ACTIVE_DOC_ID: 'learnmate_active_doc_id_v1',
  TUTOR_PREFIX: 'learnmate_tutor_v1_',
  QUIZ_CACHE_PREFIX: 'learnmate_quiz_cache_v1_',
  ATTEMPTS: 'learnmate_quiz_attempts_v1',
  MISTAKES_PREFIX: 'learnmate_mistakes_v1_',
  REVISION_PREFIX: 'learnmate_revision_v1_',
  QUICK_REVISE_PREFIX: 'learnmate_quick_revise_v1_',
  YT_REC_PREFIX: 'learnmate_yt_rec_v1_',
  TIMER_STATE: 'learnmate_study_timer_v1',
  FOCUS_SESSIONS: 'learnmate_focus_sessions_v1',
  THEME: 'learnmate_theme_v1',
  SOURCE_CONTROL_MODE: 'learnmate_source_control_v2',
  NOTIFICATIONS: 'learnmate_notifications_v2',
  NOTEBOOK: 'learnmate_notebook_v2',
  CREATIVE_ASSETS: 'learnmate_creative_assets_v2',
  STUDY_PLANNER: 'learnmate_study_planner_v2',
  ACCESSIBILITY: 'learnmate_accessibility_v2',
  PDF_ANNOTATIONS_PREFIX: 'learnmate_pdf_annotations_v1_',
  STUDENT_PROFILE: 'learnmate_student_profile_v1',
  SEEDED: 'learnmate_seeded_materials_v1',
  SYNC_DIRTY: 'learnmate_sync_dirty_v1',
  SAVED_EXPLORE: 'learnmate_saved_explore_v2',
  // Study sessions (learning contexts). Distinct from FOCUS_SESSIONS (focus-timer history).
  STUDY_SESSIONS: 'learnmate_study_sessions_v1',
  STUDY_SESSION_TOMBSTONES: 'learnmate_study_session_tombstones_v1',
  STUDY_SESSION_MIGRATION_REPORT: 'learnmate_study_session_migration_v1',
});

/** Device-level preferences that are safe to share between accounts on one device. */
export const PUBLIC_STORAGE_KEYS: ReadonlySet<string> = new Set([
  STORAGE_KEYS.THEME,
  STORAGE_KEYS.SOURCE_CONTROL_MODE,
  STORAGE_KEYS.ACCESSIBILITY,
]);

const PRIVATE_EXACT_KEYS: ReadonlySet<string> = new Set([
  STORAGE_KEYS.DOCUMENTS,
  STORAGE_KEYS.ACTIVE_DOC_ID,
  STORAGE_KEYS.ATTEMPTS,
  STORAGE_KEYS.TIMER_STATE,
  STORAGE_KEYS.FOCUS_SESSIONS,
  STORAGE_KEYS.NOTIFICATIONS,
  STORAGE_KEYS.NOTEBOOK,
  STORAGE_KEYS.CREATIVE_ASSETS,
  STORAGE_KEYS.STUDY_PLANNER,
  STORAGE_KEYS.STUDENT_PROFILE,
  STORAGE_KEYS.SEEDED,
  STORAGE_KEYS.SYNC_DIRTY,
  STORAGE_KEYS.STUDY_SESSIONS,
  STORAGE_KEYS.STUDY_SESSION_TOMBSTONES,
  STORAGE_KEYS.STUDY_SESSION_MIGRATION_REPORT,
]);

const PRIVATE_PREFIXES: readonly string[] = [
  STORAGE_KEYS.TUTOR_PREFIX,
  STORAGE_KEYS.QUIZ_CACHE_PREFIX,
  STORAGE_KEYS.MISTAKES_PREFIX,
  STORAGE_KEYS.REVISION_PREFIX,
  STORAGE_KEYS.QUICK_REVISE_PREFIX,
  STORAGE_KEYS.YT_REC_PREFIX,
  STORAGE_KEYS.PDF_ANNOTATIONS_PREFIX,
];

/** Prefixes of per-document study state (used to decide whether a document was ever used). */
export const DOCUMENT_STATE_PREFIXES: readonly string[] = [
  STORAGE_KEYS.TUTOR_PREFIX,
  STORAGE_KEYS.QUIZ_CACHE_PREFIX,
  STORAGE_KEYS.MISTAKES_PREFIX,
  STORAGE_KEYS.REVISION_PREFIX,
  STORAGE_KEYS.QUICK_REVISE_PREFIX,
  STORAGE_KEYS.PDF_ANNOTATIONS_PREFIX,
];

export const SCOPED_KEY_PREFIX = 'lm:';
export const LEGACY_MIGRATION_MARKER = 'lm:meta:legacy_scope_migration_v1';

export type LocalScope = 'guest' | `u_${string}`;

/** Minimal Storage surface so the logic can be tested without a browser. */
export interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function isPrivateRawKey(rawKey: string): boolean {
  if (PRIVATE_EXACT_KEYS.has(rawKey)) return true;
  return PRIVATE_PREFIXES.some((prefix) => rawKey.startsWith(prefix));
}

export function scopeForUid(uid: string | null | undefined): LocalScope {
  if (!uid) return 'guest';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw new Error('Unexpected user id format for local storage scope.');
  }
  return `u_${uid}`;
}

/** Physical storage key for a raw key under a scope (public keys are never scoped). */
export function scopedKey(scope: LocalScope, rawKey: string): string {
  if (!isPrivateRawKey(rawKey)) return rawKey;
  return `${SCOPED_KEY_PREFIX}${scope}:${rawKey}`;
}

function allKeys(storage: KeyValueStorage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null) keys.push(key);
  }
  return keys;
}

/** Raw (unscoped) keys stored under a scope. */
export function listScopeRawKeys(storage: KeyValueStorage, scope: LocalScope): string[] {
  const prefix = `${SCOPED_KEY_PREFIX}${scope}:`;
  return allKeys(storage)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
}

export function clearScope(storage: KeyValueStorage, scope: LocalScope): number {
  const prefix = `${SCOPED_KEY_PREFIX}${scope}:`;
  const keys = allKeys(storage).filter((key) => key.startsWith(prefix));
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}

export function listUserScopes(storage: KeyValueStorage): LocalScope[] {
  const scopes = new Set<LocalScope>();
  for (const key of allKeys(storage)) {
    const match = /^lm:(u_[A-Za-z0-9_-]{1,128}):/.exec(key);
    if (match) scopes.add(match[1] as LocalScope);
  }
  return [...scopes];
}

/** Entity ids whose latest local change has not yet been confirmed by the cloud (id -> revision). */
export interface DirtySet {
  documents: Record<string, number>;
  attempts: Record<string, number>;
  studyState: Record<string, number>;
  deletedDocuments: Record<string, number>;
  profile: Record<string, number>;
  studySessions: Record<string, number>;
  deletedStudySessions: Record<string, number>;
}

export function emptyDirtySet(): DirtySet {
  return { documents: {}, attempts: {}, studyState: {}, deletedDocuments: {}, profile: {}, studySessions: {}, deletedStudySessions: {} };
}

export function countDirty(dirty: DirtySet): number {
  return Object.values(dirty).reduce((sum, entries) => sum + Object.keys(entries).length, 0);
}

export function readDirtySet(storage: KeyValueStorage, scope: LocalScope): DirtySet {
  try {
    const raw = storage.getItem(scopedKey(scope, STORAGE_KEYS.SYNC_DIRTY));
    if (!raw) return emptyDirtySet();
    const parsed = JSON.parse(raw) as Partial<DirtySet>;
    return {
      documents: parsed.documents || {},
      attempts: parsed.attempts || {},
      studyState: parsed.studyState || {},
      deletedDocuments: parsed.deletedDocuments || {},
      profile: parsed.profile || {},
      studySessions: parsed.studySessions || {},
      deletedStudySessions: parsed.deletedStudySessions || {},
    };
  } catch {
    return emptyDirtySet();
  }
}

export interface LegacyMigrationResult {
  status: 'migrated' | 'already_done' | 'nothing_to_migrate' | 'failed';
  moved: number;
  dropped: number;
  error?: string;
}

/**
 * Moves pre-scoping (global) private keys into the guest scope, exactly once.
 *
 * Ownership of that legacy data is unknown (it may belong to a guest or to whichever account
 * last used the device), so it is never attributed to a signed-in account. Copies are verified
 * before originals are removed; on any failure the originals are left untouched and the
 * migration is retried on the next start. `transform` may rewrite or drop (return null) a value.
 */
export function migrateLegacyKeysToGuest(
  storage: KeyValueStorage,
  transform: (rawKey: string, value: string, legacy: ReadonlyMap<string, string>) => string | null = (_k, v) => v,
  now: () => string = () => new Date().toISOString()
): LegacyMigrationResult {
  if (storage.getItem(LEGACY_MIGRATION_MARKER)) {
    return { status: 'already_done', moved: 0, dropped: 0 };
  }

  const legacy = new Map<string, string>();
  for (const key of allKeys(storage)) {
    if (key.startsWith(SCOPED_KEY_PREFIX)) continue;
    if (!isPrivateRawKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) legacy.set(key, value);
  }

  if (legacy.size === 0) {
    storage.setItem(LEGACY_MIGRATION_MARKER, JSON.stringify({ at: now(), moved: 0, dropped: 0 }));
    return { status: 'nothing_to_migrate', moved: 0, dropped: 0 };
  }

  const written: string[] = [];
  const consumed: string[] = [];
  let moved = 0;
  let dropped = 0;
  try {
    for (const [rawKey, value] of legacy) {
      const next = transform(rawKey, value, legacy);
      if (next === null) {
        dropped++;
        consumed.push(rawKey);
        continue;
      }
      const target = scopedKey('guest', rawKey);
      if (storage.getItem(target) !== null) {
        // Never overwrite data already present in the guest scope; keep the legacy original too.
        continue;
      }
      storage.setItem(target, next);
      if (storage.getItem(target) !== next) throw new Error(`Verification failed for ${rawKey}`);
      written.push(target);
      consumed.push(rawKey);
      moved++;
    }
  } catch (err) {
    for (const key of written) storage.removeItem(key);
    return {
      status: 'failed',
      moved: 0,
      dropped: 0,
      error: err instanceof Error ? err.message : 'Unknown storage error',
    };
  }

  storage.setItem(LEGACY_MIGRATION_MARKER, JSON.stringify({ at: now(), moved, dropped }));
  for (const rawKey of consumed) storage.removeItem(rawKey);
  return { status: 'migrated', moved, dropped };
}

/** Document ids that have any locally stored study activity in the given raw key/value set. */
export function collectUsedDocumentIds(entries: ReadonlyMap<string, string>): Set<string> {
  const used = new Set<string>();
  for (const [rawKey, value] of entries) {
    const prefix = DOCUMENT_STATE_PREFIXES.find((p) => rawKey.startsWith(p));
    if (prefix) {
      const remainder = rawKey.slice(prefix.length);
      used.add(prefix === STORAGE_KEYS.QUIZ_CACHE_PREFIX ? remainder.replace(/_(diagnostic|adaptive)$/, '') : remainder);
      continue;
    }
    if (rawKey === STORAGE_KEYS.ATTEMPTS || rawKey === STORAGE_KEYS.FOCUS_SESSIONS) {
      try {
        const list = JSON.parse(value) as Array<{ documentId?: unknown }>;
        if (Array.isArray(list)) {
          for (const item of list) if (typeof item?.documentId === 'string') used.add(item.documentId);
        }
      } catch {
        // ignore malformed legacy entries
      }
    }
  }
  return used;
}
