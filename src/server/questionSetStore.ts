import { randomUUID } from 'crypto';
import { chunkCountOf } from '../services/cloudEntities';
import { cloudPaths } from '../services/cloudStore';
import type { AttemptContext, AttemptKind, McqOption, QuestionDifficulty, QuestionSource } from '../types/questionBank';
import { trustedAttemptIdFor, validateTrustedAttempt } from '../utils/attemptContext';
import type { GradedQuizAttempt } from '../utils/attemptV2';
import { FirestoreDataError, toFirestoreData } from '../utils/firestoreData';
import { isIsoUtcTimestamp } from '../utils/sessionModel';
import type { QuotaFirestore } from './quotaStore';
import { encodeTrustedAttemptRecord, TrustedAttemptRejectedError } from './trustedAttemptRecord';

export { TrustedAttemptRejectedError };

/**
 * Server-held question sets. Answer keys and explanations live only here until the student
 * submits; the client receives questions without them. Submissions are recorded once
 * (idempotent), so a set cannot be re-graded with different answers.
 */

export interface StoredQuestion {
  id: string;
  type: 'mcq';
  source: QuestionSource;
  topicLabel: string;
  topicIds: string[];
  chapterId?: string;
  stem: string;
  options: McqOption[];
  correctOptionId: McqOption['id'];
  explanation: string;
  sourcePage: number;
  sourceQuote: string;
  difficulty: QuestionDifficulty;
}

export interface StoredSubmission {
  submittedAt: string;
  attempt: GradedQuizAttempt;
}

export interface StoredQuestionSet {
  id: string;
  uid: string;
  kind: AttemptKind;
  mode: 'diagnostic' | 'adaptive';
  /** "" for syllabus-context sets. */
  documentId: string;
  documentTitle: string;
  /** What is practised (always set on new sets; older sets are resolved by contextOfSet). */
  context?: AttemptContext;
  /** Registered marking scheme used for grading (older sets were graded with jee_main_2026). */
  markingSchemeId?: string;
  sessionId?: string;
  targetTopics?: string[];
  createdAt: string;
  expiresAt: string;
  questions: StoredQuestion[];
  submission?: StoredSubmission;
}

export const QUESTION_SET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const QUESTION_SET_COLLECTION = 'questionSets';
const MAX_SET_BYTES = 900_000;

export class QuestionSetUnavailableError extends Error {
  constructor(message = 'Question set storage is unavailable.') {
    super(message);
    this.name = 'QuestionSetUnavailableError';
  }
}

export interface QuestionSetStore {
  readonly kind: 'firestore' | 'memory' | 'unavailable';
  create(set: StoredQuestionSet): Promise<void>;
  /** Returns null when missing, owned by another user, or expired. */
  get(uid: string, setId: string, now?: Date): Promise<StoredQuestionSet | null>;
  /**
   * Records the first submission and persists the trusted attempt atomically (Firestore: one
   * transaction for questionSets/{id} and users/{uid}/attempts/att-{id}). Later calls return the
   * original submission without writing. Throws TrustedAttemptRejectedError when the attempt does
   * not match the stored set or fails validation (nothing is written).
   */
  recordSubmission(
    uid: string,
    setId: string,
    submission: StoredSubmission
  ): Promise<{ submission: StoredSubmission; alreadySubmitted: boolean } | null>;
}

/**
 * The submitted attempt must be exactly what grading this stored set produces: same identity,
 * questions (in order), context, marking, sources and session, and it must pass
 * validateTrustedAttempt. By-reference attempts must not carry any of the set's question content.
 */
export function checkSubmissionAgainstSet(set: StoredQuestionSet, submission: StoredSubmission): void {
  const a = submission?.attempt;
  const problems: string[] = [];
  if (!a || typeof a !== 'object') throw new TrustedAttemptRejectedError(['submission has no attempt.']);
  if (!isIsoUtcTimestamp(submission.submittedAt)) problems.push('submittedAt must be an ISO UTC timestamp.');
  problems.push(...validateTrustedAttempt(a));
  if (a.questionSetId !== set.id || a.id !== trustedAttemptIdFor(set.id)) problems.push('attempt does not belong to this question set.');
  const outcomeIds = Array.isArray(a.outcomes) ? a.outcomes.map((o) => o.questionId) : [];
  if (outcomeIds.join('\u0000') !== set.questions.map((q) => q.id).join('\u0000')) problems.push('attempt questions differ from the stored set.');
  if (a.kind !== set.kind || a.mode !== set.mode) problems.push('attempt kind or mode differs from the stored set.');
  if ((a.sessionId ?? null) !== (set.sessionId ?? null)) problems.push('attempt sessionId differs from the stored set.');
  if (a.documentId !== set.documentId) problems.push('attempt documentId differs from the stored set.');
  if (set.context && JSON.stringify(a.context) !== JSON.stringify(set.context)) problems.push('attempt context differs from the stored set.');
  if (a.markingSchemeId !== (set.markingSchemeId ?? 'jee_main_2026')) problems.push('attempt marking differs from the stored set.');
  const setSources = [...new Set(set.questions.map((q) => q.source))].sort().join(',');
  if (!Array.isArray(a.sources) || [...a.sources].sort().join(',') !== setSources) problems.push('attempt sources differ from the stored set.');
  if (a.reviewMode === 'by_reference') {
    // No stored question text, option, explanation or quote may appear anywhere in the attempt.
    const serialized = JSON.stringify(a);
    const leaked = set.questions.some((q) =>
      [q.stem, q.explanation, q.sourceQuote, ...q.options.map((o) => o.text)].some((text) => typeof text === 'string' && text.trim().length >= 12 && serialized.includes(JSON.stringify(text).slice(1, -1)))
    );
    if (leaked) problems.push('by_reference attempt contains question content from the set.');
  }
  if (problems.length > 0) throw new TrustedAttemptRejectedError(problems);
}

