import type {
  CachedPracticeSet,
  MistakeInsight,
  QuickReviseBundle,
  QuizAttempt,
  RevisionTask,
  StudyDocument,
  StudyPage,
  StudyTopic,
  TutorMessage,
} from '../types/study';
import {
  decodeChunkedPayload,
  encodePayload,
  parseJsonOrThrow,
  payloadChecksum,
  utf8ByteLength,
  INLINE_PAYLOAD_MAX_BYTES,
} from './cloudPayload';
import { FirestoreDataError } from '../utils/firestoreData';
import { cloudPaths, type CloudData, type CloudDocStore, type CloudWriteOp } from './cloudStore';

/**
 * Encoders/decoders for synced entities. Small payloads keep the legacy inline field names
 * (compatible with the currently deployed security rules); large payloads are chunked
 * (storageVersion 2). JSON is never truncated.
 */

export const CLOUD_STORAGE_VERSION = 2;

/** Field limits enforced by the deployed (v1) Firestore rules for inline payloads. */
const LEGACY_LIMITS = {
  title: 300,
  overview: 10_000,
  pagesJson: 900_000,
  topicsJson: 200_000,
  attemptJson: 500_000,
  tutorMessagesJson: 600_000,
  mistakesJson: 300_000,
  revisionPlanJson: 300_000,
  cachedQuizJson: 300_000,
  quickReviseJson: 500_000,
};

interface EncodedEntity {
  parent: CloudData;
  chunks: string[];
}

function chunkWriteOps(parentPath: string, uid: string, entity: EncodedEntity, previousChunkCount: number): CloudWriteOp[] {
  const ops: CloudWriteOp[] = entity.chunks.map((data, index) => ({
    type: 'set' as const,
    path: cloudPaths.chunk(parentPath, index),
    data: { index, uid, data },
  }));
  ops.push({ type: 'set', path: parentPath, data: entity.parent });
  for (let i = entity.chunks.length; i < previousChunkCount; i++) {
    ops.push({ type: 'delete', path: cloudPaths.chunk(parentPath, i) });
  }
  return ops;
}

function chunkedParentFields(json: string, chunks: string[]): CloudData {
  return {
    storageVersion: CLOUD_STORAGE_VERSION,
    payloadEncoding: 'chunked',
    chunkCount: chunks.length,
    payloadBytes: utf8ByteLength(json),
    payloadChecksum: payloadChecksum(json),
  };
}

function inlineParentFields(): CloudData {
  return { storageVersion: CLOUD_STORAGE_VERSION, payloadEncoding: 'inline', chunkCount: 0 };
}

function fitsInline(fields: Record<string, string>, limits: Record<string, number>): boolean {
  let total = 0;
  for (const [key, value] of Object.entries(fields)) {
    const limit = limits[key];
    if (typeof limit === 'number' && value.length > limit) return false;
    total += utf8ByteLength(value);
  }
  return total <= INLINE_PAYLOAD_MAX_BYTES;
}

async function readChunked<T>(store: CloudDocStore, parentPath: string, parent: CloudData): Promise<T> {
  const chunkDocs = await store.listCollection(cloudPaths.chunks(parentPath));
  return decodeChunkedPayload<T>(
    chunkDocs.map((c) => c.data as { index: unknown; data: unknown }),
    {
      chunkCount: Number(parent.chunkCount),
      checksum: String(parent.payloadChecksum || ''),
      byteLength: typeof parent.payloadBytes === 'number' ? parent.payloadBytes : undefined,
    }
  );
}

function isChunked(parent: CloudData): boolean {
  return parent.storageVersion === CLOUD_STORAGE_VERSION && parent.payloadEncoding === 'chunked';
}

// ---------------------------------------------------------------------------
// Study documents
// ---------------------------------------------------------------------------

interface DocumentPayload {
  title: string;
  overview: string;
  pages: StudyPage[];
  topics: StudyTopic[];
}

const VALID_SOURCE_TYPES = new Set(['pdf', 'text', 'youtube', 'scanned_notes', 'voice_note', 'course']);

/** Legacy documents may lack timestamps; the rules require both, so derive them (epoch if unknown). */
const UNKNOWN_TIME = new Date(0).toISOString();

