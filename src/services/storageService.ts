import type { User } from 'firebase/auth';
import type {
  StudyDocument,
  TutorMessage,
  CachedPracticeSet,
  QuizAttempt,
  MistakeInsight,
  RevisionTask,
  QuickReviseBundle,
  YouTubeRecommendation,
  StudyTimerState,
  FocusSessionRecord,
  ThemeMode,
  SourceControlMode,
  LearnMateNotification,
  NotebookEntry,
  CreativeAsset,
  StudyPlannerTask,
  AccessibilitySettings,
  CourseLibraryItem,
  PdfAnnotationItem,
  StudentAcademicProfile,
} from '../types/study';
import { computeContentVersion } from '../utils/quizGrading';
import { isFeatureEnabled } from '../config/launchFeatures';
import type { JeeSubjectId } from '../data/jeeMainSyllabus';
import type { StudySession } from '../types/questionBank';
import { createSession, nextUpdatedAt, planDocumentSessionMigration, validateSession } from '../utils/sessionModel';
import {
  decodeStudySessionDoc,
  encodeStudySessionDoc,
  encodeStudySessionTombstone,
  newStudySessionId,
  resolveStudySession,
  type CloudStudySession,
  type StudySessionResolution,
  type StudySessionSyncState,
  type StudySessionTombstone,
} from './studySessionSync';
import {
  STORAGE_KEYS,
  clearScope,
  collectUsedDocumentIds,
  countDirty,
  emptyDirtySet,
  isPrivateRawKey,
  listScopeRawKeys,
  migrateLegacyKeysToGuest,
  readDirtySet,
  scopeForUid,
  scopedKey,
  type DirtySet,
  type KeyValueStorage,
  type LegacyMigrationResult,
  type LocalScope,
} from './localScope';
import { cloudPaths, isSafeCloudId, withFirestoreSafeWrites, type CloudDocStore, type CloudWriteOp } from './cloudStore';
import {
  chunkCountOf,
  decodeQuizAttempt,
  decodeStudyDocument,
  decodeStudyState,
  deleteEntityOps,
  encodeQuizAttempt,
  encodeStudyDocument,
  encodeStudyState,
  type StudyStatePayload,
} from './cloudEntities';
import { PayloadTooLargeError } from './cloudPayload';
import { SyncStatusTracker, type SyncSnapshot } from './syncStatus';

/**
 * Storage repository interface supporting local browser persistence (isolated per account on
 * the device) and authenticated Cloud Firestore sync.
 */
export interface IStudyStorageRepository {
  getDocuments(): StudyDocument[];
  getDocumentById(id: string): StudyDocument | null;
  saveDocument(doc: StudyDocument): void;
  renameDocument(id: string, newTitle: string): StudyDocument | null;
  deleteDocument(id: string): void;
  getActiveDocumentId(): string | null;
  setActiveDocumentId(id: string | null): void;

  getTutorMessages(documentId: string): TutorMessage[];
  saveTutorMessages(documentId: string, messages: TutorMessage[]): void;

  /** Unsubmitted server-held practice set for a document, or null (expired/legacy entries are ignored). */
  getCachedQuiz(documentId: string, mode: string): CachedPracticeSet | null;
  saveCachedQuiz(documentId: string, mode: string, set: CachedPracticeSet): void;
  clearCachedQuiz(documentId: string, mode: string): void;

  getQuizAttempts(documentId?: string): QuizAttempt[];
  saveQuizAttempt(attempt: QuizAttempt): void;

  getMistakeInsights(documentId: string): MistakeInsight[];
  saveMistakeInsights(documentId: string, mistakes: MistakeInsight[]): void;

  getRevisionPlan(documentId: string): RevisionTask[];
  saveRevisionPlan(documentId: string, tasks: RevisionTask[]): void;

  getQuickReviseBundle(documentId: string, contentVersion?: string): QuickReviseBundle | null;
  saveQuickReviseBundle(bundle: QuickReviseBundle): void;

  getCachedYouTubeRecommendations(cacheKey: string): YouTubeRecommendation[] | null;
  saveCachedYouTubeRecommendations(cacheKey: string, videos: YouTubeRecommendation[]): void;

  getStudyTimerState(): StudyTimerState;
  saveStudyTimerState(state: StudyTimerState): void;

  getFocusSessions(documentId?: string): FocusSessionRecord[];
  saveFocusSession(session: FocusSessionRecord): void;

  getThemeMode(): ThemeMode;
  saveThemeMode(mode: ThemeMode): void;

  getSourceControlMode(): SourceControlMode;
  saveSourceControlMode(mode: SourceControlMode): void;

  getNotifications(): LearnMateNotification[];
  addNotification(notification: Omit<LearnMateNotification, 'id' | 'createdAt' | 'read'>): LearnMateNotification;
  markNotificationRead(id: string): void;
  markAllNotificationsRead(): void;
  clearNotifications(): void;

  getNotebookEntries(): NotebookEntry[];
  saveNotebookEntry(entry: NotebookEntry): void;
  deleteNotebookEntry(id: string): void;

  getCreativeAssets(documentId?: string): CreativeAsset[];
  saveCreativeAsset(asset: CreativeAsset): void;
  deleteCreativeAsset(id: string): void;

  getStudyPlannerTasks(): StudyPlannerTask[];
  saveStudyPlannerTasks(tasks: StudyPlannerTask[]): void;

  getAccessibilitySettings(): AccessibilitySettings;
  saveAccessibilitySettings(settings: AccessibilitySettings): void;

  getPdfAnnotations(documentId: string): PdfAnnotationItem[];
  savePdfAnnotations(documentId: string, annotations: PdfAnnotationItem[]): void;

  getStudentProfile(): StudentAcademicProfile;
  hasSavedStudentProfile(): boolean;
  saveStudentProfile(profile: StudentAcademicProfile): void;

  clearAllProgress(): void;

  // Study sessions (learning contexts; not focus-timer records). Stored per account on the
  // device; synced to the account only when the studySessionCloudSync feature is enabled.
  getStudySessions(): StudySession[];
  getStudySession(id: string): StudySession | null;
  createStudySession(input: StudySessionInput): StudySession;
  updateStudySession(id: string, patch: StudySessionPatch): StudySession | null;
  deleteStudySession(id: string): boolean;
  /** Idempotent insert of pre-built sessions (e.g. migration); existing and deleted ids are skipped. */
  insertStudySessions(sessions: StudySession[]): { inserted: string[]; skipped: Array<{ id: string; reason: string }> };
  getDeletedStudySessionIds(): string[];
  getStudySessionSyncState(id: string): StudySessionSyncState;
  isStudySessionCloudSyncEnabled(): boolean;
  /** True once this account's first full cloud sync finished without errors (always true for guests). */
  isInitialSyncComplete(): boolean;
  /** Creates one session per document that has none (by reference; documents are never changed). */
  runDocumentSessionMigration(): DocumentSessionMigrationReport;
  getLastDocumentSessionMigrationReport(): DocumentSessionMigrationReport | null;

  /** Connects the cloud document store (Firestore in the app; in-memory in tests). */
  attachCloudStore(store: CloudDocStore): void;
  /** Switches local storage to the given account's private scope (or the guest scope). */
  activateAccount(user: User | null): void;
  /** Activates the account scope and synchronises it with the cloud. */
  syncWithCloudUser(user: User | null): Promise<void>;
  /** Waits (up to timeoutMs) for queued cloud writes to settle. */
  flushPendingWrites(timeoutMs?: number): Promise<void>;
  getSyncSnapshot(): SyncSnapshot;
  getUnsyncedChangeCount(): number;
  getDeviceOnlyDataSummary(): DeviceOnlyDataSummary;
  /** Removes the signed-in account's private data from this device (explicit sign-out). */
  clearCurrentAccountFromDevice(): void;
  /**
   * Deletes one signed-in account's private local data (its scope only) from this device. Never
   * touches the guest scope or other accounts. Returns the number of storage entries removed.
   */
  removeAccountDataFromDevice(uid: string): number;
  getActiveScope(): LocalScope | null;
  getLastLegacyMigration(): LegacyMigrationResult | null;
  subscribe(listener: () => void): () => void;
}

export interface DeviceOnlyDataSummary {
  notebookEntries: number;
  plannerTasks: number;
  annotatedDocuments: number;
  focusSessions: number;
  creativeAssets: number;
  /** Study sessions kept only on this device (cloud sync for sessions is not enabled yet). */
  studySessions: number;
}

export interface StudySessionInput {
  name: string;
  subjectId?: JeeSubjectId;
  chapterId?: string;
  topicIds?: string[];
  resourceIds?: string[];
}

export type StudySessionPatch = Partial<Pick<StudySession, 'name' | 'subjectId' | 'chapterId' | 'topicIds' | 'resourceIds' | 'lastActiveAt'>>;

export class StudySessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudySessionError';
  }
}

export interface DocumentSessionMigrationReport {
  /**
   * completed: every eligible document has a session; partial: some documents failed;
   * failed: nothing could be saved (retry later); not_ready: data not fully loaded yet;
   * disabled: the documentSessionMigration feature is off.
   */
  status: 'completed' | 'partial' | 'failed' | 'not_ready' | 'disabled';
  reason?: string;
  scope: 'guest' | 'account' | 'none';
  ranAt: string;
  /** Documents with a valid, unique id (each can have exactly one migrated session). */
  eligibleDocumentIds: string[];
  migrated: Array<{ documentId: string; sessionId: string }>;
  alreadyMigrated: string[];
  skipped: Array<{ documentId: string; reason: string }>;
  errors: Array<{ documentId: string; reason: string }>;
}

/** Upper bound on remembered deletions per account (ids are short; this is far above real use). */
const MAX_STUDY_SESSION_TOMBSTONES = 5_000;

const KEYS = STORAGE_KEYS;

const DEFAULT_TIMER_STATE: StudyTimerState = {
  mode: 'study',
  durationMinutes: 25,
  breakMinutes: 5,
  remainingSeconds: 25 * 60,
  isRunning: false,
  targetEndTimestamp: null,
  soundEnabled: true,
  completedSessionsCount: 0,
  activeLofiPresetId: 'rainy-night',
  lofiPlaying: false,
  lofiVolume: 0.45,
};

const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
  fontSize: 'normal',
  readingWidth: 'standard',
  highContrast: false,
  reducedMotion: false,
};

/**
 * Neutral form defaults for a student who has not filled in their profile yet. These are not
 * shown as facts about the student: no name, school, university, goal or weak areas are assumed.
 * `updatedAt` is empty until the student saves the profile.
 */
