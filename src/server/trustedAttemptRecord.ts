import { encodeQuizAttempt } from '../services/cloudEntities';
import { cloudPaths, type CloudData, type CloudWriteOp } from '../services/cloudStore';
import type { GradedQuizAttempt } from '../utils/attemptV2';
import { validateTrustedAttempt } from '../utils/attemptContext';
import { toFirestoreData } from '../utils/firestoreData';

/**
 * Firestore encoding of a trusted (server-scored) attempt at users/{uid}/attempts/{attemptId}.
 * Written only by the server (Admin SDK). It reuses the existing attempt encoding (legacy
 * indexed fields + attemptJson, chunked when large) so existing clients can still read it, and
 * adds top-level trusted fields that clients will never be allowed to write (rules, Stage D).
 */

export class TrustedAttemptRejectedError extends Error {
  constructor(readonly problems: string[]) {
    super(`Trusted attempt rejected: ${problems.slice(0, 3).join(' | ')}`);
    this.name = 'TrustedAttemptRejectedError';
  }
}

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function trustedParentFields(attempt: GradedQuizAttempt): CloudData {
  const context = attempt.context!;
  const fields: CloudData = {
    schemaVersion: 2,
    scoredBy: 'server',
    kind: attempt.kind,
    contextType: context.type,
    questionSetId: attempt.questionSetId,
    markingSchemeId: attempt.markingSchemeId,
    rawMarks: attempt.rawMarks,
    maxMarks: attempt.maxMarks,
  };
  if (attempt.sessionId) fields.sessionId = attempt.sessionId;
  if (context.type === 'syllabus') {
    fields.examType = context.examType;
    fields.syllabusId = context.syllabusId;
    fields.syllabusRevision = context.syllabusRevision;
    fields.subjectId = context.subjectId;
    fields.chapterId = context.chapterId;
  }
  return fields;
}

/**
 * Write operations for a trusted attempt. Validates the attempt first (throws
 * TrustedAttemptRejectedError) so nothing invalid can be persisted with Admin privileges.
 */
export function encodeTrustedAttemptRecord(uid: string, attempt: GradedQuizAttempt, previousChunkCount = 0): CloudWriteOp[] {
  if (!UID_PATTERN.test(uid)) throw new TrustedAttemptRejectedError(['uid is invalid.']);
  const problems = validateTrustedAttempt(attempt);
  if (problems.length > 0) throw new TrustedAttemptRejectedError(problems);
  const parentPath = cloudPaths.attempt(uid, attempt.id);
  return encodeQuizAttempt(uid, attempt, previousChunkCount, { allowTrusted: true }).map((op) => {
    if (op.type !== 'set') return op;
    const data = op.path === parentPath ? { ...op.data, ...trustedParentFields(attempt) } : op.data;
    return { ...op, data: toFirestoreData(data, { label: op.path }) };
  });
}