export function encodeStudyDocument(uid: string, studyDoc: StudyDocument, previousChunkCount = 0): CloudWriteOp[] {
  const parentPath = cloudPaths.document(uid, studyDoc.id);
  const createdAt = studyDoc.createdAt || studyDoc.lastStudiedAt || UNKNOWN_TIME;
  const base: CloudData = {
    id: studyDoc.id,
    uid,
    title: (studyDoc.title || 'Untitled').slice(0, LEGACY_LIMITS.title),
    sourceType: VALID_SOURCE_TYPES.has(studyDoc.sourceType) ? studyDoc.sourceType : 'text',
    pageCount: Math.max(1, Math.min(50, studyDoc.pages.length || studyDoc.pageCount || 1)),
    overview: (studyDoc.overview || '').slice(0, LEGACY_LIMITS.overview),
    createdAt,
    lastStudiedAt: studyDoc.lastStudiedAt || createdAt,
    contentVersion: studyDoc.contentVersion || '',
  };
  if (studyDoc.youtubeUrl) base.youtubeUrl = studyDoc.youtubeUrl.slice(0, 1024);
  if (studyDoc.videoId) base.videoId = studyDoc.videoId.slice(0, 64);

  const pagesJson = JSON.stringify(studyDoc.pages || []);
  const topicsJson = JSON.stringify(studyDoc.topics || []);
  const fullTitle = studyDoc.title || 'Untitled';
  const fullOverview = studyDoc.overview || '';

  if (
    fullTitle.length <= LEGACY_LIMITS.title &&
    fullOverview.length <= LEGACY_LIMITS.overview &&
    fitsInline({ pagesJson, topicsJson, overview: fullOverview }, LEGACY_LIMITS)
  ) {
    return chunkWriteOps(
      parentPath,
      uid,
      { parent: { ...base, ...inlineParentFields(), pagesJson, topicsJson }, chunks: [] },
      previousChunkCount
    );
  }

  const payload: DocumentPayload = {
    title: fullTitle,
    overview: fullOverview,
    pages: studyDoc.pages || [],
    topics: studyDoc.topics || [],
  };
  const encoded = encodePayload(payload, { inlineMaxBytes: 0 });
  const chunks = encoded.chunks || [];
  return chunkWriteOps(
    parentPath,
    uid,
    {
      // Legacy placeholders keep the parent valid under the v1 rules' required-field checks.
      parent: { ...base, pagesJson: '', topicsJson: '', ...chunkedParentFields(encoded.json, chunks) },
      chunks,
    },
    previousChunkCount
  );
}

export async function decodeStudyDocument(
  store: CloudDocStore,
  uid: string,
  data: CloudData
): Promise<StudyDocument> {
  const id = String(data.id || '');
  let title = String(data.title || 'Untitled');
  let overview = String(data.overview || '');
  let pages: StudyPage[];
  let topics: StudyTopic[];

  if (isChunked(data)) {
    const payload = await readChunked<DocumentPayload>(store, cloudPaths.document(uid, id), data);
    title = payload.title || title;
    overview = payload.overview ?? overview;
    pages = payload.pages;
    topics = payload.topics;
  } else {
    pages = parseJsonOrThrow<StudyPage[]>(String(data.pagesJson ?? '[]'));
    topics = parseJsonOrThrow<StudyTopic[]>(String(data.topicsJson ?? '[]'));
  }

  return {
    id,
    title,
    sourceType: (VALID_SOURCE_TYPES.has(String(data.sourceType)) ? data.sourceType : 'text') as StudyDocument['sourceType'],
    youtubeUrl: typeof data.youtubeUrl === 'string' && data.youtubeUrl ? data.youtubeUrl : undefined,
    videoId: typeof data.videoId === 'string' && data.videoId ? data.videoId : undefined,
    contentVersion: typeof data.contentVersion === 'string' && data.contentVersion ? data.contentVersion : undefined,
    pageCount: pages.length,
    pages,
    topics,
    overview,
    createdAt: String(data.createdAt || ''),
    lastStudiedAt: String(data.lastStudiedAt || data.createdAt || ''),
  };
}

// ---------------------------------------------------------------------------
// Quiz attempts
// ---------------------------------------------------------------------------

export function encodeQuizAttempt(uid: string, attempt: QuizAttempt, previousChunkCount = 0): CloudWriteOp[] {
  const parentPath = cloudPaths.attempt(uid, attempt.id);
  for (const field of ['id', 'documentId', 'mode', 'score', 'totalQuestions', 'percentage', 'completedAt'] as const) {
    if (attempt[field] === undefined || attempt[field] === null) {
      throw new FirestoreDataError(`attempt ${attempt.id ?? '(no id)'}: required field "${field}" is missing.`);
    }
  }
  const base: CloudData = {
    id: attempt.id,
    uid,
    documentId: attempt.documentId,
    documentTitle: (attempt.documentTitle || '').slice(0, LEGACY_LIMITS.title),
    mode: attempt.mode,
    score: attempt.score,
    totalQuestions: attempt.totalQuestions,
    percentage: attempt.percentage,
    completedAt: attempt.completedAt,
  };
  const attemptJson = JSON.stringify(attempt);
  if (fitsInline({ attemptJson }, LEGACY_LIMITS)) {
    return chunkWriteOps(parentPath, uid, { parent: { ...base, ...inlineParentFields(), attemptJson }, chunks: [] }, previousChunkCount);
  }
  const encoded = encodePayload(attempt, { inlineMaxBytes: 0 });
  const chunks = encoded.chunks || [];
  return chunkWriteOps(
    parentPath,
    uid,
    { parent: { ...base, attemptJson: '', ...chunkedParentFields(encoded.json, chunks) }, chunks },
    previousChunkCount
  );
}