export function newQuestionSetId(): string {
  return `qs_${randomUUID().replace(/-/g, '')}`;
}

function assertSize(set: StoredQuestionSet): void {
  const bytes = Buffer.byteLength(JSON.stringify(set), 'utf8');
  if (bytes > MAX_SET_BYTES) throw new Error(`Question set is too large to store (${bytes} bytes).`);
}

const REQUIRED_SET_FIELDS = ['id', 'uid', 'kind', 'mode', 'documentId', 'documentTitle', 'createdAt', 'expiresAt', 'questions'] as const;
const REQUIRED_QUESTION_FIELDS = ['id', 'type', 'source', 'topicLabel', 'topicIds', 'stem', 'options', 'correctOptionId', 'explanation', 'difficulty'] as const;
const REQUIRED_ATTEMPT_FIELDS = ['id', 'questionSetId', 'kind', 'scoredBy', 'completedAt', 'answers', 'outcomes'] as const;

/**
 * Prepares a question set for an Admin SDK write: required data is checked (never dropped), and
 * optional fields left undefined (sessionId, targetTopics, chapterId...) are omitted, because
 * Firestore rejects undefined values.
 */
export function questionSetToFirestore(set: StoredQuestionSet): Record<string, unknown> {
  const label = `question set ${set?.id ?? '(no id)'}`;
  if (!Array.isArray(set?.questions) || set.questions.length === 0) throw new FirestoreDataError(`${label}: it has no questions.`);
  set.questions.forEach((q, i) => {
    toFirestoreData(q as unknown as Record<string, unknown>, { required: REQUIRED_QUESTION_FIELDS, label: `${label} question ${i + 1}` });
  });
  if (set.submission) {
    if (!set.submission.submittedAt) throw new FirestoreDataError(`${label}: submission.submittedAt is missing.`);
    toFirestoreData(set.submission.attempt as unknown as Record<string, unknown>, { required: REQUIRED_ATTEMPT_FIELDS, label: `${label} attempt` });
  }
  return toFirestoreData(
    { ...set, expiresAtDate: new Date(set.expiresAt) } as unknown as Record<string, unknown>,
    { required: REQUIRED_SET_FIELDS, label }
  );
}

function isUsable(set: StoredQuestionSet | null | undefined, uid: string, now: Date): set is StoredQuestionSet {
  return Boolean(set && set.uid === uid && new Date(set.expiresAt).getTime() > now.getTime());
}

export class MemoryQuestionSetStore implements QuestionSetStore {
  readonly kind = 'memory' as const;
  private readonly sets = new Map<string, StoredQuestionSet>();
  /** Trusted attempt records as they would be written to Firestore (path -> data). */
  readonly attemptRecords = new Map<string, Record<string, unknown>>();

  async create(set: StoredQuestionSet): Promise<void> {
    assertSize(set);
    if (this.sets.has(set.id)) throw new Error('Question set id collision.');
    this.sets.set(set.id, structuredClone(set));
  }

  async get(uid: string, setId: string, now: Date = new Date()): Promise<StoredQuestionSet | null> {
    const set = this.sets.get(setId);
    return isUsable(set, uid, now) ? structuredClone(set) : null;
  }

  async recordSubmission(uid: string, setId: string, submission: StoredSubmission) {
    const set = this.sets.get(setId);
    if (!isUsable(set, uid, new Date())) return null;
    if (set.submission) return { submission: structuredClone(set.submission), alreadySubmitted: true };
    checkSubmissionAgainstSet(set, submission);
    const ops = encodeTrustedAttemptRecord(uid, submission.attempt, 0);
    // Keep exactly what Firestore would store, so every caller sees the same authoritative result.
    const stored = questionSetToFirestore({ ...set, submission }).submission as StoredSubmission;
    set.submission = structuredClone(stored);
    for (const op of ops) if (op.type === 'set') this.attemptRecords.set(op.path, structuredClone(op.data));
    return { submission: structuredClone(stored), alreadySubmitted: false };
  }
}

