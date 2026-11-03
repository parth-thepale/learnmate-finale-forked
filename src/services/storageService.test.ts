import test from 'node:test';
import assert from 'node:assert/strict';
import { HybridCloudStudyRepository, DEFAULT_STUDENT_PROFILE } from './storageService';
import { scopedKey, STORAGE_KEYS, listScopeRawKeys } from './localScope';
import { deferred, FakeCloudStore, fakeUser, MemoryStorage } from './testDoubles';
import type { QuizAttempt, StudyDocument } from '../types/study';

function makeDoc(id: string, overrides: Partial<StudyDocument> = {}): StudyDocument {
  return {
    id,
    title: `${id} notes`,
    sourceType: 'text',
    pageCount: 1,
    pages: [{ pageNumber: 1, title: 'Page 1', content: `Content of ${id}` }],
    topics: [],
    overview: `Overview of ${id}`,
    createdAt: '2026-11-01T00:00:00.000Z',
    lastStudiedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeAttempt(id: string, documentId: string): QuizAttempt {
  return {
    id,
    documentId,
    documentTitle: documentId,
    mode: 'diagnostic',
    questions: [],
    answers: [],
    score: 3,
    totalQuestions: 5,
    percentage: 60,
    weakTopics: [],
    strongTopics: [],
    completedAt: '2026-11-02T10:00:00.000Z',
  };
}

function makeRepo(storage = new MemoryStorage(), cloud = new FakeCloudStore()) {
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);
  return { repo, storage, cloud };
}

const cloudDocIds = (cloud: FakeCloudStore, uid: string) =>
  [...cloud.docs.keys()]
    .filter((p) => p.startsWith(`users/${uid}/documents/`) && p.split('/').length === 4)
    .map((p) => p.split('/')[3])
    .sort();

test('a new account starts empty: no seeded documents, notifications, planner tasks or weak areas', async () => {
  const { repo } = makeRepo();
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.deepEqual(repo.getDocuments(), []);
  assert.deepEqual(repo.getNotifications(), []);
  assert.deepEqual(repo.getStudyPlannerTasks(), []);
  assert.deepEqual(repo.getQuizAttempts(), []);
  const profile = repo.getStudentProfile();
  assert.deepEqual(profile.weakAreas, []);
  assert.equal(profile.fullName, '');
  assert.equal(profile.schoolName, '');
  assert.equal(profile.updatedAt, '');
  assert.equal(repo.hasSavedStudentProfile(), false);
  assert.deepEqual(DEFAULT_STUDENT_PROFILE.weakAreas, []);
});

test('reads and writes are ignored until the account scope is resolved', () => {
  const { repo, storage } = makeRepo();
  repo.saveDocument(makeDoc('early'));
  assert.equal(storage.length, 0);
  assert.deepEqual(repo.getDocuments(), []);
});

test('shared device: guest data is never uploaded into an account and accounts never see each other', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const { repo } = makeRepo(storage, cloud);

  repo.activateAccount(null);
  repo.saveDocument(makeDoc('guest-doc'));
  repo.saveQuizAttempt(makeAttempt('guest-attempt', 'guest-doc'));

  await repo.syncWithCloudUser(fakeUser('alice'));
  repo.saveDocument(makeDoc('alice-doc'));
  await repo.flushPendingWrites();
  assert.deepEqual(repo.getDocuments().map((d) => d.id), ['alice-doc']);
  assert.deepEqual(cloudDocIds(cloud, 'alice'), ['alice-doc']);
  assert.equal(cloud.docs.has('users/alice/attempts/guest-attempt'), false);

  // Alice's session ends without an explicit sign-out (e.g. token expired); Bob signs in.
  await repo.syncWithCloudUser(fakeUser('bob'));
  assert.deepEqual(repo.getDocuments(), []);
  repo.saveDocument(makeDoc('bob-doc'));
  await repo.flushPendingWrites();
  assert.deepEqual(cloudDocIds(cloud, 'bob'), ['bob-doc']);
  assert.deepEqual(cloudDocIds(cloud, 'alice'), ['alice-doc'], "Bob's session must not touch Alice's account");

  // Guest data is still only in the guest scope.
  repo.activateAccount(null);
  assert.deepEqual(repo.getDocuments().map((d) => d.id), ['guest-doc']);
});