export const DEFAULT_STUDENT_PROFILE: StudentAcademicProfile = {
  fullName: '',
  educationStage: 'school',
  schoolClass: 'Class 12',
  stream: 'PCM',
  schoolBoard: 'CBSE',
  schoolName: '',
  collegeYear: '1st Year',
  degreeCourse: '',
  universityName: '',
  academicYear: '',
  primaryGoal: 'competitive_exam',
  targetExam: 'jee_main',
  targetExamYear: '',
  subjectsStudied: ['Physics', 'Chemistry', 'Mathematics'],
  weakAreas: [],
  preferredLanguage: 'English',
  personalGoalStatement: '',
  dailyStudyMinutesGoal: 0,
  updatedAt: '',
};

/** Ids of demo content seeded by earlier versions. Untouched copies are no longer shown or synced. */
export const LEGACY_STARTER_DOCUMENT_IDS: ReadonlySet<string> = new Set([
  'doc-probability-notes',
  'doc-sets-relations',
  'doc-stats-chapter-3',
]);
const LEGACY_STARTER_PLANNER_IDS: ReadonlySet<string> = new Set(['plan-task-1', 'plan-task-2', 'plan-task-3']);
const LEGACY_STARTER_NOTIFICATION_PREFIX = 'notif-starter-';

function isLegacyStarterNotification(n: { id?: unknown }): boolean {
  return typeof n?.id === 'string' && n.id.startsWith(LEGACY_STARTER_NOTIFICATION_PREFIX);
}

/** Drops seeded demo content while moving pre-scoping local data into the guest scope. */
export function legacyMigrationTransform(
  rawKey: string,
  value: string,
  legacy: ReadonlyMap<string, string>
): string | null {
  try {
    if (rawKey === KEYS.SEEDED) return null;
    if (rawKey === KEYS.NOTIFICATIONS) {
      const list = JSON.parse(value);
      return Array.isArray(list) ? JSON.stringify(list.filter((n) => !isLegacyStarterNotification(n))) : value;
    }
    if (rawKey === KEYS.STUDY_PLANNER) {
      const list = JSON.parse(value);
      return Array.isArray(list)
        ? JSON.stringify(list.filter((t) => !(t && LEGACY_STARTER_PLANNER_IDS.has(t.id))))
        : value;
    }
    if (rawKey === KEYS.DOCUMENTS || rawKey === KEYS.ACTIVE_DOC_ID) {
      const used = collectUsedDocumentIds(legacy);
      const isUnusedStarter = (id: unknown) =>
        typeof id === 'string' && LEGACY_STARTER_DOCUMENT_IDS.has(id) && !used.has(id);
      if (rawKey === KEYS.ACTIVE_DOC_ID) return isUnusedStarter(value) ? null : value;
      const list = JSON.parse(value);
      return Array.isArray(list) ? JSON.stringify(list.filter((d) => !isUnusedStarter(d?.id))) : value;
    }
  } catch {
    // Unparseable legacy values are moved unchanged rather than dropped.
  }
  return value;
}

/**
 * Cached practice sets reference a server-held set (with answer keys kept on the server).
 * Legacy caches (arrays of questions with answers) and expired sets are ignored.
 */
export function isUsableCachedPracticeSet(value: unknown, now: Date = new Date()): value is CachedPracticeSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const set = value as Partial<CachedPracticeSet>;
  return (
    typeof set.setId === 'string' &&
    Array.isArray(set.questions) &&
    set.questions.length > 0 &&
    typeof set.expiresAt === 'string' &&
    new Date(set.expiresAt).getTime() > now.getTime()
  );
}

function browserStorage(): KeyValueStorage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // storage blocked (e.g. privacy mode)
  }
  return null;
}

type DirtyKind = keyof DirtySet;

const PROFILE_DIRTY_ID = 'me';

export class HybridCloudStudyRepository implements IStudyStorageRepository {
  private readonly storage: KeyValueStorage | null;
  private scope: LocalScope | null = null;
  private currentUser: User | null = null;
  private cloud: CloudDocStore | null = null;
  private cloudUnsubscribers: Array<() => void> = [];
  private readonly listeners = new Set<() => void>();
  private readonly chunkCounts = new Map<string, number>();
  private readonly writeQueues = new Map<string, Promise<void>>();
  private generation = 0;
  private revisionCounter = 0;
  private lastMigration: LegacyMigrationResult | null = null;
  private readonly sync: SyncStatusTracker;
  private readonly studySessionCloudSync: boolean;
  /** Session ids whose current version is confirmed in the cloud (this account, this run). */
  private readonly studySessionsConfirmed = new Set<string>();
  private readonly documentSessionMigration: boolean;
  /** Generation whose first full sync completed cleanly (null until then). */
  private initialSyncGeneration: number | null = null;

  constructor(
    options: { storage?: KeyValueStorage | null; studySessionCloudSync?: boolean; documentSessionMigration?: boolean } = {}
  ) {
    this.storage = options.storage !== undefined ? options.storage : browserStorage();
    this.studySessionCloudSync = options.studySessionCloudSync ?? isFeatureEnabled('studySessionCloudSync');
    this.documentSessionMigration = options.documentSessionMigration ?? isFeatureEnabled('documentSessionMigration');
    this.sync = new SyncStatusTracker(() => this.getUnsyncedChangeCount());
    this.sync.subscribe(() => this.notifyListeners());
  }

  // -------------------------------------------------------------------------
  // Scoped local storage primitives
  // -------------------------------------------------------------------------

  private physicalKey(rawKey: string): string | null {
    if (!isPrivateRawKey(rawKey)) return rawKey;
    if (!this.scope) return null;
    return scopedKey(this.scope, rawKey);
  }

  private read<T>(rawKey: string, fallback: T): T {
    const key = this.physicalKey(rawKey);
    if (!key || !this.storage) return fallback;
    try {
      const raw = this.storage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private write<T>(rawKey: string, value: T): boolean {
    const key = this.physicalKey(rawKey);
    if (!this.storage) return false;
    if (!key) {
      console.warn('[storage] Ignored a write before the account scope was resolved.');
      return false;
    }
    try {
      this.storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('[storage] Local write failed:', err instanceof Error ? err.message : err);
      this.sync.recordError('This device ran out of storage space; the latest change was not saved.');
      return false;
    }
  }

  private removeKey(rawKey: string): void {
    const key = this.physicalKey(rawKey);
    if (!key || !this.storage) return;
    try {
      this.storage.removeItem(key);
    } catch {
      // ignore
    }
  }

  private readString(rawKey: string): string | null {
    const key = this.physicalKey(rawKey);
    if (!key || !this.storage) return null;
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeString(rawKey: string, value: string): void {
    const key = this.physicalKey(rawKey);
    if (!key || !this.storage) return;
    try {
      this.storage.setItem(key, value);
    } catch {
      // ignore
    }
  }

  // -------------------------------------------------------------------------
  // Listeners & status
  // -------------------------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // ignore listener error
      }
    }
  }

  getSyncSnapshot(): SyncSnapshot {
    return this.sync.snapshot();
  }

  getActiveScope(): LocalScope | null {
    return this.scope;
  }

  getLastLegacyMigration(): LegacyMigrationResult | null {
    return this.lastMigration;
  }

  attachCloudStore(store: CloudDocStore): void {
    this.cloud = withFirestoreSafeWrites(store);
  }

  // -------------------------------------------------------------------------
  // Dirty tracking: every cloud write is recorded before it starts and cleared only after it
  // succeeds, so unsynced changes survive reloads and are retried on the next sync.
  // -------------------------------------------------------------------------

  private readDirty(): DirtySet {
    if (!this.scope || !this.storage) return emptyDirtySet();
    return readDirtySet(this.storage, this.scope);
  }

  private writeDirty(dirty: DirtySet): void {
    this.write(KEYS.SYNC_DIRTY, dirty);
  }

  private markDirty(kind: DirtyKind, id: string): number {
    const dirty = this.readDirty();
    const revision = Date.now() * 1000 + (this.revisionCounter++ % 1000);
    dirty[kind][id] = revision;
    if (kind === 'documents') delete dirty.deletedDocuments[id];
    if (kind === 'deletedDocuments') delete dirty.documents[id];
    if (kind === 'studySessions') delete dirty.deletedStudySessions[id];
    if (kind === 'deletedStudySessions') delete dirty.studySessions[id];
    this.writeDirty(dirty);
    return revision;
  }

  private clearDirty(kind: DirtyKind, id: string, revision: number): void {
    const dirty = this.readDirty();
    if (dirty[kind][id] === revision) {
      delete dirty[kind][id];
      this.writeDirty(dirty);
    }
  }

  /** Clears a dirty mark regardless of revision (the cloud already holds the winning version). */
  private settleDirty(kinds: DirtyKind[], id: string): void {
    const dirty = this.readDirty();
    let changed = false;
    for (const kind of kinds) {
      if (dirty[kind][id] !== undefined) {
        delete dirty[kind][id];
        changed = true;
      }
    }
    if (changed) this.writeDirty(dirty);
  }

  getUnsyncedChangeCount(): number {
    if (!this.currentUser) return 0;
    return countDirty(this.readDirty());
  }

  getDeviceOnlyDataSummary(): DeviceOnlyDataSummary {
    const annotatedDocuments =
      this.scope && this.storage
        ? listScopeRawKeys(this.storage, this.scope).filter((k) => k.startsWith(KEYS.PDF_ANNOTATIONS_PREFIX)).length
        : 0;
    return {
      notebookEntries: this.read<NotebookEntry[]>(KEYS.NOTEBOOK, []).length,
      plannerTasks: this.read<StudyPlannerTask[]>(KEYS.STUDY_PLANNER, []).length,
      annotatedDocuments,
      focusSessions: this.read<FocusSessionRecord[]>(KEYS.FOCUS_SESSIONS, []).length,
      creativeAssets: this.read<CreativeAsset[]>(KEYS.CREATIVE_ASSETS, []).length,
      studySessions: this.studySessionCloudSync ? 0 : this.getStudySessions().length,
    };
  }

  // -------------------------------------------------------------------------
  // Account scope switching
  // -------------------------------------------------------------------------

  private unsubscribeCloudListeners(): void {
    while (this.cloudUnsubscribers.length > 0) {
      const unsub = this.cloudUnsubscribers.pop();
      try {
        unsub?.();
      } catch {
        // ignore
      }
    }
  }