export async function decodeQuizAttempt(store: CloudDocStore, uid: string, data: CloudData): Promise<QuizAttempt> {
  const id = String(data.id || '');
  const attempt = isChunked(data)
    ? await readChunked<QuizAttempt>(store, cloudPaths.attempt(uid, id), data)
    : parseJsonOrThrow<QuizAttempt>(String(data.attemptJson ?? ''));
  if (!attempt || typeof attempt.id !== 'string') {
    throw new Error('Attempt payload is missing its id.');
  }
  return attempt;
}

// ---------------------------------------------------------------------------
// Per-document study state (tutor chat, mistakes, revision plan, cached quiz, quick revise)
// ---------------------------------------------------------------------------

export interface StudyStatePayload {
  tutorMessages: TutorMessage[];
  mistakes: MistakeInsight[];
  revisionPlan: RevisionTask[];
  cachedQuiz: CachedPracticeSet | null;
  quickRevise: QuickReviseBundle | null;
}

export function encodeStudyState(
  uid: string,
  documentId: string,
  state: StudyStatePayload,
  updatedAt: string,
  previousChunkCount = 0
): CloudWriteOp[] {
  const parentPath = cloudPaths.studyState(uid, documentId);
  const base: CloudData = { documentId, uid, updatedAt };
  const fields = {
    tutorMessagesJson: JSON.stringify(state.tutorMessages || []),
    mistakesJson: JSON.stringify(state.mistakes || []),
    revisionPlanJson: JSON.stringify(state.revisionPlan || []),
    cachedQuizJson: state.cachedQuiz ? JSON.stringify(state.cachedQuiz) : '',
    quickReviseJson: state.quickRevise ? JSON.stringify(state.quickRevise) : '',
  };
  if (fitsInline(fields, LEGACY_LIMITS)) {
    return chunkWriteOps(parentPath, uid, { parent: { ...base, ...inlineParentFields(), ...fields }, chunks: [] }, previousChunkCount);
  }
  const encoded = encodePayload(state, { inlineMaxBytes: 0 });
  const chunks = encoded.chunks || [];
  return chunkWriteOps(parentPath, uid, { parent: { ...base, ...chunkedParentFields(encoded.json, chunks) }, chunks }, previousChunkCount);
}

export async function decodeStudyState(
  store: CloudDocStore,
  uid: string,
  documentId: string,
  data: CloudData
): Promise<StudyStatePayload> {
  if (isChunked(data)) {
    return readChunked<StudyStatePayload>(store, cloudPaths.studyState(uid, documentId), data);
  }
  const parseField = <T>(field: string, fallback: T): T => {
    const raw = data[field];
    if (typeof raw !== 'string' || raw === '') return fallback;
    return parseJsonOrThrow<T>(raw);
  };
  return {
    tutorMessages: parseField<TutorMessage[]>('tutorMessagesJson', []),
    mistakes: parseField<MistakeInsight[]>('mistakesJson', []),
    revisionPlan: parseField<RevisionTask[]>('revisionPlanJson', []),
    // Legacy caches were arrays of questions that included answer keys; they are not restored.
    cachedQuiz: ((): CachedPracticeSet | null => {
      const parsed = parseField<unknown>('cachedQuizJson', null);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as CachedPracticeSet) : null;
    })(),
    quickRevise: parseField<QuickReviseBundle | null>('quickReviseJson', null),
  };
}

/** Delete operations for an entity and its chunk documents. */
export function deleteEntityOps(parentPath: string, chunkCount: number): CloudWriteOp[] {
  const ops: CloudWriteOp[] = [];
  for (let i = 0; i < chunkCount; i++) ops.push({ type: 'delete', path: cloudPaths.chunk(parentPath, i) });
  ops.push({ type: 'delete', path: parentPath });
  return ops;
}

export function chunkCountOf(data: CloudData | null): number {
  if (!data) return 0;
  const count = Number(data.chunkCount);
  return Number.isInteger(count) && count > 0 ? count : 0;
}
