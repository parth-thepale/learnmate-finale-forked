import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeCloudStore, fakeUser, MemoryStorage } from './testDoubles';
import { HybridCloudStudyRepository } from './storageService';
import { buildGradedAttempt, type GradedQuizAttempt } from '../utils/attemptV2';
import {
  QUESTION_SET_ID_PATTERN,
  TRUSTED_ATTEMPT_ID_PREFIX,
  trustedAttemptIdFor,
  isServerScoredAttempt,
  isTrustedAttemptShape,
  isVerifiedAttempt,
  resolveAttemptContext,
  validateTrustedAttempt,
} from '../utils/attemptContext';
import { encodeQuizAttempt, decodeQuizAttempt } from './cloudEntities';
import { encodeTrustedAttemptRecord } from '../server/trustedAttemptRecord';
import { cloudPaths } from './cloudStore';
import { readDirtySet, scopedKey, STORAGE_KEYS } from './localScope';
import { assessTopics, identifyWeakTopics, identifyAuthoritativeWeakTopics, TOPIC_EVIDENCE_RULES } from '../utils/weakTopics';
import type { QuizAttempt } from '../types/study';
import { FirestoreDataError } from '../utils/firestoreData';

const SET_A = 'qs_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SET_B = 'qs_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function makeTrusted(setId = SET_A, overrides: Record<string, unknown> = {}): GradedQuizAttempt {
  const base = buildGradedAttempt({
    attemptId: trustedAttemptIdFor(setId),
    questionSetId: setId,
    kind: 'ai_practice',
    mode: 'diagnostic',
    documentId: 'doc-1',
    documentTitle: 'Mechanics',
    sources: ['ai'],
    context: { type: 'document', documentId: 'doc-1', documentTitle: 'Mechanics' },
    marking: { id: 'jee_main_2026', correct: 4, incorrect: -1, unanswered: 0 },
    reviewMode: 'embedded',
    reviewQuestions: [
      { id: `${setId}-q1`, question: 'Q1', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'Exp', topic: 'Kinematics', sourcePage: 1, sourceQuote: 'Quote', difficulty: 'easy' },
    ] as any,
    selectedIndices: { [`${setId}-q1`]: 0 },
    score: {
      scheme: { id: 'jee_main_2026', correct: 4, incorrect: -1, unanswered: 0 },
      rawMarks: 4,
      maxMarks: 4,
      correct: 1,
      incorrect: 0,
      unanswered: 0,
      dropped: 0,
      attempted: 1,
      accuracy: 1,
      questions: [{ questionId: `${setId}-q1`, outcome: 'correct', marks: 4, topicIds: [], topicLabel: 'Kinematics', response: { type: 'mcq', optionId: 'A' } }],
      bySubject: {},
      byChapter: {},
      byTopic: {},
    },
    completedAt: '2026-11-03T12:00:00.000Z',
  });
  return { ...base, ...overrides } as GradedQuizAttempt;
}

function makeLegacyV1(id = 'v1-attempt-1', docId = 'doc-1'): QuizAttempt {
  return {
    id,
    documentId: docId,
    documentTitle: 'Legacy doc',
    mode: 'diagnostic',
    questions: [],
    answers: [{ questionId: 'q1', selectedIndex: 0, isCorrect: true, topic: 'Kinematics', sourcePage: 1 }],
    score: 1,
    totalQuestions: 1,
    percentage: 100,
    weakTopics: [],
    strongTopics: ['Kinematics'],
    completedAt: '2026-11-01T10:00:00.000Z',
  };
}