  activateAccount(user: User | null): void {
    if (this.storage && this.lastMigration === null) {
      this.lastMigration = migrateLegacyKeysToGuest(this.storage, legacyMigrationTransform);
      if (this.lastMigration.status === 'failed') {
        console.warn('[storage] Legacy local data migration failed; it will be retried.', this.lastMigration.error);
      }
    }
    const nextScope = scopeForUid(user?.uid ?? null);
    const sameAccount = this.scope === nextScope && (this.currentUser?.uid ?? null) === (user?.uid ?? null);
    if (sameAccount) {
      this.currentUser = user;
      return;
    }
    this.unsubscribeCloudListeners();
    this.generation++;
    this.chunkCounts.clear();
    this.writeQueues.clear();
    this.studySessionsConfirmed.clear();
    this.currentUser = user;
    this.scope = nextScope;
    this.sync.setSignedIn(Boolean(user));
    this.notifyListeners();
    // Guest data is local only, so it is complete as soon as the scope is active.
    if (!user && this.documentSessionMigration) this.runDocumentSessionMigration();
  }

  clearCurrentAccountFromDevice(): void {
    if (!this.storage || !this.scope || this.scope === 'guest') return;
    const scope = this.scope;
    this.unsubscribeCloudListeners();
    this.generation++;
    this.writeQueues.clear();
    this.chunkCounts.clear();
    this.studySessionsConfirmed.clear();
    this.currentUser = null;
    this.scope = null;
    clearScope(this.storage, scope);
    this.sync.setSignedIn(false);
    this.notifyListeners();
  }

  removeAccountDataFromDevice(uid: string): number {
    if (!this.storage) return 0;
    const target = scopeForUid(uid);
    if (target === 'guest') throw new Error('Refusing to remove guest data as an account.');
    if (this.scope === target) {
      // Still active: detach first so nothing is written back into the scope being removed.
      this.unsubscribeCloudListeners();
      this.generation++;
      this.writeQueues.clear();
      this.chunkCounts.clear();
      this.studySessionsConfirmed.clear();
      this.currentUser = null;
      this.scope = null;
      this.sync.setSignedIn(false);
    }
    const removed = clearScope(this.storage, target);
    this.notifyListeners();
    return removed;
  }

  async flushPendingWrites(timeoutMs = 8_000): Promise<void> {
    const pending = Promise.allSettled([...this.writeQueues.values()]);
    await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  }

  // -------------------------------------------------------------------------
  // Cloud writes
  // -------------------------------------------------------------------------

  private queueCloudWrite(
    kind: DirtyKind,
    id: string,
    parentPath: string,
    buildOps: (previousChunkCount: number) => CloudWriteOp[],
    tracksChunks = true
  ): Promise<void> {
    if (!this.currentUser || !this.cloud) return Promise.resolve();
    const cloud = this.cloud;
    const generation = this.generation;
    const revision = this.markDirty(kind, id);

    const run = async () => {
      if (generation !== this.generation) return;
      let previous = 0;
      if (tracksChunks) {
        const cached = this.chunkCounts.get(parentPath);
        previous = cached !== undefined ? cached : chunkCountOf(await cloud.getDoc(parentPath));
      }
      const ops = buildOps(previous);
      await cloud.commit(ops);
      if (tracksChunks) {
        const written = ops.filter((op) => op.type === 'set' && op.path.startsWith(`${parentPath}/chunks/`)).length;
        const deletedParent = ops.some((op) => op.type === 'delete' && op.path === parentPath);
        this.chunkCounts.set(parentPath, deletedParent ? 0 : written);
      }
      if (generation === this.generation) this.clearDirty(kind, id, revision);
    };

    const previousTask = this.writeQueues.get(parentPath) || Promise.resolve();
    const task = previousTask
      .catch(() => undefined)
      .then(() => this.sync.track(run))
      .catch((err: unknown) => {
        const message =
          err instanceof PayloadTooLargeError
            ? 'An item is too large to sync to your account. It is saved on this device only.'
            : `Cloud sync failed (${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}).`;
        console.warn(`[sync] ${parentPath}: ${message}`);
        this.sync.recordError(message);
      });
    this.writeQueues.set(parentPath, task);
    return task;
  }

  private persistDocumentToCloud(studyDoc: StudyDocument): Promise<void> {
    const uid = this.currentUser?.uid;
    if (!uid || !isSafeCloudId(studyDoc.id)) return Promise.resolve();
    return this.queueCloudWrite('documents', studyDoc.id, cloudPaths.document(uid, studyDoc.id), (prev) =>
      encodeStudyDocument(uid, studyDoc, prev)
    );
  }

  private persistAttemptToCloud(attempt: QuizAttempt): Promise<void> {
    const uid = this.currentUser?.uid;
    if (!uid || !isSafeCloudId(attempt.id)) return Promise.resolve();
    return this.queueCloudWrite('attempts', attempt.id, cloudPaths.attempt(uid, attempt.id), (prev) =>
      encodeQuizAttempt(uid, attempt, prev)
    );
  }

  private collectStudyState(documentId: string): StudyStatePayload {
    return {
      tutorMessages: this.getTutorMessages(documentId),
      mistakes: this.getMistakeInsights(documentId),
      revisionPlan: this.getRevisionPlan(documentId),
      cachedQuiz: this.getCachedQuiz(documentId, 'diagnostic'),
      quickRevise: this.getQuickReviseBundle(documentId),
    };
  }

  private persistStudyStateToCloud(documentId: string): Promise<void> {
    const uid = this.currentUser?.uid;
    if (!uid || !isSafeCloudId(documentId)) return Promise.resolve();
    return this.queueCloudWrite('studyState', documentId, cloudPaths.studyState(uid, documentId), (prev) =>
      encodeStudyState(uid, documentId, this.collectStudyState(documentId), new Date().toISOString(), prev)
    );
  }

  private deleteDocumentFromCloud(documentId: string): Promise<void> {
    const uid = this.currentUser?.uid;
    if (!uid || !isSafeCloudId(documentId)) return Promise.resolve();
    return this.queueCloudWrite('deletedDocuments', documentId, cloudPaths.document(uid, documentId), (prev) =>
      deleteEntityOps(cloudPaths.document(uid, documentId), prev)
    );
  }

  private persistProfileToCloud(): Promise<void> {
    const user = this.currentUser;
    if (!user) return Promise.resolve();
    const uid = user.uid;
    const profile = this.read<StudentAcademicProfile | null>(KEYS.STUDENT_PROFILE, null);
    if (!profile) return Promise.resolve();
    return this.queueCloudWrite(
      'profile',
      PROFILE_DIRTY_ID,
      `${cloudPaths.user(uid)}#profile`,
      () => [
        {
          type: 'set',
          path: cloudPaths.user(uid),
          merge: true,
          data: { uid, updatedAt: new Date().toISOString(), studentProfileJson: JSON.stringify(profile) },
        },
      ],
      false
    );
  }

  /** Re-sends every change that was recorded as not yet confirmed by the cloud. */
  private async flushDirty(): Promise<void> {
    const dirty = this.readDirty();
    const tasks: Promise<void>[] = [];
    const docsById = new Map(this.getDocuments().map((d) => [d.id, d]));
    for (const id of Object.keys(dirty.documents)) {
      const local = docsById.get(id);
      if (local) tasks.push(this.persistDocumentToCloud(local));
    }
    for (const id of Object.keys(dirty.deletedDocuments)) tasks.push(this.deleteDocumentFromCloud(id));
    const attemptsById = new Map(this.getQuizAttempts().map((a) => [a.id, a]));
    const uid = this.currentUser?.uid;
    for (const id of Object.keys(dirty.attempts)) {
      const local = attemptsById.get(id);
      if (local) {
        tasks.push(this.persistAttemptToCloud(local));
      } else if (uid && isSafeCloudId(id)) {
        // The attempt was removed locally (progress reset); finish removing it from the cloud.
        tasks.push(
          this.queueCloudWrite('attempts', id, cloudPaths.attempt(uid, id), (prev) =>
            deleteEntityOps(cloudPaths.attempt(uid, id), prev)
          )
        );
      }
    }
    for (const id of Object.keys(dirty.studyState)) tasks.push(this.persistStudyStateToCloud(id));
    if (dirty.profile[PROFILE_DIRTY_ID]) tasks.push(this.persistProfileToCloud());
    for (const id of Object.keys(dirty.studySessions)) tasks.push(this.queueStudySessionSync('studySessions', id));
    for (const id of Object.keys(dirty.deletedStudySessions)) tasks.push(this.queueStudySessionSync('deletedStudySessions', id));
    await Promise.allSettled(tasks);
  }

  private isUnusedLegacyStarter(documentId: string, attempts: QuizAttempt[]): boolean {
    if (!LEGACY_STARTER_DOCUMENT_IDS.has(documentId)) return false;
    if (attempts.some((a) => a.documentId === documentId)) return false;
    const state = this.collectStudyState(documentId);
    return (
      state.tutorMessages.length === 0 &&
      state.mistakes.length === 0 &&
      state.revisionPlan.length === 0 &&
      !state.cachedQuiz &&
      !state.quickRevise
    );
  }

  // -------------------------------------------------------------------------
  // Cloud sync
  // -------------------------------------------------------------------------

