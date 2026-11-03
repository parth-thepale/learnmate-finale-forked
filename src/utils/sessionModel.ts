import { getChapter, getSubject, getTopic, type JeeSubjectId } from '../data/jeeMainSyllabus';
import type { StudySession } from '../types/questionBank';
import type { StudyDocument } from '../types/study';

/**
 * Study sessions are the central learning context. Existing documents are migrated by
 * *reference*: each pre-existing document gets one session that points at it. Documents are
 * never modified, copied, moved or re-owned. Session ids for migrated documents are
 * deterministic, so running the migration again never creates duplicates.
 */

export const MAX_SESSION_NAME_LENGTH = 120;

/** Limits shared by local validation, cloud encoding and firestore.rules. */
export const STUDY_SESSION_LIMITS = Object.freeze({
  idLength: 160,
  nameLength: MAX_SESSION_NAME_LENGTH,
  topicIds: 50,
  resourceIds: 100,
  refLength: 160,
});

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** True for timestamps in Date#toISOString() format (these compare correctly as strings). */
export function isIsoUtcTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

/** Normalises any date-like string to toISOString() format; unknown dates become the epoch. */
export function toIsoUtc(value: string | undefined | null): string {
  if (isIsoUtcTimestamp(value)) return value;
  const ms = value ? Date.parse(value) : NaN;
  return new Date(Number.isNaN(ms) ? 0 : ms).toISOString();
}

/** A new updatedAt strictly later than `previous`, even if the device clock went backwards. */
export function nextUpdatedAt(previous: string | undefined, now: Date = new Date()): string {
  const prevMs = previous && isIsoUtcTimestamp(previous) ? Date.parse(previous) : -Infinity;
  return new Date(Math.max(now.getTime(), prevMs + 1)).toISOString();
}

function isSafeRef(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= STUDY_SESSION_LIMITS.refLength && !id.includes('/');
}

export function sessionIdForDocument(documentId: string): string {
  return `sess-doc-${documentId}`;
}

export function validateSession(session: StudySession): string[] {
  const errors: string[] = [];
  if (!session.id || session.id.length > STUDY_SESSION_LIMITS.idLength || session.id.includes('/') || session.id === '.' || session.id === '..') {
    errors.push('invalid session id');
  }
  if (!session.name || !session.name.trim() || session.name.length > MAX_SESSION_NAME_LENGTH) errors.push('invalid session name');
  if (session.subjectId && !getSubject(session.subjectId)) errors.push('unknown subject');
  if (session.chapterId) {
    const chapter = getChapter(session.chapterId);
    if (!chapter) errors.push('unknown chapter');
    else if (session.subjectId && chapter.subjectId !== session.subjectId) errors.push('chapter does not belong to subject');
  }
  for (const topicId of session.topicIds) {
    const found = getTopic(topicId);
    if (!found) errors.push(`unknown topic ${topicId}`);
    else if (session.chapterId && found.chapter.id !== session.chapterId) errors.push(`topic ${topicId} is outside the chapter`);
  }
  if (!Array.isArray(session.topicIds) || session.topicIds.length > STUDY_SESSION_LIMITS.topicIds) errors.push('too many topics');
  if (!Array.isArray(session.resourceIds) || session.resourceIds.length > STUDY_SESSION_LIMITS.resourceIds) errors.push('too many resources');
  else if (!session.resourceIds.every(isSafeRef)) errors.push('invalid resource id');
  if (new Set(session.resourceIds).size !== session.resourceIds.length) errors.push('duplicate resource ids');
  for (const field of ['createdAt', 'lastActiveAt', 'updatedAt'] as const) {
    if (!isIsoUtcTimestamp(session[field])) errors.push(`invalid ${field}`);
  }
  if (session.migratedFromDocumentId !== undefined && !isSafeRef(session.migratedFromDocumentId)) errors.push('invalid migratedFromDocumentId');
  if (session.schemaVersion !== 1) errors.push('unsupported schemaVersion');
  return errors;
}

export function createSession(params: {
  id: string;
  name: string;
  subjectId?: JeeSubjectId;
  chapterId?: string;
  topicIds?: string[];
  resourceIds?: string[];
  now?: Date;
}): StudySession {
  const at = (params.now ?? new Date()).toISOString();
  const chapter = params.chapterId ? getChapter(params.chapterId) : undefined;
  const session: StudySession = {
    id: params.id,
    name: params.name.trim().slice(0, MAX_SESSION_NAME_LENGTH),
    subjectId: params.subjectId ?? chapter?.subjectId,
    chapterId: params.chapterId,
    topicIds: [...new Set(params.topicIds ?? [])],
    resourceIds: [...new Set(params.resourceIds ?? [])],
    createdAt: at,
    lastActiveAt: at,
    updatedAt: at,
    schemaVersion: 1,
  };
  const errors = validateSession(session);
  if (errors.length > 0) throw new Error(`Invalid session: ${errors.join('; ')}`);
  return session;
}

export interface DocumentMigrationPlan {
  toCreate: StudySession[];
  alreadyMigrated: string[];
  skipped: Array<{ documentId: string; reason: string }>;
}

/**
 * Plans session references for documents that do not have one yet. Pure function: it only
 * returns new sessions; callers persist them. Re-running it after a partial failure is safe.
 */
export function planDocumentSessionMigration(
  documents: StudyDocument[],
  existingSessions: StudySession[],
  /** Ids of sessions the student deleted; they are never re-created. */
  deletedSessionIds: Iterable<string> = []
): DocumentMigrationPlan {
  const existingIds = new Set(existingSessions.map((s) => s.id));
  const deletedIds = new Set(deletedSessionIds);
  const referenced = new Set(existingSessions.flatMap((s) => s.resourceIds));
  const plan: DocumentMigrationPlan = { toCreate: [], alreadyMigrated: [], skipped: [] };
  const seenDocs = new Set<string>();

  for (const doc of documents) {
    if (!doc || typeof doc.id !== 'string' || !doc.id || doc.id.includes('/') || doc.id.length > 150) {
      plan.skipped.push({ documentId: String(doc?.id ?? ''), reason: 'invalid document id' });
      continue;
    }
    if (seenDocs.has(doc.id)) {
      plan.skipped.push({ documentId: doc.id, reason: 'duplicate document id' });
      continue;
    }
    seenDocs.add(doc.id);
    const sessionId = sessionIdForDocument(doc.id);
    if (deletedIds.has(sessionId)) {
      plan.skipped.push({ documentId: doc.id, reason: 'its study session was deleted by the student' });
      continue;
    }
    if (existingIds.has(sessionId) || referenced.has(doc.id)) {
      plan.alreadyMigrated.push(doc.id);
      continue;
    }
    const createdAt = toIsoUtc(doc.createdAt || doc.lastStudiedAt);
    const lastActiveAt = doc.lastStudiedAt ? toIsoUtc(doc.lastStudiedAt) : createdAt;
    plan.toCreate.push({
      id: sessionId,
      name: (doc.title || 'Study material').replace(/\.pdf$/i, '').trim().slice(0, MAX_SESSION_NAME_LENGTH) || 'Study material',
      topicIds: [],
      resourceIds: [doc.id],
      createdAt,
      lastActiveAt,
      updatedAt: lastActiveAt > createdAt ? lastActiveAt : createdAt,
      migratedFromDocumentId: doc.id,
      schemaVersion: 1,
    });
  }
  return plan;
}