test('1. Trusted attempts are read-only: never upload through normal saves or full sync push', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));

  const trusted = makeTrusted();
  assert.ok(isServerScoredAttempt(trusted));

  // Normal attempt save
  repo.saveQuizAttempt(trusted);
  await repo.flushPendingWrites();

  // Saved locally
  assert.equal(repo.getQuizAttempts().length, 1);
  assert.equal(repo.getQuizAttempts()[0].id, trusted.id);

  // Cloud store MUST NOT receive the attempt
  assert.equal(cloud.docs.has(cloudPaths.attempt('alice', trusted.id)), false, 'trusted attempt must not upload on save');

  // Full sync push
  await repo.syncWithCloudUser(fakeUser('alice'));
  await repo.flushPendingWrites();
  assert.equal(cloud.docs.has(cloudPaths.attempt('alice', trusted.id)), false, 'trusted attempt must not upload on full sync push');
});

test('2. Retry queues cannot re-upload trusted attempts and stale needsSync markers are cleared safely', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);

  const trusted = makeTrusted();
  repo.saveQuizAttempt(trusted);

  // Manually plant a stale dirty marker for the trusted attempt
  const dirtyKey = scopedKey('u_alice', STORAGE_KEYS.SYNC_DIRTY);
  storage.setItem(dirtyKey, JSON.stringify({ attempts: { [trusted.id]: 1 }, documents: {}, studyState: {}, deletedDocuments: {}, profile: {}, studySessions: {}, deletedStudySessions: {} }));

  const dirtyBefore = readDirtySet(storage, 'u_alice');
  assert.equal(dirtyBefore.attempts[trusted.id], 1, 'dirty marker planted');

  // Sync / flushDirty
  await repo.syncWithCloudUser(fakeUser('alice'));
  await repo.flushPendingWrites();

  // Cloud should not be written to
  assert.equal(cloud.docs.has(cloudPaths.attempt('alice', trusted.id)), false);

  // Dirty marker must be safely cleared
  const dirtyAfter = readDirtySet(storage, 'u_alice');
  assert.equal(dirtyAfter.attempts[trusted.id], undefined, 'stale dirty marker cleared');
});

test('3. Chunk paths cannot upload trusted attempts: encodeQuizAttempt throws for client callers', () => {
  const trusted = makeTrusted();
  assert.throws(
    () => encodeQuizAttempt('alice', trusted),
    (err: unknown) => err instanceof FirestoreDataError && /trusted attempts are read-only/.test(err.message),
    'encodeQuizAttempt must reject server-scored attempt when called without allowTrusted'
  );

  // Server Admin SDK path succeeds with allowTrusted: true
  const serverOps = encodeQuizAttempt('alice', trusted, 0, { allowTrusted: true });
  assert.ok(serverOps.length > 0);
});

test('4. Server attempts are adopted during sync without marking them for upload', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);

  // Server writes trusted attempt to Firestore (Admin SDK)
  const trusted = makeTrusted();
  const ops = encodeTrustedAttemptRecord('alice', trusted);
  await cloud.commit(ops);
  assert.ok(cloud.docs.has(cloudPaths.attempt('alice', trusted.id)));

  // Client syncs
  await repo.syncWithCloudUser(fakeUser('alice'));

  // Local storage adopted the attempt
  const localAttempts = repo.getQuizAttempts();
  assert.equal(localAttempts.length, 1);
  assert.equal(localAttempts[0].id, trusted.id);
  assert.equal(localAttempts[0].rawMarks, 4);

  // Not marked in dirty set
  const dirty = readDirtySet(storage, 'u_alice');
  assert.equal(dirty.attempts[trusted.id], undefined, 'adopted server attempt is not marked dirty');
});

test('5. Repeated sync creates no duplicates and is completely idempotent', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);

  const trusted = makeTrusted();
  await cloud.commit(encodeTrustedAttemptRecord('alice', trusted));

  // Sync 1
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.equal(repo.getQuizAttempts().length, 1);

  // Sync 2
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.equal(repo.getQuizAttempts().length, 1);

  // Sync 3
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.equal(repo.getQuizAttempts().length, 1);
});