  /**
   * Synchronises the signed-in account's own local scope with its cloud data. Data from the
   * guest scope or from other accounts on this device is never read here, so it can never be
   * uploaded into this account.
   */
  async syncWithCloudUser(user: User | null): Promise<void> {
    this.activateAccount(user);
    if (!user || !this.cloud) {
      this.notifyListeners();
      return;
    }
    const cloud = this.cloud;
    const uid = user.uid;
    const generation = this.generation;
    const stillCurrent = () => generation === this.generation;
    let unreadable = 0;

    try {
      await this.sync.track(() =>
        cloud.commit([
          {
            type: 'set',
            path: cloudPaths.user(uid),
            merge: true,
            data: {
              uid,
              email: (user.email || '').slice(0, 320),
              displayName: (user.displayName || 'LearnMate Student').slice(0, 160),
              photoURL: (user.photoURL || '').slice(0, 2048),
              updatedAt: new Date().toISOString(),
            },
          },
        ])
      );
      if (!stillCurrent()) return;

      // 1. Retry anything that previously failed to reach the cloud.
      await this.flushDirty();
      if (!stillCurrent()) return;

      // 2. Profile.
      const userDoc = await cloud.getDoc(cloudPaths.user(uid));
      if (!stillCurrent()) return;
      if (!this.hasSavedStudentProfile() && typeof userDoc?.studentProfileJson === 'string') {
        try {
          const cloudProfile = JSON.parse(userDoc.studentProfileJson) as StudentAcademicProfile;
          if (cloudProfile && typeof cloudProfile === 'object') this.write(KEYS.STUDENT_PROFILE, cloudProfile);
        } catch {
          unreadable++;
        }
      } else if (this.hasSavedStudentProfile() && typeof userDoc?.studentProfileJson !== 'string') {
        void this.persistProfileToCloud();
      }

      // 3. Attempts (union of local and cloud).
      const cloudAttempts = await cloud.listCollection(cloudPaths.attempts(uid));
      if (!stillCurrent()) return;
      const attemptMap = new Map(this.getQuizAttempts().map((a) => [a.id, a]));
      const cloudAttemptIds = new Set<string>();
      for (const entry of cloudAttempts) {
        cloudAttemptIds.add(entry.id);
        this.chunkCounts.set(cloudPaths.attempt(uid, entry.id), chunkCountOf(entry.data));
        if (attemptMap.has(entry.id)) continue;
        try {
          const attempt = await decodeQuizAttempt(cloud, uid, entry.data);
          attemptMap.set(attempt.id, attempt);
        } catch {
          unreadable++;
        }
      }
      if (!stillCurrent()) return;
      const mergedAttempts = [...attemptMap.values()].sort(
        (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
      );
      this.write(KEYS.ATTEMPTS, mergedAttempts);
      for (const attempt of mergedAttempts) {
        if (!cloudAttemptIds.has(attempt.id)) void this.persistAttemptToCloud(attempt);
      }

      // 4. Documents (newest copy wins; unreadable cloud copies never replace local ones).
      const cloudDocs = await cloud.listCollection(cloudPaths.documents(uid));
      if (!stillCurrent()) return;
      const localDocs = this.getDocuments();
      const docMap = new Map(localDocs.map((d) => [d.id, d]));
      const cloudDocIds = new Set<string>();
      const toPush: StudyDocument[] = [];
      for (const entry of cloudDocs) {
        cloudDocIds.add(entry.id);
        this.chunkCounts.set(cloudPaths.document(uid, entry.id), chunkCountOf(entry.data));
        if (this.isUnusedLegacyStarter(entry.id, mergedAttempts)) continue;
        const local = docMap.get(entry.id);
        const cloudTime = new Date(String(entry.data.lastStudiedAt || '')).getTime() || 0;
        const localTime = local ? new Date(local.lastStudiedAt).getTime() || 0 : -1;
        if (local && localTime > cloudTime) {
          toPush.push(local);
          continue;
        }
        if (local && localTime === cloudTime) continue;
        try {
          const decoded = await decodeStudyDocument(cloud, uid, entry.data);
          docMap.set(decoded.id, { ...decoded, pdfDataUrl: local?.pdfDataUrl });
        } catch {
          unreadable++;
          if (local) toPush.push(local); // repair the corrupted cloud copy from this device
        }
      }
      if (!stillCurrent()) return;
      for (const local of localDocs) {
        if (!cloudDocIds.has(local.id) && !this.isUnusedLegacyStarter(local.id, mergedAttempts)) toPush.push(local);
      }
      const mergedDocs = [...docMap.values()].sort(
        (a, b) => new Date(b.lastStudiedAt).getTime() - new Date(a.lastStudiedAt).getTime()
      );
      this.write(KEYS.DOCUMENTS, mergedDocs);
      for (const d of toPush) void this.persistDocumentToCloud(d);

      // 4b. Study sessions (only when session cloud sync is enabled).
      unreadable += await this.syncStudySessions(uid, stillCurrent);
      if (!stillCurrent()) return;

      // 5. Per-document study state.
      for (const studyDoc of mergedDocs) {
        const statePath = cloudPaths.studyState(uid, studyDoc.id);
        const stateData = await cloud.getDoc(statePath);
        if (!stillCurrent()) return;
        this.chunkCounts.set(statePath, chunkCountOf(stateData));
        const local = this.collectStudyState(studyDoc.id);
        const localHasState =
          local.tutorMessages.length > 0 ||
          local.mistakes.length > 0 ||
          local.revisionPlan.length > 0 ||
          Boolean(local.cachedQuiz) ||
          Boolean(local.quickRevise);
        if (!stateData) {
          if (localHasState) void this.persistStudyStateToCloud(studyDoc.id);
          continue;
        }
        try {
          const remote = await decodeStudyState(cloud, uid, studyDoc.id, stateData);
          if (!stillCurrent()) return;
          if (local.tutorMessages.length === 0 && remote.tutorMessages.length > 0)
            this.write(`${KEYS.TUTOR_PREFIX}${studyDoc.id}`, remote.tutorMessages);
          if (local.mistakes.length === 0 && remote.mistakes.length > 0)
            this.write(`${KEYS.MISTAKES_PREFIX}${studyDoc.id}`, remote.mistakes);
          if (local.revisionPlan.length === 0 && remote.revisionPlan.length > 0)
            this.write(`${KEYS.REVISION_PREFIX}${studyDoc.id}`, remote.revisionPlan);
          if (!local.cachedQuiz && remote.cachedQuiz)
            this.write(`${KEYS.QUIZ_CACHE_PREFIX}${studyDoc.id}_diagnostic`, remote.cachedQuiz);
          if (!local.quickRevise && remote.quickRevise && remote.quickRevise.documentId)
            this.write(`${KEYS.QUICK_REVISE_PREFIX}${studyDoc.id}`, remote.quickRevise);
        } catch {
          unreadable++;
          if (localHasState) void this.persistStudyStateToCloud(studyDoc.id);
        }
      }
      if (!stillCurrent()) return;

      if (unreadable > 0) {
        this.sync.recordError(
          `${unreadable} cloud item${unreadable === 1 ? '' : 's'} could not be read and ${
            unreadable === 1 ? 'was' : 'were'
          } left unchanged.`
        );
      }

      // Migration may only use fully loaded data: a clean, complete sync of this account.
      if (unreadable === 0) {
        this.initialSyncGeneration = generation;
        if (this.documentSessionMigration) this.runDocumentSessionMigration();
      }

      this.subscribeToCloud(uid, generation);
      this.notifyListeners();
    } catch (err) {
      if (stillCurrent()) {
        this.sync.recordError(
          `Could not sync with your account (${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}).`
        );
        this.notifyListeners();
      }
    }
  }

  private subscribeToCloud(uid: string, generation: number): void {
    if (!this.cloud) return;
    const cloud = this.cloud;
    const stillCurrent = () => generation === this.generation && this.currentUser?.uid === uid;

    const docsUnsub = cloud.subscribeCollection(
      cloudPaths.documents(uid),
      (entries) => {
        if (!stillCurrent()) return;
        void (async () => {
          const dirty = this.readDirty();
          const map = new Map(this.getDocuments().map((d) => [d.id, d]));
          let changed = false;
          for (const entry of entries) {
            if (dirty.documents[entry.id] || dirty.deletedDocuments[entry.id]) continue;
            const local = map.get(entry.id);
            const cloudTime = new Date(String(entry.data.lastStudiedAt || '')).getTime() || 0;
            if (local && cloudTime <= (new Date(local.lastStudiedAt).getTime() || 0)) continue;
            if (!local && this.isUnusedLegacyStarter(entry.id, this.getQuizAttempts())) continue;
            try {
              const decoded = await decodeStudyDocument(cloud, uid, entry.data);
              if (!stillCurrent()) return;
              this.chunkCounts.set(cloudPaths.document(uid, entry.id), chunkCountOf(entry.data));
              map.set(decoded.id, { ...decoded, pdfDataUrl: local?.pdfDataUrl });
              changed = true;
            } catch {
              // Leave the local copy unchanged; the next full sync reports unreadable items.
            }
          }
          if (changed && stillCurrent()) {
            const updated = [...map.values()].sort(
              (a, b) => new Date(b.lastStudiedAt).getTime() - new Date(a.lastStudiedAt).getTime()
            );
            this.write(KEYS.DOCUMENTS, updated);
            this.notifyListeners();
          }
        })();
      },
      () => {
        // Permission errors during sign-out transitions are expected.
      }
    );

    const attemptsUnsub = cloud.subscribeCollection(
      cloudPaths.attempts(uid),
      (entries) => {
        if (!stillCurrent()) return;
        void (async () => {
          const map = new Map(this.getQuizAttempts().map((a) => [a.id, a]));
          let changed = false;
          for (const entry of entries) {
            if (map.has(entry.id)) continue;
            try {
              const attempt = await decodeQuizAttempt(cloud, uid, entry.data);
              if (!stillCurrent()) return;
              map.set(attempt.id, attempt);
              changed = true;
            } catch {
              // ignore unreadable attempt
            }
          }
          if (changed && stillCurrent()) {
            const updated = [...map.values()].sort(
              (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
            );
            this.write(KEYS.ATTEMPTS, updated);
            this.notifyListeners();
          }
        })();
      },
      () => {
        // ignore
      }
    );

    this.cloudUnsubscribers.push(docsUnsub, attemptsUnsub);

    if (this.studySessionCloudSync) {
      const sessionsUnsub = cloud.subscribeCollection(
        cloudPaths.studySessions(uid),
        (entries) => {
          if (!stillCurrent()) return;
          const dirty = this.readDirty();
          let changed = false;
          for (const entry of entries) {
            // Pending local writes resolve against the cloud themselves when they run.
            if (dirty.studySessions[entry.id] !== undefined || dirty.deletedStudySessions[entry.id] !== undefined) continue;
            const remote = decodeStudySessionDoc(entry.id, entry.data);
            if (!remote) continue;
            const action = resolveStudySession(this.getStudySession(entry.id) ?? undefined, this.readStudySessionTombstones()[entry.id], remote);
            if (action === 'adopt_remote' || action === 'adopt_tombstone' || action === 'in_sync') {
              try {
                if (this.applyStudySessionResolution(entry.id, action, remote)) changed = true;
              } catch (err) {
                this.sync.recordError(err instanceof Error ? err.message : 'A study session update could not be saved on this device.');
              }
            }
          }
          if (changed && stillCurrent()) this.notifyListeners();
        },
        () => {
          // Permission errors during sign-out transitions are expected.
        }
      );
      this.cloudUnsubscribers.push(sessionsUnsub);
    }
  }

  // -------------------------------------------------------------------------
  // Study sessions
  // -------------------------------------------------------------------------

  isStudySessionCloudSyncEnabled(): boolean {
    return this.studySessionCloudSync;
  }

  private readStudySessions(): StudySession[] {
    const list = this.read<StudySession[]>(KEYS.STUDY_SESSIONS, []);
    return Array.isArray(list) ? list.filter((s) => s && validateSession(s).length === 0) : [];
  }

  private readStudySessionTombstones(): Record<string, StudySessionTombstone> {
    const map = this.read<Record<string, StudySessionTombstone>>(KEYS.STUDY_SESSION_TOMBSTONES, {});
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  }

  private writeStudySessionState(sessions: StudySession[], tombstones?: Record<string, StudySessionTombstone>): void {
    if (tombstones) {
      const entries = Object.entries(tombstones);
      const bounded =
        entries.length > MAX_STUDY_SESSION_TOMBSTONES
          ? Object.fromEntries(entries.sort(([, a], [, b]) => (a.deletedAt < b.deletedAt ? 1 : -1)).slice(0, MAX_STUDY_SESSION_TOMBSTONES))
          : tombstones;
      if (!this.write(KEYS.STUDY_SESSION_TOMBSTONES, bounded)) {
        throw new StudySessionError('This device ran out of storage space; the study session was not saved.');
      }
    }
    if (!this.write(KEYS.STUDY_SESSIONS, sessions)) {
      throw new StudySessionError('This device ran out of storage space; the study session was not saved.');
    }
  }

  getStudySessions(): StudySession[] {
    return this.readStudySessions().sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : a.lastActiveAt > b.lastActiveAt ? -1 : 0));
  }

