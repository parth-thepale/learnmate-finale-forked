import type { StudySession } from '../types/questionBank';
import { isIsoUtcTimestamp, STUDY_SESSION_LIMITS, toIsoUtc, validateSession } from '../utils/sessionModel';
import type { CloudData } from './cloudStore';

/**
 * Study-session sync rules (pure functions; the repository applies the results).
 *
 * - One Firestore document per session at users/{uid}/studySessions/{sessionId}.
 * - Edits: whole-record last-writer-wins on `updatedAt` (strictly increasing per change). Equal
 *   `updatedAt` with different content is broken by comparing canonical JSON, so every device
 *   converges on the same copy.
 * - Deletion is final: it is stored as a tombstone (the document is kept with deleted: true).
 *   A tombstone beats every live copy, whatever its timestamp, so an older or offline copy can
 *   never resurrect a deleted session. Session ids are random and never reused.
 */

export interface StudySessionTombstone {
  id: string;
  deletedAt: string;
  updatedAt: string;
}

export type CloudStudySession =
  | { kind: 'live'; session: StudySession }
  | { kind: 'tombstone'; tombstone: StudySessionTombstone };

export type StudySessionSyncState = 'device_only' | 'pending' | 'synced';

const LIVE_FIELDS = new Set([
  'id',
  'uid',
  'schemaVersion',
  'deleted',
  'name',
  'subjectId',
  'chapterId',
  'topicIds',
  'resourceIds',
  'createdAt',
  'lastActiveAt',
  'updatedAt',
  'migratedFromDocumentId',
]);

export function newStudySessionId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `sess-${random}`;
}

/** Stable JSON (sorted keys, undefined omitted) used for deterministic tie-breaking. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** >0 when `a` should win over `b`, <0 when `b` wins, 0 when they are the same version. */
export function compareStudySessions(a: StudySession, b: StudySession): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1;
  const ca = canonicalJson(a);
  const cb = canonicalJson(b);
  return ca === cb ? 0 : ca > cb ? 1 : -1;
}

export function encodeStudySessionDoc(uid: string, session: StudySession): CloudData {
  const data: CloudData = {
    id: session.id,
    uid,
    schemaVersion: 1,
    deleted: false,
    name: session.name.slice(0, STUDY_SESSION_LIMITS.nameLength),
    topicIds: session.topicIds.slice(0, STUDY_SESSION_LIMITS.topicIds),
    resourceIds: session.resourceIds.slice(0, STUDY_SESSION_LIMITS.resourceIds),
    createdAt: toIsoUtc(session.createdAt),
    lastActiveAt: toIsoUtc(session.lastActiveAt),
    updatedAt: toIsoUtc(session.updatedAt),
  };
  if (session.subjectId) data.subjectId = session.subjectId;
  if (session.chapterId) data.chapterId = session.chapterId;
  if (session.migratedFromDocumentId) data.migratedFromDocumentId = session.migratedFromDocumentId;
  return data;
}

export function encodeStudySessionTombstone(uid: string, tombstone: StudySessionTombstone): CloudData {
  return {
    id: tombstone.id,
    uid,
    schemaVersion: 1,
    deleted: true,
    deletedAt: toIsoUtc(tombstone.deletedAt),
    updatedAt: toIsoUtc(tombstone.updatedAt),
  };
}

/** Decodes a cloud document; returns null when it is not a valid session or tombstone. */
export function decodeStudySessionDoc(id: string, data: CloudData | null): CloudStudySession | null {
  if (!data || data.id !== id || data.schemaVersion !== 1) return null;
  if (data.deleted === true) {
    if (!isIsoUtcTimestamp(data.deletedAt) || !isIsoUtcTimestamp(data.updatedAt)) return null;
    return { kind: 'tombstone', tombstone: { id, deletedAt: data.deletedAt, updatedAt: data.updatedAt } };
  }
  if (data.deleted !== false || Object.keys(data).some((k) => !LIVE_FIELDS.has(k))) return null;
  const session: StudySession = {
    id,
    name: String(data.name ?? ''),
    ...(typeof data.subjectId === 'string' ? { subjectId: data.subjectId as StudySession['subjectId'] } : {}),
    ...(typeof data.chapterId === 'string' ? { chapterId: data.chapterId } : {}),
    topicIds: Array.isArray(data.topicIds) ? data.topicIds.filter((t): t is string => typeof t === 'string') : [],
    resourceIds: Array.isArray(data.resourceIds) ? data.resourceIds.filter((r): r is string => typeof r === 'string') : [],
    createdAt: String(data.createdAt ?? ''),
    lastActiveAt: String(data.lastActiveAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
    ...(typeof data.migratedFromDocumentId === 'string' ? { migratedFromDocumentId: data.migratedFromDocumentId } : {}),
    schemaVersion: 1,
  };
  return validateSession(session).length === 0 ? { kind: 'live', session } : null;
}

export type StudySessionResolution =
  | 'in_sync'
  | 'push_local'
  | 'push_tombstone'
  | 'adopt_remote'
  | 'adopt_tombstone'
  | 'nothing';

/** Decides what to do with one session id given the local state and the cloud copy. */
export function resolveStudySession(
  local: StudySession | undefined,
  localTombstone: StudySessionTombstone | undefined,
  remote: CloudStudySession | null
): StudySessionResolution {
  if (localTombstone) return remote?.kind === 'tombstone' ? 'in_sync' : 'push_tombstone';
  if (remote?.kind === 'tombstone') return 'adopt_tombstone';
  if (!local) return remote ? 'adopt_remote' : 'nothing';
  if (!remote) return 'push_local';
  const cmp = compareStudySessions(local, remote.session);
  return cmp > 0 ? 'push_local' : cmp < 0 ? 'adopt_remote' : 'in_sync';
}
