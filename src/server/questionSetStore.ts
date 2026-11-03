import { randomUUID } from 'crypto';
import type { AttemptKind, McqOption, QuestionDifficulty, QuestionSource } from '../types/questionBank';
import type { GradedQuizAttempt } from '../utils/attemptV2';
import { FirestoreDataError, toFirestoreData } from '../utils/firestoreData';
import type { QuotaFirestore } from './quotaStore';

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
  documentId: string;
  documentTitle: string;
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
  /** Records the first submission; later calls return the original one. */
  recordSubmission(
    uid: string,
    setId: string,
    submission: StoredSubmission
  ): Promise<{ submission: StoredSubmission; alreadySubmitted: boolean } | null>;
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
    set.submission = structuredClone(submission);
    return { submission: structuredClone(submission), alreadySubmitted: false };
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

  async recordSubmission(uid: string, setId: string, submission: StoredSubmission) {
    try {
      return await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(this.ref(setId));
        const data = snap.exists ? (snap.data() as unknown as StoredQuestionSet) : null;
        if (!isUsable(data, uid, new Date())) return null;
        if (data.submission) return { submission: data.submission, alreadySubmitted: true };
        const updated = { ...stripFirestoreFields(data), submission };
        assertSize(updated);
        tx.set(this.ref(setId), questionSetToFirestore(updated));
        return { submission, alreadySubmitted: false };
      });
    } catch (err) {
      throw new QuestionSetUnavailableError(err instanceof Error ? err.message.slice(0, 160) : 'submission failed');
    }
  }
}

function stripFirestoreFields(set: StoredQuestionSet): StoredQuestionSet {
  const { expiresAtDate: _ignored, ...rest } = set as StoredQuestionSet & { expiresAtDate?: unknown };
  return rest as StoredQuestionSet;
}