  getStudySession(id: string): StudySession | null {
    return this.readStudySessions().find((s) => s.id === id) ?? null;
  }

  getDeletedStudySessionIds(): string[] {
    return Object.keys(this.readStudySessionTombstones());
  }

  createStudySession(input: StudySessionInput): StudySession {
    if (!this.scope) throw new StudySessionError('Study sessions are unavailable until the account is ready.');
    const tombstones = this.readStudySessionTombstones();
    let id = newStudySessionId();
    while (tombstones[id] || this.getStudySession(id)) id = newStudySessionId();
    let session: StudySession;
    try {
      session = createSession({ id, ...input });
    } catch (err) {
      throw new StudySessionError(err instanceof Error ? err.message : 'Invalid study session.');
    }
    this.writeStudySessionState([session, ...this.readStudySessions()]);
    void this.queueStudySessionSync('studySessions', session.id);
    this.notifyListeners();
    return session;
  }

  updateStudySession(id: string, patch: StudySessionPatch): StudySession | null {
    const sessions = this.readStudySessions();
    const index = sessions.findIndex((s) => s.id === id);
    if (index < 0) return null;
    const previous = sessions[index];
    const merged: StudySession = { ...previous };
    if (patch.name !== undefined) merged.name = patch.name.trim();
    if ('subjectId' in patch) merged.subjectId = patch.subjectId;
    if ('chapterId' in patch) merged.chapterId = patch.chapterId;
    if (patch.topicIds !== undefined) merged.topicIds = [...new Set(patch.topicIds)];
    if (patch.resourceIds !== undefined) merged.resourceIds = [...new Set(patch.resourceIds)];
    if (patch.lastActiveAt !== undefined) merged.lastActiveAt = patch.lastActiveAt;
    merged.updatedAt = nextUpdatedAt(previous.updatedAt);
    if (!merged.subjectId) delete merged.subjectId;
    if (!merged.chapterId) delete merged.chapterId;
    const errors = validateSession(merged);
    if (errors.length > 0) throw new StudySessionError(`Invalid study session: ${errors.join('; ')}`);
    sessions[index] = merged;
    this.writeStudySessionState(sessions);
    void this.queueStudySessionSync('studySessions', id);
    this.notifyListeners();
    return merged;
  }

  deleteStudySession(id: string): boolean {
    const sessions = this.readStudySessions();
    const existing = sessions.find((s) => s.id === id);
    if (!existing) return false;
    const deletedAt = nextUpdatedAt(existing.updatedAt);
    const tombstones = { ...this.readStudySessionTombstones(), [id]: { id, deletedAt, updatedAt: deletedAt } };
    this.writeStudySessionState(
      sessions.filter((s) => s.id !== id),
      tombstones
    );
    this.studySessionsConfirmed.delete(id);
    void this.queueStudySessionSync('deletedStudySessions', id);
    this.notifyListeners();
    return true;
  }

  insertStudySessions(candidates: StudySession[]): { inserted: string[]; skipped: Array<{ id: string; reason: string }> } {
    const sessions = this.readStudySessions();
    const existing = new Set(sessions.map((s) => s.id));
    const tombstones = this.readStudySessionTombstones();
    const inserted: StudySession[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const candidate of candidates) {
      const id = String(candidate?.id ?? '');
      if (existing.has(id)) skipped.push({ id, reason: 'already exists' });
      else if (tombstones[id]) skipped.push({ id, reason: 'deleted by the student' });
      else if (validateSession(candidate).length > 0) skipped.push({ id, reason: `invalid: ${validateSession(candidate).join('; ')}` });
      else {
        existing.add(id);
        inserted.push(candidate);
      }
    }
    if (inserted.length > 0) {
      this.writeStudySessionState([...inserted, ...sessions]);
      for (const s of inserted) void this.queueStudySessionSync('studySessions', s.id);
      this.notifyListeners();
    }
    return { inserted: inserted.map((s) => s.id), skipped };
  }

  getStudySessionSyncState(id: string): StudySessionSyncState {
    if (!this.currentUser || !this.cloud || !this.studySessionCloudSync) return 'device_only';
    const dirty = this.readDirty();
    if (dirty.studySessions[id] !== undefined || dirty.deletedStudySessions[id] !== undefined) return 'pending';
    return this.studySessionsConfirmed.has(id) ? 'synced' : 'pending';
  }

  private studySessionCloudActive(): boolean {
    return this.studySessionCloudSync && Boolean(this.currentUser && this.cloud);
  }

  /**
   * Applies a cloud decision locally. Returns true when local state changed. Never pushes: the
   * caller decides whether a write is needed.
   */
  private applyStudySessionResolution(id: string, action: StudySessionResolution, remote: CloudStudySession | null): boolean {
    if (action === 'adopt_tombstone' && remote?.kind === 'tombstone') {
      const sessions = this.readStudySessions();
      const tombstones = this.readStudySessionTombstones();
      tombstones[id] = remote.tombstone;
      this.writeStudySessionState(
        sessions.filter((s) => s.id !== id),
        tombstones
      );
      this.settleDirty(['studySessions', 'deletedStudySessions'], id);
      this.studySessionsConfirmed.delete(id);
      return true;
    }
    if (action === 'adopt_remote' && remote?.kind === 'live') {
      const sessions = this.readStudySessions().filter((s) => s.id !== id);
      this.writeStudySessionState([remote.session, ...sessions]);
      this.settleDirty(['studySessions'], id);
      this.studySessionsConfirmed.add(id);
      return true;
    }
    if (action === 'in_sync') {
      this.settleDirty(['studySessions', 'deletedStudySessions'], id);
      if (remote?.kind === 'live') this.studySessionsConfirmed.add(id);
    }
    return false;
  }

  /**
   * Queues a cloud write for one session (or its tombstone). The cloud copy is read first and the
   * deterministic resolution decides: adopt the cloud version, write ours, or do nothing. If the
   * write is rejected (e.g. the rules refuse an older updatedAt), the cloud copy is re-read so a
   * newer or deleted version is adopted instead of being reported as a failure.
   */
  private queueStudySessionSync(kind: 'studySessions' | 'deletedStudySessions', id: string): Promise<void> {
    if (!this.studySessionCloudActive() || !isSafeCloudId(id)) return Promise.resolve();
    const cloud = this.cloud!;
    const uid = this.currentUser!.uid;
    const generation = this.generation;
    const path = cloudPaths.studySession(uid, id);
    const revision = this.markDirty(kind, id);

    const resolveAgainstCloud = async () => {
      const remote = decodeStudySessionDoc(id, await cloud.getDoc(path));
      const local = this.getStudySession(id) ?? undefined;
      const tombstone = this.readStudySessionTombstones()[id];
      return { remote, local, tombstone, action: resolveStudySession(local, tombstone, remote) };
    };

    const run = async () => {
      if (generation !== this.generation) return;
      const first = await resolveAgainstCloud();
      if (generation !== this.generation) return;
      if (first.action !== 'push_local' && first.action !== 'push_tombstone') {
        if (this.applyStudySessionResolution(id, first.action, first.remote)) this.notifyListeners();
        this.settleDirty([kind], id);
        return;
      }
      const data =
        first.action === 'push_tombstone'
          ? encodeStudySessionTombstone(uid, first.tombstone!)
          : encodeStudySessionDoc(uid, first.local!);
      try {
        await cloud.commit([{ type: 'set', path, data }]);
      } catch (err) {
        if (generation !== this.generation) return;
        const retry = await resolveAgainstCloud().catch(() => null);
        if (retry && retry.action !== 'push_local' && retry.action !== 'push_tombstone') {
          if (this.applyStudySessionResolution(id, retry.action, retry.remote)) this.notifyListeners();
          this.settleDirty([kind], id);
          return;
        }
        throw err;
      }
      if (generation !== this.generation) return;
      if (first.action === 'push_local') this.studySessionsConfirmed.add(id);
      this.clearDirty(kind, id, revision);
      this.notifyListeners();
    };

    const previousTask = this.writeQueues.get(path) || Promise.resolve();
    const task = previousTask
      .catch(() => undefined)
      .then(() => this.sync.track(run))
      .catch((err: unknown) => {
        const message = `Study session sync failed (${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}). It is saved on this device and will be retried.`;
        console.warn(`[sync] ${path}: ${message}`);
        this.sync.recordError(message);
      });
    this.writeQueues.set(path, task);
    return task;
  }

  /** Full reconciliation of this account's sessions with the cloud (sign-in / manual sync). */
  private async syncStudySessions(uid: string, stillCurrent: () => boolean): Promise<number> {
    if (!this.studySessionCloudActive()) return 0;
    const cloud = this.cloud!;
    const entries = await cloud.listCollection(cloudPaths.studySessions(uid));
    if (!stillCurrent()) return 0;
    let unreadable = 0;
    let changed = false;
    const seen = new Set<string>();
    const toPush: Array<['studySessions' | 'deletedStudySessions', string]> = [];
    const dirty = this.readDirty();
    for (const entry of entries) {
      seen.add(entry.id);
      const remote = decodeStudySessionDoc(entry.id, entry.data);
      if (!remote) {
        unreadable++;
        continue;
      }
      const action = resolveStudySession(this.getStudySession(entry.id) ?? undefined, this.readStudySessionTombstones()[entry.id], remote);
      if (action === 'push_local') toPush.push(['studySessions', entry.id]);
      else if (action === 'push_tombstone') toPush.push(['deletedStudySessions', entry.id]);
      else if (this.applyStudySessionResolution(entry.id, action, remote)) changed = true;
    }
    for (const session of this.readStudySessions()) {
      if (!seen.has(session.id)) toPush.push(['studySessions', session.id]);
    }
    for (const id of Object.keys(dirty.deletedStudySessions)) {
      if (!seen.has(id)) toPush.push(['deletedStudySessions', id]);
    }
    if (changed) this.notifyListeners();
    for (const [kind, id] of toPush) void this.queueStudySessionSync(kind, id);
    return unreadable;
  }