test('6. Interrupted sync recovers correctly', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);

  const trustedA = makeTrusted(SET_A);
  const trustedB = makeTrusted(SET_B);
  await cloud.commit(encodeTrustedAttemptRecord('alice', trustedA));
  await cloud.commit(encodeTrustedAttemptRecord('alice', trustedB));

  // Interrupt sync by switching generation mid-operation
  (repo as any).generation = 999;
  await repo.syncWithCloudUser(fakeUser('alice'));

  // Normal sync resumes
  await repo.syncWithCloudUser(fakeUser('alice'));
  const local = repo.getQuizAttempts();
  assert.equal(local.length, 2);
  const ids = new Set(local.map((a) => a.id));
  assert.ok(ids.has(trustedA.id));
  assert.ok(ids.has(trustedB.id));
});

test('7. Never overwrite a trusted server record with a client copy', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));

  const trusted = makeTrusted();
  // Save trusted record locally
  repo.saveQuizAttempt(trusted);
  assert.equal(repo.getQuizAttempts()[0].score, 1);
  assert.equal(repo.getQuizAttempts()[0].rawMarks, 4);

  // Tampered client copy attempting to overwrite
  const tamperedClientCopy = {
    ...trusted,
    scoredBy: undefined,
    score: 99,
    rawMarks: 999,
  } as unknown as QuizAttempt;

  repo.saveQuizAttempt(tamperedClientCopy);

  // Trusted server record is preserved intact
  const current = repo.getQuizAttempts()[0];
  assert.equal(current.score, 1, 'trusted score preserved');
  assert.equal(current.rawMarks, 4, 'trusted rawMarks preserved');
});

test('8. Client cannot promote an unverified record and embedded JSON markers alone do not establish trust', () => {
  const forgedAttempt = {
    ...makeLegacyV1('fake-att'),
    schemaVersion: 2,
    scoredBy: 'server',
    questionSetId: SET_A,
    id: trustedAttemptIdFor(SET_A),
  };

  // Embedded JSON markers alone do NOT establish trust
  assert.equal(isVerifiedAttempt(forgedAttempt, undefined), false);
  assert.equal(isVerifiedAttempt(forgedAttempt, { writtenByServer: true } as any), false);
  assert.equal(isVerifiedAttempt(forgedAttempt, { scoredBy: 'server' } as any), false);

  // Firestore attempt provenance is explicitly gated (Stage D)
  assert.equal(
    isVerifiedAttempt(forgedAttempt, { source: 'firestore_attempt', record: forgedAttempt, stageDRulesConfirmed: false }),
    false,
    'ungated firestore record must not be verified'
  );
  assert.equal(
    isVerifiedAttempt(forgedAttempt, { source: 'firestore_attempt', record: forgedAttempt }),
    false,
    'default firestore record must not be verified'
  );
});

test('9. Top-level trusted fields are preserved on decode and sync', async () => {
  const cloud = new FakeCloudStore();
  const trusted = makeTrusted(SET_A, {
    sessionId: 'sess-123',
    rawMarks: 4,
    maxMarks: 4,
  });

  const parentOps = encodeTrustedAttemptRecord('alice', trusted);
  await cloud.commit(parentOps);

  const storedDoc = cloud.docs.get(cloudPaths.attempt('alice', trusted.id))!;
  assert.equal(storedDoc.schemaVersion, 2);
  assert.equal(storedDoc.scoredBy, 'server');
  assert.equal(storedDoc.kind, 'ai_practice');
  assert.equal(storedDoc.questionSetId, SET_A);
  assert.equal(storedDoc.sessionId, 'sess-123');
  assert.equal(storedDoc.rawMarks, 4);
  assert.equal(storedDoc.maxMarks, 4);

  const decoded = await decodeQuizAttempt(cloud, 'alice', storedDoc);
  assert.equal((decoded as any).schemaVersion, 2);
  assert.equal((decoded as any).scoredBy, 'server');
  assert.equal((decoded as any).questionSetId, SET_A);
  assert.equal((decoded as any).sessionId, 'sess-123');
  assert.equal((decoded as any).rawMarks, 4);
  assert.equal((decoded as any).maxMarks, 4);
});