test('explicit sign-out removes the account from the device; cloud data is restored on next sign-in', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const { repo } = makeRepo(storage, cloud);

  await repo.syncWithCloudUser(fakeUser('alice'));
  repo.saveDocument(makeDoc('alice-doc'));
  repo.saveQuizAttempt(makeAttempt('a1', 'alice-doc'));
  repo.saveTutorMessages('alice-doc', [
    { id: 'm1', role: 'user', content: 'What is torque?', timestamp: '2026-11-02T10:00:00.000Z' } as never,
  ]);
  await repo.flushPendingWrites();
  assert.equal(repo.getUnsyncedChangeCount(), 0);

  repo.clearCurrentAccountFromDevice();
  assert.deepEqual(listScopeRawKeys(storage, 'u_alice'), []);
  assert.equal(repo.getActiveScope(), null);

  // Next person on this device sees nothing of Alice's.
  repo.activateAccount(null);
  assert.deepEqual(repo.getDocuments(), []);
  assert.deepEqual(repo.getQuizAttempts(), []);

  // Alice signs in again: her data comes back from the cloud.
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.deepEqual(repo.getDocuments().map((d) => d.id), ['alice-doc']);
  assert.deepEqual(repo.getQuizAttempts().map((a) => a.id), ['a1']);
  assert.equal(repo.getTutorMessages('alice-doc').length, 1);
});