  // -------------------------------------------------------------------------
  // Document → study session migration (by reference)
  // -------------------------------------------------------------------------

  isInitialSyncComplete(): boolean {
    if (!this.scope) return false;
    if (!this.currentUser) return true;
    return this.initialSyncGeneration === this.generation;
  }

  getLastDocumentSessionMigrationReport(): DocumentSessionMigrationReport | null {
    return this.read<DocumentSessionMigrationReport | null>(KEYS.STUDY_SESSION_MIGRATION_REPORT, null);
  }

  /**
   * Creates one session per document that does not have one yet, using the deterministic
   * planner (session id sess-doc-<documentId>). Documents, attempts and per-document study state
   * are only read. Existing sessions are never overwritten and deleted session ids are never
   * re-created, so the migration can be re-run safely after any partial failure.
   */
  runDocumentSessionMigration(): DocumentSessionMigrationReport {
    const report: DocumentSessionMigrationReport = {
      status: 'completed',
      scope: !this.scope ? 'none' : this.scope === 'guest' ? 'guest' : 'account',
      ranAt: new Date().toISOString(),
      eligibleDocumentIds: [],
      migrated: [],
      alreadyMigrated: [],
      skipped: [],
      errors: [],
    };
    if (!this.documentSessionMigration) return { ...report, status: 'disabled', reason: 'The documentSessionMigration feature is off.' };
    if (!this.scope) return { ...report, status: 'not_ready', reason: 'No account scope is active.' };
    if (!this.isInitialSyncComplete()) {
      return { ...report, status: 'not_ready', reason: 'The first sync with your account has not finished; migration waits for complete data.' };
    }

    const documents = this.getDocuments();
    const plan = planDocumentSessionMigration(documents, this.getStudySessions(), this.getDeletedStudySessionIds());
    const invalid = new Set(plan.skipped.filter((s) => s.reason.startsWith('invalid') || s.reason.startsWith('duplicate')).map((s) => s.documentId));
    report.eligibleDocumentIds = [...new Set(documents.map((d) => d?.id).filter((id): id is string => typeof id === 'string' && !invalid.has(id)))];
    report.alreadyMigrated = [...plan.alreadyMigrated];
    report.skipped = [...plan.skipped];

    const byId = new Map(plan.toCreate.map((s) => [s.id, s]));
    if (plan.toCreate.length > 0) {
      try {
        const result = this.insertStudySessions(plan.toCreate);
        for (const id of result.inserted) report.migrated.push({ documentId: byId.get(id)!.migratedFromDocumentId!, sessionId: id });
        for (const skip of result.skipped) {
          const documentId = byId.get(skip.id)?.migratedFromDocumentId ?? skip.id;
          if (skip.reason === 'already exists') report.alreadyMigrated.push(documentId);
          else if (skip.reason === 'deleted by the student') report.skipped.push({ documentId, reason: 'its study session was deleted by the student' });
          else report.errors.push({ documentId, reason: skip.reason });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'The sessions could not be saved.';
        for (const s of plan.toCreate) report.errors.push({ documentId: s.migratedFromDocumentId!, reason });
      }
    }
    if (report.errors.length > 0) {
      report.status = report.migrated.length > 0 || report.alreadyMigrated.length > 0 ? 'partial' : 'failed';
      report.reason = 'Some documents could not be migrated; running the migration again retries them without creating duplicates.';
    }
    this.write(KEYS.STUDY_SESSION_MIGRATION_REPORT, report);
    if (report.migrated.length > 0) this.notifyListeners();
    return report;
  }

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  getDocuments(): StudyDocument[] {
    const docs = this.read<StudyDocument[]>(KEYS.DOCUMENTS, []);
    return [...docs].sort(
      (a, b) => new Date(b.lastStudiedAt).getTime() - new Date(a.lastStudiedAt).getTime()
    );
  }

  getDocumentById(id: string): StudyDocument | null {
    const docs = this.getDocuments();
    return docs.find((d) => d.id === id) || null;
  }

  saveDocument(studyDoc: StudyDocument): void {
    const enriched: StudyDocument = {
      ...studyDoc,
      contentVersion: studyDoc.contentVersion || computeContentVersion(studyDoc),
    };
    const docs = this.getDocuments();
    const index = docs.findIndex((d) => d.id === enriched.id);
    if (index >= 0) {
      docs[index] = enriched;
    } else {
      docs.unshift(enriched);
    }
    this.write(KEYS.DOCUMENTS, docs);
    void this.persistDocumentToCloud(enriched);
    this.notifyListeners();
  }

  renameDocument(id: string, newTitle: string): StudyDocument | null {
    const trimmed = newTitle.trim();
    if (!trimmed) return null;
    const docs = this.getDocuments();
    const idx = docs.findIndex((d) => d.id === id);
    if (idx < 0) return null;
    const updated: StudyDocument = {
      ...docs[idx],
      title: trimmed,
      lastStudiedAt: new Date().toISOString(),
    };
    docs[idx] = updated;
    this.write(KEYS.DOCUMENTS, docs);
    void this.persistDocumentToCloud(updated);
    this.notifyListeners();
    return updated;
  }

  deleteDocument(id: string): void {
    const docs = this.getDocuments().filter((d) => d.id !== id);
    this.write(KEYS.DOCUMENTS, docs);
    this.removeKey(`${KEYS.PDF_ANNOTATIONS_PREFIX}${id}`);
    if (this.getActiveDocumentId() === id) {
      this.setActiveDocumentId(docs[0]?.id || null);
    }
    void this.deleteDocumentFromCloud(id);
    this.notifyListeners();
  }

  getActiveDocumentId(): string | null {
    return this.readString(KEYS.ACTIVE_DOC_ID);
  }

  setActiveDocumentId(id: string | null): void {
    if (id) this.writeString(KEYS.ACTIVE_DOC_ID, id);
    else this.removeKey(KEYS.ACTIVE_DOC_ID);
    const user = this.currentUser;
    if (user && id && this.cloud && isSafeCloudId(id)) {
      const cloud = this.cloud;
      void this.sync
        .track(() =>
          cloud.commit([
            {
              type: 'set',
              path: cloudPaths.user(user.uid),
              merge: true,
              data: { uid: user.uid, activeDocumentId: id, updatedAt: new Date().toISOString() },
            },
          ])
        )
        .catch(() => undefined);
    }
  }

  getTutorMessages(documentId: string): TutorMessage[] {
    return this.read<TutorMessage[]>(`${KEYS.TUTOR_PREFIX}${documentId}`, []);
  }

  saveTutorMessages(documentId: string, messages: TutorMessage[]): void {
    this.write(`${KEYS.TUTOR_PREFIX}${documentId}`, messages);
    void this.persistStudyStateToCloud(documentId);
  }

  getCachedQuiz(documentId: string, mode: string): CachedPracticeSet | null {
    const cached = this.read<unknown>(`${KEYS.QUIZ_CACHE_PREFIX}${documentId}_${mode}`, null);
    return isUsableCachedPracticeSet(cached) ? cached : null;
  }

  saveCachedQuiz(documentId: string, mode: string, set: CachedPracticeSet): void {
    this.write(`${KEYS.QUIZ_CACHE_PREFIX}${documentId}_${mode}`, set);
    void this.persistStudyStateToCloud(documentId);
  }

  clearCachedQuiz(documentId: string, mode: string): void {
    this.removeKey(`${KEYS.QUIZ_CACHE_PREFIX}${documentId}_${mode}`);
    void this.persistStudyStateToCloud(documentId);
  }

  getQuizAttempts(documentId?: string): QuizAttempt[] {
    const all = this.read<QuizAttempt[]>(KEYS.ATTEMPTS, []);
    const filtered = documentId ? all.filter((a) => a.documentId === documentId) : all;
    return [...filtered].sort(
      (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    );
  }

  saveQuizAttempt(attempt: QuizAttempt): void {
    const all = this.read<QuizAttempt[]>(KEYS.ATTEMPTS, []);
    const idx = all.findIndex((a) => a.id === attempt.id);
    if (idx >= 0) {
      all[idx] = attempt;
    } else {
      all.push(attempt);
    }
    this.write(KEYS.ATTEMPTS, all);
    void this.persistAttemptToCloud(attempt);
  }

  getMistakeInsights(documentId: string): MistakeInsight[] {
    return this.read<MistakeInsight[]>(`${KEYS.MISTAKES_PREFIX}${documentId}`, []);
  }

  saveMistakeInsights(documentId: string, mistakes: MistakeInsight[]): void {
    this.write(`${KEYS.MISTAKES_PREFIX}${documentId}`, mistakes);
    void this.persistStudyStateToCloud(documentId);
  }

  getRevisionPlan(documentId: string): RevisionTask[] {
    return this.read<RevisionTask[]>(`${KEYS.REVISION_PREFIX}${documentId}`, []);
  }

  saveRevisionPlan(documentId: string, tasks: RevisionTask[]): void {
    this.write(`${KEYS.REVISION_PREFIX}${documentId}`, tasks);
    void this.persistStudyStateToCloud(documentId);
  }

  getQuickReviseBundle(documentId: string, contentVersion?: string): QuickReviseBundle | null {
    const bundle = this.read<QuickReviseBundle | null>(
      `${KEYS.QUICK_REVISE_PREFIX}${documentId}`,
      null
    );
    if (!bundle) return null;
    if (contentVersion && bundle.contentVersion && bundle.contentVersion !== contentVersion) {
      return null;
    }
    return bundle;
  }

  saveQuickReviseBundle(bundle: QuickReviseBundle): void {
    this.write(`${KEYS.QUICK_REVISE_PREFIX}${bundle.documentId}`, bundle);
    void this.persistStudyStateToCloud(bundle.documentId);
  }

  getCachedYouTubeRecommendations(cacheKey: string): YouTubeRecommendation[] | null {
    return this.read<YouTubeRecommendation[] | null>(
      `${KEYS.YT_REC_PREFIX}${cacheKey}`,
      null
    );
  }

  saveCachedYouTubeRecommendations(cacheKey: string, videos: YouTubeRecommendation[]): void {
    this.write(`${KEYS.YT_REC_PREFIX}${cacheKey}`, videos);
  }

  getStudyTimerState(): StudyTimerState {
    return this.read<StudyTimerState>(KEYS.TIMER_STATE, DEFAULT_TIMER_STATE);
  }

  saveStudyTimerState(state: StudyTimerState): void {
    this.write(KEYS.TIMER_STATE, state);
  }

  getFocusSessions(documentId?: string): FocusSessionRecord[] {
    const all = this.read<FocusSessionRecord[]>(KEYS.FOCUS_SESSIONS, []);
    const filtered = documentId ? all.filter((s) => s.documentId === documentId) : all;
    return [...filtered].sort(
      (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    );
  }

  saveFocusSession(session: FocusSessionRecord): void {
    const all = this.read<FocusSessionRecord[]>(KEYS.FOCUS_SESSIONS, []);
    all.push(session);
    this.write(KEYS.FOCUS_SESSIONS, all);
  }

  getThemeMode(): ThemeMode {
    try {
      const raw = this.storage?.getItem(KEYS.THEME);
      if (raw === 'light' || raw === 'dark' || raw === 'system') {
        return raw;
      }
      return 'light';
    } catch {
      return 'light';
    }
  }

  saveThemeMode(mode: ThemeMode): void {
    try {
      this.storage?.setItem(KEYS.THEME, mode);
    } catch {
      // ignore
    }
  }

  getSourceControlMode(): SourceControlMode {
    try {
      const raw = this.storage?.getItem(KEYS.SOURCE_CONTROL_MODE);
      if (raw === 'extended_knowledge' || raw === 'material_only') {
        return raw;
      }
      return 'material_only';
    } catch {
      return 'material_only';
    }
  }

  saveSourceControlMode(mode: SourceControlMode): void {
    try {
      this.storage?.setItem(KEYS.SOURCE_CONTROL_MODE, mode);
      this.notifyListeners();
    } catch {
      // ignore
    }
  }

  getNotifications(): LearnMateNotification[] {
    const list = this.read<LearnMateNotification[]>(KEYS.NOTIFICATIONS, []).filter(
      (n) => !isLegacyStarterNotification(n)
    );
    return [...list].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  addNotification(
    notification: Omit<LearnMateNotification, 'id' | 'createdAt' | 'read'>
  ): LearnMateNotification {
    const item: LearnMateNotification = {
      ...notification,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      read: false,
      createdAt: new Date().toISOString(),
    };
    const existing = this.getNotifications();
    const updated = [item, ...existing].slice(0, 35);
    this.write(KEYS.NOTIFICATIONS, updated);
    this.notifyListeners();
    return item;
  }

  markNotificationRead(id: string): void {
    const updated = this.getNotifications().map((n) =>
      n.id === id ? { ...n, read: true } : n
    );
    this.write(KEYS.NOTIFICATIONS, updated);
    this.notifyListeners();
  }

  markAllNotificationsRead(): void {
    const updated = this.getNotifications().map((n) => ({ ...n, read: true }));
    this.write(KEYS.NOTIFICATIONS, updated);
    this.notifyListeners();
  }

  clearNotifications(): void {
    this.write(KEYS.NOTIFICATIONS, []);
    this.notifyListeners();
  }

  getNotebookEntries(): NotebookEntry[] {
    const list = this.read<NotebookEntry[]>(KEYS.NOTEBOOK, []);
    return [...list].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  saveNotebookEntry(entry: NotebookEntry): void {
    const list = this.getNotebookEntries();
    const idx = list.findIndex((item) => item.id === entry.id);
    if (idx >= 0) {
      list[idx] = entry;
    } else {
      list.unshift(entry);
    }
    this.write(KEYS.NOTEBOOK, list);
    this.notifyListeners();
  }

  deleteNotebookEntry(id: string): void {
    const list = this.getNotebookEntries().filter((item) => item.id !== id);
    this.write(KEYS.NOTEBOOK, list);
    this.notifyListeners();
  }

  getCreativeAssets(documentId?: string): CreativeAsset[] {
    const list = this.read<CreativeAsset[]>(KEYS.CREATIVE_ASSETS, []);
    const filtered = documentId ? list.filter((a) => a.documentId === documentId) : list;
    return [...filtered].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  saveCreativeAsset(asset: CreativeAsset): void {
    const list = this.read<CreativeAsset[]>(KEYS.CREATIVE_ASSETS, []);
    const idx = list.findIndex((a) => a.id === asset.id);
    if (idx >= 0) {
      list[idx] = asset;
    } else {
      list.unshift(asset);
    }
    this.write(KEYS.CREATIVE_ASSETS, list);
    this.notifyListeners();
  }

  deleteCreativeAsset(id: string): void {
    const list = this.read<CreativeAsset[]>(KEYS.CREATIVE_ASSETS, []).filter(
      (a) => a.id !== id
    );
    this.write(KEYS.CREATIVE_ASSETS, list);
    this.notifyListeners();
  }

  getStudyPlannerTasks(): StudyPlannerTask[] {
    return this.read<StudyPlannerTask[]>(KEYS.STUDY_PLANNER, []).filter(
      (t) => !LEGACY_STARTER_PLANNER_IDS.has(t.id)
    );
  }

  saveStudyPlannerTasks(tasks: StudyPlannerTask[]): void {
    this.write(KEYS.STUDY_PLANNER, tasks);
    this.notifyListeners();
  }

  getAccessibilitySettings(): AccessibilitySettings {
    return this.read<AccessibilitySettings>(
      KEYS.ACCESSIBILITY,
      DEFAULT_ACCESSIBILITY
    );
  }

  saveAccessibilitySettings(settings: AccessibilitySettings): void {
    this.write(KEYS.ACCESSIBILITY, settings);
    this.notifyListeners();
  }

  getPdfAnnotations(documentId: string): PdfAnnotationItem[] {
    return this.read<PdfAnnotationItem[]>(
      `${KEYS.PDF_ANNOTATIONS_PREFIX}${documentId}`,
      []
    );
  }

  savePdfAnnotations(documentId: string, annotations: PdfAnnotationItem[]): void {
    this.write(`${KEYS.PDF_ANNOTATIONS_PREFIX}${documentId}`, annotations);
    this.notifyListeners();
  }

  getStudentProfile(): StudentAcademicProfile {
    const saved = this.read<StudentAcademicProfile | null>(KEYS.STUDENT_PROFILE, null);
    return saved ? { ...DEFAULT_STUDENT_PROFILE, ...saved } : { ...DEFAULT_STUDENT_PROFILE };
  }

  hasSavedStudentProfile(): boolean {
    return this.readString(KEYS.STUDENT_PROFILE) !== null;
  }

  saveStudentProfile(profile: StudentAcademicProfile): void {
    const updated: StudentAcademicProfile = {
      ...profile,
      updatedAt: new Date().toISOString(),
    };
    this.write(KEYS.STUDENT_PROFILE, updated);
    void this.persistProfileToCloud();
    this.notifyListeners();
  }

  clearAllProgress(): void {
    const docs = this.getDocuments();
    const attempts = this.getQuizAttempts();
    this.removeKey(KEYS.ATTEMPTS);
    this.removeKey(KEYS.FOCUS_SESSIONS);
    for (const d of docs) {
      this.removeKey(`${KEYS.MISTAKES_PREFIX}${d.id}`);
      this.removeKey(`${KEYS.REVISION_PREFIX}${d.id}`);
      this.removeKey(`${KEYS.QUIZ_CACHE_PREFIX}${d.id}_diagnostic`);
      void this.persistStudyStateToCloud(d.id);
    }
    const uid = this.currentUser?.uid;
    if (uid) {
      for (const att of attempts) {
        if (!isSafeCloudId(att.id)) continue;
        void this.queueCloudWrite('attempts', att.id, cloudPaths.attempt(uid, att.id), (prev) =>
          deleteEntityOps(cloudPaths.attempt(uid, att.id), prev)
        );
      }
    }
    this.notifyListeners();
  }
}

export const COURSE_LIBRARY_CATALOG: CourseLibraryItem[] = [
  {
    id: 'course-jee-physics-mechanics',
    title: 'JEE Advanced Physics: Rotational Dynamics & Gravitation',
    category: 'Competitive Exams',
    level: 'Advanced',
    durationEstimate: '4 Modules • 3.5 hrs',
    description:
      'Master Moment of Inertia, Torque, Angular Momentum Conservation, Rolling Motion, and Kepler Orbital Mechanics with exam-grade derivations.',
    badgeColor: 'blue',
    modules: [
      {
        id: 'mod-moment-of-inertia',
        title: 'Moment of Inertia & Parallel/Perpendicular Axis Theorems',
        summary: 'Rotational inertia I = Σ mᵢrᵢ², Parallel Axis Theorem I = I_cm + Md², and standard rigid body formulas.',
        keyConcepts: ['I = Σ mᵢrᵢ²', 'Parallel Axis Theorem I = I_cm + Md²', 'Radius of Gyration k = √(I/M)', 'Thin Rod & Solid Sphere Inertia'],
        content: `1. Rotational Inertia (Moment of Inertia)
For a system of discrete particles rotating about an axis, the Moment of Inertia I is:
  I = Σ mᵢ rᵢ²
For a continuous rigid body:
  I = ∫ r² dm
where r is the perpendicular distance from the axis of rotation.

2. Fundamental Axis Theorems
• Parallel Axis Theorem: For any axis parallel to an axis passing through the center of mass (CM) at distance d:
  I = I_cm + M d²
• Perpendicular Axis Theorem (for planar 2D laminae only, lying in the xy-plane):
  I_z = I_x + I_y

3. Standard Moments of Inertia (about Center of Mass)
• Uniform Ring of radius R: I = M R²
• Uniform Disc / Solid Cylinder of radius R: I = ½ M R²
• Solid Sphere of radius R: I = (2/5) M R²
• Hollow Thin Spherical Shell of radius R: I = (2/3) M R²
• Uniform Thin Rod of length L (perpendicular to length at center): I = (1/12) M L²`,
      },
      {
        id: 'mod-torque-angular-momentum',
        title: 'Torque, Angular Momentum & Rolling Without Slipping',
        summary: 'Covers τ = r × F = Iα, conservation of angular momentum L = Iω, and pure rolling constraint v_cm = Rω.',
        keyConcepts: ['Torque τ = r × F = dL/dt', 'Conservation of L = Iω', 'Pure Rolling v_cm = Rω', 'Acceleration on Inclined Plane'],
        content: `1. Torque and Angular Acceleration
Torque τ is the rotational analogue of force:
  τ = r × F,  with magnitude τ = r F sin(θ).
For rotation about a fixed axis or the center of mass:
  τ_net = I α = dL / dt.

2. Angular Momentum Conservation
Angular momentum of a rigid body about a symmetry axis is L = I ω.
If net external torque about an axis is zero (Σ τ_ext = 0), then total angular momentum L is conserved:
  I₁ ω₁ = I₂ ω₂.

3. Rolling Without Slipping on an Incline
Pure rolling occurs when the point of contact is instantaneously at rest relative to the surface:
  v_cm = R ω   and   a_cm = R α.
Total Kinetic Energy of a rolling body:
  K_total = ½ M v_cm² + ½ I_cm ω² = ½ M v_cm² (1 + k² / R²)
where k is the radius of gyration (I_cm = M k²).
Acceleration down an incline of angle θ without slipping:
  a_cm = (g sin θ) / (1 + k² / R²).`,
      },
    ],
  },
  {
    id: 'course-organic-chemistry-mechanisms',
    title: 'Organic Chemistry: Reaction Mechanisms (SN1, SN2, E1, E2)',
    category: 'Science',
    level: 'Intermediate',
    durationEstimate: '3 Modules • 2.5 hrs',
    description:
      'Understand Nucleophilic Substitution and Elimination pathways, stereochemistry, carbocation stability, and solvent effects.',
    badgeColor: 'green',
    modules: [
      {
        id: 'mod-sn1-sn2',
        title: 'SN2 Backside Attack vs SN1 Carbocation Pathway',
        summary: 'Rate laws, Walden inversion vs racemization, substrate steric hindrance, and polar protic vs aprotic solvents.',
        keyConcepts: ['SN2 Concerted Backside Attack', 'Walden Inversion of Configuration', 'SN1 Carbocation Intermediate', 'Polar Aprotic vs Protic Solvents'],
        content: `1. Bimolecular Nucleophilic Substitution (SN2)
• Mechanism: Concerted, single-step backside attack with a pentacoordinate transition state.
• Rate Law: Rate = k [Substrate][Nucleophile] (2nd order).
• Stereochemistry: 100% Inversion of configuration (Walden Inversion).
• Substrate Reactivity: Methyl > 1° > 2° >> 3° (steric hindrance blocks backside attack).
• Best Conditions: Strong nucleophile + Polar Aprotic solvent (DMSO, Acetone, DMF).

2. Unimolecular Nucleophilic Substitution (SN1)
• Mechanism: Two-step process via a planar sp² carbocation intermediate. Step 1 (leaving group departure) is rate-determining.
• Rate Law: Rate = k [Substrate] (1st order, independent of nucleophile concentration).
• Stereochemistry: Racemization (both retention and inversion occur as nucleophile attacks either face of planar carbocation).
• Substrate Reactivity: 3° > 2° >> 1° > Methyl (governed by carbocation stability and hyperconjugation/inductive effect).
• Rearrangements: 1,2-hydride or 1,2-alkyl shifts occur if a more stable carbocation can form.`,
      },
    ],
  },
  {
    id: 'course-dsa-algorithms',
    title: 'Data Structures & Algorithms: Graphs, Trees & Dynamic Programming',
    category: 'Programming',
    level: 'Intermediate',
    durationEstimate: '4 Modules • 4 hrs',
    description:
      'Core computer science foundations covering BFS/DFS, Dijkstra Shortest Path, Binary Search Trees, and Memoization vs Tabulation.',
    badgeColor: 'yellow',
    modules: [
      {
        id: 'mod-graphs-dijkstra',
        title: 'Graph Traversals (BFS/DFS) & Dijkstra Shortest Path',
        summary: 'Adjacency lists, time complexity O(V + E), topological sort, and greedy shortest paths with non-negative weights.',
        keyConcepts: ['BFS Queue O(V + E)', 'DFS Recursion & Cycle Detection', 'Dijkstra Min-Heap O((V+E) log V)', 'Non-Negative Edge Weight Constraint'],
        content: `1. Graph Representations & Traversals
For a graph G = (V, E) with |V| vertices and |E| edges, an Adjacency List uses O(V + E) space.
• Breadth-First Search (BFS): Uses a FIFO Queue. Explores level-by-level and guarantees shortest path in unweighted graphs in O(V + E) time.
• Depth-First Search (DFS): Uses a Call Stack. Used for cycle detection, connected components, and topological sorting of DAGs in O(V + E) time.

2. Dijkstra's Shortest Path Algorithm
Finds single-source shortest paths in graphs with NON-NEGATIVE edge weights (w(u, v) ≥ 0).
• Maintain a priority queue (min-heap) of tentative distances d[v], initialized to d[source] = 0 and ∞ for all other vertices.
• Relaxation step: If d[u] + w(u, v) < d[v], update d[v] = d[u] + w(u, v).
• Time Complexity with Binary Min-Heap: O((V + E) log V).
• Pitfall: Dijkstra fails on negative weight edges; use Bellman-Ford O(V·E) when negative weights exist.`,
      },
    ],
  },
  {
    id: 'course-linear-algebra-ml',
    title: 'Linear Algebra for Machine Learning & Engineering',
    category: 'Mathematics',
    level: 'Intermediate',
    durationEstimate: '3 Modules • 3 hrs',
    description:
      'Vector spaces, Rank-Nullity Theorem, Eigenvalues & Eigenvectors, Symmetric Matrices, and Singular Value Decomposition (SVD).',
    badgeColor: 'red',
    modules: [
      {
        id: 'mod-eigen-svd',
        title: 'Eigenvalues, Spectral Theorem & Singular Value Decomposition',
        summary: 'Characteristic polynomial det(A − λI) = 0, orthogonal diagonalization of symmetric matrices, and PCA via SVD.',
        keyConcepts: ['Av = λv', 'Characteristic Equation det(A − λI) = 0', 'Trace = Σ λᵢ & Det = Π λᵢ', 'Spectral Theorem A = QΛQᵀ'],
        content: `1. Eigenvalues and Eigenvectors
For an n × n square matrix A, a non-zero vector v is an eigenvector with eigenvalue λ if:
  A v = λ v   ⇔   (A − λI) v = 0.
Eigenvalues are roots of the characteristic polynomial:
  det(A − λI) = 0.

Key Matrix Identities:
• Trace(A) = a₁₁ + a₂₂ + ... + aₙₙ = λ₁ + λ₂ + ... + λₙ (sum of eigenvalues)
• det(A) = λ₁ · λ₂ · ... · λₙ (product of eigenvalues).

2. The Real Spectral Theorem
Every real symmetric matrix A (where A = Aᵀ) has:
1) Strictly real eigenvalues.
2) Orthogonal eigenvectors for distinct eigenvalues.
3) Orthogonal diagonalization: A = Q Λ Qᵀ, where Q is an orthogonal matrix (QᵀQ = I).`,
      },
    ],
  },
  {
    id: 'course-cell-biology-genetics',
    title: 'High School Biology: Cellular Respiration & Molecular Genetics',
    category: 'School',
    level: 'Beginner',
    durationEstimate: '3 Modules • 2 hrs',
    description:
      'Clear visual walkthrough of Glycolysis, Krebs Cycle, Electron Transport Chain ATP yield, DNA Replication, and Central Dogma.',
    badgeColor: 'green',
    modules: [
      {
        id: 'mod-central-dogma',
        title: 'DNA Replication, Transcription & Translation (Central Dogma)',
        summary: 'Semiconservative replication, Helicase & DNA Polymerase III, mRNA splicing, and ribosomal tRNA translation.',
        keyConcepts: ['Semiconservative Replication (5\' → 3\')', 'Okazaki Fragments on Lagging Strand', 'RNA Polymerase Transcription', 'Codon to Anticodon Translation'],
        content: `1. DNA Structure & Semiconservative Replication
DNA consists of two antiparallel polynucleotide strands coiled in a double helix with complementary base pairing: Adenine (A) pairs with Thymine (T) via 2 hydrogen bonds; Guanine (G) pairs with Cytosine (C) via 3 hydrogen bonds.
• DNA Polymerase synthesizes new DNA exclusively in the 5' → 3' direction.
• Leading strand is synthesized continuously; Lagging strand is synthesized discontinuously as Okazaki fragments joined by DNA Ligase.

2. The Central Dogma of Molecular Biology
  DNA  ──(Transcription)──►  mRNA  ──(Translation)──►  Polypeptide (Protein)
• Transcription: RNA Polymerase reads the 3' → 5' DNA template strand to synthesize complementary mRNA (using Uracil U instead of Thymine T). In eukaryotes, introns are spliced out and exons are joined.
• Translation: Ribosomes read mRNA triplets (codons). Start codon is AUG (Methionine); stop codons are UAA, UAG, UGA.`,
      },
    ],
  },
  {
    id: 'course-macroeconomics-college',
    title: 'College Macroeconomics: Monetary Policy, GDP & Inflation',
    category: 'College',
    level: 'Beginner',
    durationEstimate: '3 Modules • 2.5 hrs',
    description:
      'National income accounting Y = C + I + G + NX, Fiscal multipliers, Central Bank interest rate policy, and the Phillips Curve.',
    badgeColor: 'blue',
    modules: [
      {
        id: 'mod-gdp-monetary',
        title: 'GDP Accounting, Fiscal Multiplier & Central Bank Policy',
        summary: 'Nominal vs Real GDP, Keynesian multiplier 1/(1 − MPC), open market operations, and inflation targeting.',
        keyConcepts: ['Y = C + I + G + NX', 'Keynesian Multiplier 1/(1 − MPC)', 'Real vs Nominal GDP Deflator', 'Open Market Operations'],
        content: `1. Gross Domestic Product (GDP) Expenditure Identity
GDP measures the market value of all final goods and services produced within a country in a given period:
  Y = C + I + G + (X − M)
where C = Consumption, I = Investment, G = Government Purchases, and (X − M) = Net Exports.

2. Real vs. Nominal GDP & The Keynesian Multiplier
• Nominal GDP uses current-year prices; Real GDP uses constant base-year prices to isolate real output growth.
• GDP Deflator = (Nominal GDP / Real GDP) × 100.
• Simple Autonomous Spending Multiplier: With Marginal Propensity to Consume (MPC), an initial spending change ΔG changes equilibrium output by:
  ΔY = [ 1 / (1 − MPC) ] · ΔG.`,
      },
    ],
  },
];

export const studyStorage: IStudyStorageRepository = new HybridCloudStudyRepository();