test('10. v1 attempts remain unchanged and readable', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));

  const v1 = makeLegacyV1('v1-1', 'doc-legacy');
  repo.saveQuizAttempt(v1);
  await repo.flushPendingWrites();

  // v1 attempts are client attempts and sync to cloud
  assert.ok(cloud.docs.has(cloudPaths.attempt('alice', 'v1-1')));

  // Read back locally
  const list = repo.getQuizAttempts('doc-legacy');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'v1-1');
  assert.equal(list[0].score, 1);
});

test('11. Legacy v2 attempts remain readable and resolve context correctly', () => {
  const legacyV2WithDoc = {
    ...makeLegacyV1('legacy-v2-1', 'doc-1'),
    schemaVersion: 2,
  };
  const res = resolveAttemptContext(legacyV2WithDoc);
  assert.ok(res.ok);
  assert.equal(res.source, 'legacy_document');
  assert.equal(res.context.type, 'document');
});

test('12. Unresolvable attempts are not misclassified as syllabus attempts', () => {
  const emptyDocNoContext = {
    id: 'bad-attempt',
    documentId: '',
    documentTitle: '',
    mode: 'diagnostic',
    completedAt: '2026-11-03T10:00:00Z',
  };
  const res = resolveAttemptContext(emptyDocNoContext);
  assert.equal(res.ok, false);
  assert.ok(res.reason.includes('no context and no valid documentId'));
});

test('13. Analytics and weak-topic calculations distinguish verified and unverified attempts', () => {
  // Unverified client attempts
  const unverifiedAttempts = [
    makeLegacyV1('att-1'),
    makeLegacyV1('att-2'),
    makeLegacyV1('att-3'),
    makeLegacyV1('att-4'),
    makeLegacyV1('att-5'),
    makeLegacyV1('att-6'),
  ];
  // Assess with no verified credentials
  const unverifiedEvidence = assessTopics(unverifiedAttempts);
  assert.equal(unverifiedEvidence.length, 1);
  assert.equal(unverifiedEvidence[0].label, 'Kinematics');
  assert.equal(unverifiedEvidence[0].isAuthoritative, false, 'unverified scores cannot become authoritative evidence');
  assert.equal(unverifiedEvidence[0].evidenceProvenance, 'unverified');
  assert.equal(unverifiedEvidence[0].verifiedAttemptedQuestions, 0);
  assert.equal(unverifiedEvidence[0].unverifiedAttemptedQuestions, 6);
  assert.ok(unverifiedEvidence[0].reason.includes('unverified practice evidence'));

  // Authoritative weak topics returns empty because no verified attempts exist
  assert.deepEqual(identifyAuthoritativeWeakTopics(unverifiedAttempts), []);

  // Now assess with verified attempts (confirmed server provenance)
  const verifiedAttempts = [
    makeTrusted('qs_11111111111111111111111111111111'),
    makeTrusted('qs_22222222222222222222222222222222'),
    makeTrusted('qs_33333333333333333333333333333333'),
    makeTrusted('qs_44444444444444444444444444444444'),
    makeTrusted('qs_55555555555555555555555555555555'),
    makeTrusted('qs_66666666666666666666666666666666'),
  ];
  const verifiedIds = new Set(verifiedAttempts.map((a) => a.id));

  const verifiedEvidence = assessTopics(verifiedAttempts, { verifiedAttemptIds: verifiedIds });
  assert.equal(verifiedEvidence.length, 1);
  assert.equal(verifiedEvidence[0].isAuthoritative, true, 'enough verified attempts establish authoritative evidence');
  assert.equal(verifiedEvidence[0].evidenceProvenance, 'verified');
  assert.equal(verifiedEvidence[0].verifiedAttemptedQuestions, 6);
  assert.equal(verifiedEvidence[0].unverifiedAttemptedQuestions, 0);
  assert.ok(verifiedEvidence[0].reason.includes('authoritative verified evidence'));

  // Mixed attempts
  const mixed = assessTopics([...unverifiedAttempts.slice(0, 3), ...verifiedAttempts.slice(0, 3)], {
    verifiedAttemptIds: verifiedIds,
  });
  assert.equal(mixed[0].evidenceProvenance, 'mixed');
  assert.equal(mixed[0].verifiedAttemptedQuestions, 3);
  assert.equal(mixed[0].unverifiedAttemptedQuestions, 3);
  assert.equal(mixed[0].isAuthoritative, false, 'need at least 6 verified questions for authoritative status');
});