test('an implicit session end keeps unsynced local work hidden until the same account returns', async () => {
  const cloud = new FakeCloudStore();
  const { repo } = makeRepo(new MemoryStorage(), cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  cloud.failCommits = 'UNAVAILABLE: offline';
  repo.saveDocument(makeDoc('offline-doc'));
  await repo.flushPendingWrites();
  assert.equal(repo.getUnsyncedChangeCount(), 1);

  repo.activateAccount(null);
  assert.deepEqual(repo.getDocuments(), []);

  cloud.failCommits = false;
  await repo.syncWithCloudUser(fakeUser('alice'));
  await repo.flushPendingWrites();
  assert.deepEqual(cloudDocIds(cloud, 'alice'), ['offline-doc']);
  assert.equal(repo.getUnsyncedChangeCount(), 0);
});

test('a failed cloud write is reported as unsynced, never as synced, and is retried on the next sync', async () => {
  const cloud = new FakeCloudStore();
  const { repo } = makeRepo(new MemoryStorage(), cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.equal(repo.getSyncSnapshot().state, 'synced');

  cloud.failCommits = 'PERMISSION_DENIED: Missing or insufficient permissions.';
  repo.saveQuizAttempt(makeAttempt('a1', 'doc-x'));
  await repo.flushPendingWrites();
  const failed = repo.getSyncSnapshot();
  assert.equal(failed.state, 'unsynced');
  assert.equal(failed.unsyncedChanges, 1);
  assert.ok(failed.lastError);

  // The pending change survives a reload (new repository instance over the same storage).
  const storageAfterReload = (repo as unknown as { storage: MemoryStorage }).storage;
  const reloaded = new HybridCloudStudyRepository({ storage: storageAfterReload });
  reloaded.attachCloudStore(cloud);
  cloud.failCommits = false;
  await reloaded.syncWithCloudUser(fakeUser('alice'));
  await reloaded.flushPendingWrites();
  assert.ok(cloud.docs.has('users/alice/attempts/a1'));
  assert.equal(reloaded.getSyncSnapshot().state, 'synced');
  assert.equal(reloaded.getUnsyncedChangeCount(), 0);
});

test('documents larger than 1 MiB sync through chunks and arrive intact on another device', async () => {
  const cloud = new FakeCloudStore();
  const deviceA = makeRepo(new MemoryStorage(), cloud).repo;
  await deviceA.syncWithCloudUser(fakeUser('alice'));

  const pages = Array.from({ length: 20 }, (_, i) => ({
    pageNumber: i + 1,
    title: `Chapter part ${i + 1}`,
    content: `∫ sin²x dx — रासायनिक बंधन — ${'Newton’s laws of motion. '.repeat(3000)}`,
  }));
  const bigDoc = makeDoc('big-doc', { pages, pageCount: 20, sourceType: 'pdf' });
  deviceA.saveDocument(bigDoc);
  const tutorHistory = Array.from({ length: 400 }, (_, i) => ({
    id: `m${i}`,
    role: 'assistant',
    content: 'Explanation '.repeat(300),
    timestamp: '2026-11-02T10:00:00.000Z',
  }));
  deviceA.saveTutorMessages('big-doc', tutorHistory as never);
  await deviceA.flushPendingWrites();

  assert.equal(deviceA.getSyncSnapshot().state, 'synced');
  assert.ok(cloud.largestDocumentBytes() < 1_048_576, 'no stored document may exceed 1 MiB');
  assert.equal(cloud.docs.get('users/alice/documents/big-doc')?.payloadEncoding, 'chunked');

  const deviceB = makeRepo(new MemoryStorage(), cloud).repo;
  await deviceB.syncWithCloudUser(fakeUser('alice'));
  const received = deviceB.getDocumentById('big-doc');
  assert.ok(received);
  assert.deepEqual(received.pages, pages);
  assert.equal(deviceB.getTutorMessages('big-doc').length, 400);
});

test('shrinking a chunked document removes stale chunks', async () => {
  const cloud = new FakeCloudStore();
  const { repo } = makeRepo(new MemoryStorage(), cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  const pages = Array.from({ length: 10 }, (_, i) => ({ pageNumber: i + 1, title: 't', content: 'x'.repeat(200_000) }));
  repo.saveDocument(makeDoc('d', { pages }));
  await repo.flushPendingWrites();
  const chunkPaths = () => [...cloud.docs.keys()].filter((p) => p.startsWith('users/alice/documents/d/chunks/'));
  assert.ok(chunkPaths().length >= 3);

  repo.saveDocument(makeDoc('d', { lastStudiedAt: '2026-11-03T00:00:00.000Z' }));
  await repo.flushPendingWrites();
  assert.deepEqual(chunkPaths(), []);
  assert.equal(cloud.docs.get('users/alice/documents/d')?.payloadEncoding, 'inline');
});

test('a corrupted (legacy truncated) cloud copy never replaces or deletes the local copy', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const local = makeDoc('doc-1', { lastStudiedAt: '2026-11-01T00:00:00.000Z' });
  storage.setItem(scopedKey('u_alice', STORAGE_KEYS.DOCUMENTS), JSON.stringify([local]));
  cloud.docs.set('users/alice/documents/doc-1', {
    id: 'doc-1',
    uid: 'alice',
    title: 'doc-1',
    sourceType: 'pdf',
    pageCount: 1,
    pagesJson: '[{"pageNumber":1,"content":"truncated by the old sli', // legacy .slice() corruption
    topicsJson: '[]',
    overview: '',
    createdAt: '2026-11-01T00:00:00.000Z',
    lastStudiedAt: '2026-11-05T00:00:00.000Z',
  });

  const { repo } = makeRepo(storage, cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  await repo.flushPendingWrites();
  assert.deepEqual(repo.getDocumentById('doc-1')?.pages, local.pages);
  // The cloud copy was repaired from the device.
  assert.equal(cloud.docs.get('users/alice/documents/doc-1')?.pagesJson, JSON.stringify(local.pages));
});

test('switching accounts mid-sync never writes the previous account’s cloud data into the new scope', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  cloud.docs.set('users/alice/documents/alice-secret', {
    id: 'alice-secret',
    uid: 'alice',
    title: 'Alice secret',
    sourceType: 'text',
    pageCount: 1,
    pagesJson: JSON.stringify([{ pageNumber: 1, title: 'p', content: 'private' }]),
    topicsJson: '[]',
    overview: '',
    createdAt: '2026-11-01T00:00:00.000Z',
    lastStudiedAt: '2026-11-01T00:00:00.000Z',
  });
  const { repo } = makeRepo(storage, cloud);

  const gate = deferred();
  cloud.gate = gate.promise;
  const aliceSync = repo.syncWithCloudUser(fakeUser('alice'));
  // Before Alice's sync finishes, Bob signs in on the same device.
  repo.activateAccount(fakeUser('bob'));
  cloud.gate = null;
  gate.resolve();
  await aliceSync;
  await repo.syncWithCloudUser(fakeUser('bob'));

  assert.deepEqual(repo.getDocuments(), []);
  const bobKeys = listScopeRawKeys(storage, 'u_bob').join(',');
  assert.ok(!bobKeys.includes('alice'), bobKeys);
  assert.ok(!(storage.getItem(scopedKey('u_bob', STORAGE_KEYS.DOCUMENTS)) || '').includes('alice-secret'));
});

test('untouched seeded demo documents in the cloud are not restored; used ones are kept', async () => {
  const cloud = new FakeCloudStore();
  const seeded = (id: string) => ({
    id,
    uid: 'alice',
    title: id,
    sourceType: 'pdf',
    pageCount: 1,
    pagesJson: JSON.stringify([{ pageNumber: 1, title: 'p', content: 'demo' }]),
    topicsJson: '[]',
    overview: '',
    createdAt: '2026-10-01T00:00:00.000Z',
    lastStudiedAt: '2026-10-01T00:00:00.000Z',
  });
  cloud.docs.set('users/alice/documents/doc-probability-notes', seeded('doc-probability-notes'));
  cloud.docs.set('users/alice/documents/doc-sets-relations', seeded('doc-sets-relations'));
  cloud.docs.set('users/alice/attempts/a1', {
    id: 'a1',
    uid: 'alice',
    documentId: 'doc-sets-relations',
    documentTitle: 'Sets',
    mode: 'diagnostic',
    score: 3,
    totalQuestions: 5,
    percentage: 60,
    attemptJson: JSON.stringify(makeAttempt('a1', 'doc-sets-relations')),
    completedAt: '2026-11-02T10:00:00.000Z',
  });
  const { repo } = makeRepo(new MemoryStorage(), cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.deepEqual(repo.getDocuments().map((d) => d.id), ['doc-sets-relations']);
});

test('student profile is saved per account and restored from the cloud on another device', async () => {
  const cloud = new FakeCloudStore();
  const deviceA = makeRepo(new MemoryStorage(), cloud).repo;
  await deviceA.syncWithCloudUser(fakeUser('alice'));
  deviceA.saveStudentProfile({ ...deviceA.getStudentProfile(), fullName: 'Alice', targetExamYear: '2027' });
  await deviceA.flushPendingWrites();

  const deviceB = makeRepo(new MemoryStorage(), cloud).repo;
  await deviceB.syncWithCloudUser(fakeUser('alice'));
  assert.equal(deviceB.getStudentProfile().fullName, 'Alice');

  await deviceB.syncWithCloudUser(fakeUser('bob'));
  assert.equal(deviceB.getStudentProfile().fullName, '');
});

test('progress reset removes attempts from the cloud as well', async () => {
  const cloud = new FakeCloudStore();
  const { repo } = makeRepo(new MemoryStorage(), cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  repo.saveDocument(makeDoc('d1'));
  repo.saveQuizAttempt(makeAttempt('a1', 'd1'));
  await repo.flushPendingWrites();
  assert.ok(cloud.docs.has('users/alice/attempts/a1'));
  repo.clearAllProgress();
  await repo.flushPendingWrites();
  assert.equal(cloud.docs.has('users/alice/attempts/a1'), false);
  assert.deepEqual(repo.getQuizAttempts(), []);
  assert.equal(repo.getUnsyncedChangeCount(), 0);
});

test('running out of local storage is surfaced instead of silently ignored', async () => {
  const { repo } = makeRepo(new MemoryStorage(2_000));
  repo.activateAccount(null);
  repo.saveDocument(makeDoc('huge', { pages: [{ pageNumber: 1, title: 't', content: 'y'.repeat(5_000) }] }));
  assert.deepEqual(repo.getDocuments(), []);
  assert.ok(repo.getSyncSnapshot().lastError?.includes('storage space'));
});