export class UnavailableQuestionSetStore implements QuestionSetStore {
  readonly kind = 'unavailable' as const;
  constructor(private readonly reason: string) {}
  async create(_set: StoredQuestionSet): Promise<void> {
    throw new QuestionSetUnavailableError(this.reason);
  }
  async get(_uid: string, _setId: string): Promise<StoredQuestionSet | null> {
    throw new QuestionSetUnavailableError(this.reason);
  }
  async recordSubmission(_uid: string, _setId: string, _submission: StoredSubmission): Promise<null> {
    throw new QuestionSetUnavailableError(this.reason);
  }
}

/** Firestore-backed store (Admin SDK; the collection is denied to clients by security rules). */
export class FirestoreQuestionSetStore implements QuestionSetStore {
  readonly kind = 'firestore' as const;

  constructor(
    private readonly db: QuotaFirestore,
    private readonly collectionName = QUESTION_SET_COLLECTION
  ) {}

  private ref(setId: string): unknown {
    return this.db.collection(this.collectionName).doc(setId);
  }

  /** Reference for any document path (e.g. users/{uid}/attempts/{id}/chunks/0). */
  private docRef(path: string): unknown {
    const cut = path.lastIndexOf('/');
    return this.db.collection(path.slice(0, cut)).doc(path.slice(cut + 1));
  }

  async create(set: StoredQuestionSet): Promise<void> {
    assertSize(set);
    try {
      await this.db.runTransaction(async (tx) => {
        const existing = await tx.get(this.ref(set.id));
        if (existing.exists) throw new Error('Question set id collision.');
        tx.set(this.ref(set.id), questionSetToFirestore(set));
      });
    } catch (err) {
      throw new QuestionSetUnavailableError(err instanceof Error ? err.message.slice(0, 160) : 'create failed');
    }
  }

  async get(uid: string, setId: string, now: Date = new Date()): Promise<StoredQuestionSet | null> {
    try {
      return await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(this.ref(setId));
        const data = snap.exists ? (snap.data() as unknown as StoredQuestionSet) : null;
        return isUsable(data, uid, now) ? stripFirestoreFields(data) : null;
      });
    } catch (err) {
      throw new QuestionSetUnavailableError(err instanceof Error ? err.message.slice(0, 160) : 'read failed');
    }
  }

  /**
   * One transaction: read the set (ownership, expiry, prior submission) and the attempt record,
   * validate, then write the submission and the trusted attempt (parent + chunks, removing stale
   * chunks). All reads happen before any write. Concurrent submissions serialise on the set
   * document, so exactly one result is stored; every later call returns that stored result.
   */
  async recordSubmission(uid: string, setId: string, submission: StoredSubmission) {
    try {
      return await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(this.ref(setId));
        const data = snap.exists ? (snap.data() as unknown as StoredQuestionSet) : null;
        if (!isUsable(data, uid, new Date())) return null;
        if (data.submission) return { submission: data.submission, alreadySubmitted: true };
        const set = stripFirestoreFields(data);
        checkSubmissionAgainstSet(set, submission);

        const attemptPath = cloudPaths.attempt(uid, submission.attempt.id);
        const existing = await tx.get(this.docRef(attemptPath));
        const ops = encodeTrustedAttemptRecord(uid, submission.attempt, chunkCountOf(existing.exists ? existing.data() ?? null : null));
        const updated = { ...set, submission };
        assertSize(updated);
        if (ops.some((op) => op.type === 'delete') && typeof tx.delete !== 'function') {
          throw new Error('Transaction does not support deletes.');
        }

        const stored = questionSetToFirestore(updated);
        tx.set(this.ref(setId), stored);
        for (const op of ops) {
          if (op.type === 'delete') tx.delete!(this.docRef(op.path));
          else tx.set(this.docRef(op.path), op.data);
        }
        // Return what was persisted (not the caller's object), identical to what replays return.
        return { submission: stored.submission as StoredSubmission, alreadySubmitted: false };
      });
    } catch (err) {
      if (err instanceof TrustedAttemptRejectedError) throw err;
      throw new QuestionSetUnavailableError(err instanceof Error ? err.message.slice(0, 160) : 'submission failed');
    }
  }
}

function stripFirestoreFields(set: StoredQuestionSet): StoredQuestionSet {
  const { expiresAtDate: _ignored, ...rest } = set as StoredQuestionSet & { expiresAtDate?: unknown };
  return rest as StoredQuestionSet;
}