test('14. Existing progress history is preserved across legacy attempts', () => {
  const legacyList = [
    makeLegacyV1('leg-1'),
    makeLegacyV1('leg-2'),
  ];
  const results = assessTopics(legacyList);
  assert.equal(results.length, 1);
  assert.equal(results[0].attemptedQuestions, 2);
  assert.equal(results[0].status, 'insufficient_evidence');
  // Legacy history is preserved, not dropped or lost
  assert.ok(results[0].label === 'Kinematics');
});

test('15. Local/remote collision: Forged local trusted marker versus remote attempt', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);
  repo.activateAccount(fakeUser('alice'));

  // Local record forged with trusted markers and inflated score
  const forgedLocal = makeTrusted(SET_A, { score: 99, rawMarks: 99 });
  repo.saveQuizAttempt(forgedLocal);

  // Genuine remote attempt in Firestore
  const genuineRemote = makeTrusted(SET_A, { score: 1, rawMarks: 4 });
  await cloud.commit(encodeTrustedAttemptRecord('alice', genuineRemote));

  // Sync runs BEFORE Stage D rules confirmation
  await repo.syncWithCloudUser(fakeUser('alice'));

  // Local is NOT prioritized over remote solely because isServerScoredAttempt is true
  const conflicts = repo.getAttemptConflicts();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].id, forgedLocal.id);
  assert.equal(conflicts[0].status, 'unresolved');
  assert.equal(conflicts[0].localAttempt.rawMarks, 99);
  assert.equal(conflicts[0].remoteAttempt.rawMarks, 4);

  // Neither version was silently discarded
  assert.ok(conflicts[0].localAttempt);
  assert.ok(conflicts[0].remoteAttempt);

  // Local conflicting record is never uploaded to cloud
  const remoteDoc = cloud.docs.get(cloudPaths.attempt('alice', forgedLocal.id))!;
  assert.equal(remoteDoc.rawMarks, 4, 'cloud record was not overwritten by local forged record');

  // Quarantined: neither is returned in canonical attempts before Stage D confirmation
  assert.equal(repo.getQuizAttempts().length, 0);
});

test('16. Local/remote collision: Genuine remote trusted attempt versus stale local copy', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);
  repo.activateAccount(fakeUser('alice'));

  // Stale local copy
  const staleLocal = { ...makeLegacyV1(trustedAttemptIdFor(SET_A)), score: 1, rawMarks: 2 } as any;
  repo.saveQuizAttempt(staleLocal);

  // Genuine remote trusted attempt
  const genuine = makeTrusted(SET_A, { score: 1, rawMarks: 4 });
  await cloud.commit(encodeTrustedAttemptRecord('alice', genuine));

  // Sync runs before Stage D confirmation
  await repo.syncWithCloudUser(fakeUser('alice'));

  // Conflicting same-ID records are quarantined as unresolved conflict
  const conflict = repo.getAttemptConflict(genuine.id);
  assert.ok(conflict);
  assert.equal(conflict.status, 'unresolved');
  assert.equal(conflict.localAttempt.score, 1);
  assert.equal(conflict.remoteAttempt.score, 1);
  assert.equal(conflict.remoteAttempt.rawMarks, 4);

  // Local record is never uploaded
  const remoteDoc = cloud.docs.get(cloudPaths.attempt('alice', genuine.id))!;
  assert.equal(remoteDoc.rawMarks, 4);
});

test('17. Local/remote collision: Same ID with different scores and outcomes preserves diagnostics without PII/content', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);
  repo.activateAccount(fakeUser('alice'));

  const id = trustedAttemptIdFor(SET_A);
  const localAttempt: QuizAttempt = {
    ...makeLegacyV1(id),
    score: 2,
    answers: [
      { questionId: 'q1', isCorrect: true, selectedIndex: 0, topic: 'Kinematics', sourcePage: 1 },
      { questionId: 'q2', isCorrect: false, selectedIndex: 1, topic: 'Kinematics', sourcePage: 1 },
    ],
  };
  repo.saveQuizAttempt(localAttempt);

  const remoteAttempt: QuizAttempt = {
    ...makeLegacyV1(id),
    score: 4,
    answers: [
      { questionId: 'q1', isCorrect: true, selectedIndex: 0, topic: 'Kinematics', sourcePage: 1 },
      { questionId: 'q2', isCorrect: true, selectedIndex: 0, topic: 'Kinematics', sourcePage: 1 },
    ],
  };
  await cloud.commit(encodeQuizAttempt('alice', remoteAttempt, 0, { allowTrusted: true }));

  await repo.syncWithCloudUser(fakeUser('alice'));

  const conflict = repo.getAttemptConflict(id);
  assert.ok(conflict);
  assert.equal(conflict.diagnostics.id, id);
  assert.equal(conflict.diagnostics.localScore, 2);
  assert.equal(conflict.diagnostics.remoteScore, 4);
  assert.equal(conflict.diagnostics.scoreDifference, 2);
  assert.equal(conflict.diagnostics.localOutcomesCount, 2);
  assert.equal(conflict.diagnostics.remoteOutcomesCount, 2);

  // Diagnostics must NOT leak question content, answer keys, or personal data
  const diagJson = JSON.stringify(conflict.diagnostics);
  assert.ok(!diagJson.includes('question'));
  assert.ok(!diagJson.includes('options'));
  assert.ok(!diagJson.includes('explanation'));
  assert.ok(!diagJson.includes('correctOption'));
  assert.ok(!diagJson.includes('alice'));
  assert.ok(!diagJson.includes('email'));
});

test('18. Conflict survives interrupted sync', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);
  repo.activateAccount(fakeUser('alice'));

  const forgedLocal = makeTrusted(SET_A, { score: 99, rawMarks: 99 });
  repo.saveQuizAttempt(forgedLocal);

  const genuineRemote = makeTrusted(SET_A, { score: 1, rawMarks: 4 });
  await cloud.commit(encodeTrustedAttemptRecord('alice', genuineRemote));

  // Interrupt sync during execution by generation change
  (repo as any).generation = 999;
  await repo.syncWithCloudUser(fakeUser('alice'));

  // Instantiate fresh repository over the same storage to verify persistence
  const repo2 = new HybridCloudStudyRepository({ storage });
  repo2.activateAccount(fakeUser('alice'));

  const conflict = repo2.getAttemptConflict(forgedLocal.id);
  assert.ok(conflict, 'conflict must survive interrupted sync');
  assert.equal(conflict.status, 'unresolved');
  assert.equal(conflict.localAttempt.rawMarks, 99);
  assert.equal(conflict.remoteAttempt.rawMarks, 4);
});

test('19. Conflict resolves after provenance confirmation: server record becomes canonical', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);
  repo.activateAccount(fakeUser('alice'));

  const forgedLocal = makeTrusted(SET_A, { score: 99, rawMarks: 99 });
  repo.saveQuizAttempt(forgedLocal);

  const genuineRemote = makeTrusted(SET_A, { score: 1, rawMarks: 4 });
  await cloud.commit(encodeTrustedAttemptRecord('alice', genuineRemote));

  // First sync: creates unresolved conflict
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.equal(repo.getQuizAttempts().length, 0, 'quarantined before Stage D');

  // Stage D provenance confirmed!
  repo.setStageDRulesConfirmed(true);
  assert.equal(repo.isStageDRulesConfirmed(), true);

  // Conflict resolves and canonical attempt becomes available
  const conflict = repo.getAttemptConflict(forgedLocal.id);
  assert.ok(conflict);
  assert.equal(conflict.status, 'resolved');
  assert.equal(conflict.canonicalAttempt?.rawMarks, 4);

  // Canonical attempt is now returned in getQuizAttempts()
  const attempts = repo.getQuizAttempts();
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].rawMarks, 4, 'server-authoritative record became canonical');
});

test('20. Dirty-marker race: Clear only inspected revision and preserve newer writes', () => {
  const storage = new MemoryStorage();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.activateAccount(fakeUser('alice'));

  const attemptId = 'att-client-race-1';
  const dirtyKey = scopedKey('u_alice', STORAGE_KEYS.SYNC_DIRTY);

  // 1. Storage has dirty marker at revision 100 (inspected by sync)
  const inspectedRev = 100;
  storage.setItem(
    dirtyKey,
    JSON.stringify({
      attempts: { [attemptId]: inspectedRev },
      documents: {},
      studyState: {},
      deletedDocuments: {},
      profile: {},
      studySessions: {},
      deletedStudySessions: {},
    })
  );

  // 2. While sync is processing, a newer concurrent write updates dirty marker to rev 200
  const newerRev = 200;
  const updatedDirty = readDirtySet(storage, 'u_alice');
  updatedDirty.attempts[attemptId] = newerRev;
  storage.setItem(dirtyKey, JSON.stringify(updatedDirty));

  // 3. Sync attempts to clear using its inspected revision (100)
  (repo as any).clearDirty('attempts', attemptId, inspectedRev);

  // 4. Newer revision 200 MUST NOT be wiped out!
  const dirtyAfter = readDirtySet(storage, 'u_alice');
  assert.equal(
    dirtyAfter.attempts[attemptId],
    newerRev,
    'newer write dirty marker must survive clearance of older inspected revision'
  );

  // 5. Clearing with the matching newer revision (200) successfully clears it
  (repo as any).clearDirty('attempts', attemptId, newerRev);
  const dirtyCleared = readDirtySet(storage, 'u_alice');
  assert.equal(dirtyCleared.attempts[attemptId], undefined, 'matching revision is cleared safely');
});

test('21. Dirty-marker race in syncWithCloudUser: concurrent write during collection query is not cleared', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);
  repo.activateAccount(fakeUser('alice'));

  const attemptId = 'att-client-race-2';
  const attemptV1 = makeLegacyV1(attemptId);
  repo.saveQuizAttempt(attemptV1);
  await cloud.commit(encodeQuizAttempt('alice', attemptV1));

  // Clear pending writes
  await repo.flushPendingWrites();

  // Plant a dirty marker for attemptId at rev 100
  const dirtyKey = scopedKey('u_alice', STORAGE_KEYS.SYNC_DIRTY);
  const dirtyData = { attempts: { [attemptId]: 100 }, documents: {}, studyState: {}, deletedDocuments: {}, profile: {}, studySessions: {}, deletedStudySessions: {} };
  storage.setItem(dirtyKey, JSON.stringify(dirtyData));

  // While sync is querying cloud collection, a concurrent write updates dirty marker to rev 500
  const origList = cloud.listCollection.bind(cloud);
  cloud.listCollection = async (collectionPath: string) => {
    const res = await origList(collectionPath);
    if (collectionPath.includes('attempts')) {
      const d = readDirtySet(storage, 'u_alice');
      d.attempts[attemptId] = 500; // newer concurrent write
      storage.setItem(dirtyKey, JSON.stringify(d));
    }
    return res;
  };

  await repo.syncWithCloudUser(fakeUser('alice'));

  // Sync inspected rev 100, but concurrent write set rev 500.
  // Because sync clears only inspected revision 100, rev 500 survives!
  const dirtyAfter = readDirtySet(storage, 'u_alice');
  assert.equal(dirtyAfter.attempts[attemptId], 500, 'newer dirty revision 500 was not cleared by sync');
});
