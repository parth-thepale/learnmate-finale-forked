import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudPaths } from './cloudStore';
import { scopedKey, STORAGE_KEYS } from './localScope';
import { HybridCloudStudyRepository } from './storageService';
import { deferred, FakeCloudStore, fakeUser, MemoryStorage } from './testDoubles';
import { sessionIdForDocument } from '../utils/sessionModel';
import type { QuizAttempt, StudyDocument } from '../types/study';

/** Storage whose writes to one raw key can be made to fail (simulates a full device). */
class FlakyStorage extends MemoryStorage {
  failKeySuffix: string | null = null;
  override setItem(key: string, value: string): void {
    if (this.failKeySuffix && key.endsWith(this.failKeySuffix)) throw new Error('QuotaExceededError');
    super.setItem(key, value);
  }
}

function makeDoc(id: string, overrides: Partial<StudyDocument> = {}): StudyDocument {
  return {
    id,
    title: `${id} notes.pdf`,
    sourceType: 'pdf',
    pageCount: 1,
    pages: [{ pageNumber: 1, title: 'Page 1', content: `Content of ${id}` }],
    topics: [],
    overview: `Overview of ${id}`,
    createdAt: '2026-10-01T00:00:00.000Z',
    lastStudiedAt: '2026-10-05T00:00:00.000Z',
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
    weakTopics: ['Kinematics'],
    strongTopics: [],
    completedAt: '2026-10-06T10:00:00.000Z',
  };
}

function device(cloud: FakeCloudStore, options: { storage?: MemoryStorage; migration?: boolean } = {}) {
  const storage = options.storage ?? new MemoryStorage();
  const repo = new HybridCloudStudyRepository({ storage, documentSessionMigration: options.migration ?? true });
  repo.attachCloudStore(cloud);
  return { repo, storage };
}

/** Puts documents into alice's cloud account (as another device would have). */
async function seedCloudDocuments(cloud: FakeCloudStore, docs: StudyDocument[], uid = 'alice') {
  const seeder = device(cloud, { migration: false }).repo;
  await seeder.syncWithCloudUser(fakeUser(uid));
  for (const d of docs) seeder.saveDocument(d);
  await seeder.flushPendingWrites();
}

/** Cloud contents, ignoring the sign-in timestamp that every sync refreshes on users/{uid}. */
function cloudSnapshot(cloud: FakeCloudStore): string {
  return JSON.stringify(
    [...cloud.docs.entries()].sort().map(([p, d]) => [p, p.split('/').length === 2 ? { ...d, updatedAt: '(sign-in time)' } : d])
  );
}

function snapshotOtherKeys(storage: MemoryStorage): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of storage.keys()) {
    if (/study_session|sync_dirty/.test(key)) continue;
    map.set(key, storage.getItem(key)!);
  }
  return map;
}

test('migration runs after the first full sync, from complete cloud data, one linked session per document', async () => {
  const cloud = new FakeCloudStore();
  await seedCloudDocuments(cloud, [makeDoc('doc-a'), makeDoc('doc-b', { lastStudiedAt: '2026-10-09T00:00:00.000Z' })]);
  const { repo } = device(cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));

  const report = repo.getLastDocumentSessionMigrationReport()!;
  assert.equal(report.status, 'completed');
  assert.equal(report.scope, 'account');
  assert.deepEqual([...report.eligibleDocumentIds].sort(), ['doc-a', 'doc-b']);
  assert.deepEqual(report.migrated.map((m) => m.documentId).sort(), ['doc-a', 'doc-b']);
  const session = repo.getStudySession(sessionIdForDocument('doc-b'))!;
  assert.deepEqual(session.resourceIds, ['doc-b']);
  assert.equal(session.migratedFromDocumentId, 'doc-b');
  assert.equal(session.name, 'doc-b notes');
  assert.equal(session.lastActiveAt, '2026-10-09T00:00:00.000Z');
  assert.equal(session.createdAt, '2026-10-01T00:00:00.000Z');
});

test('repeated migration is idempotent: no duplicates and no overwrites', async () => {
  const cloud = new FakeCloudStore();
  const { repo } = device(cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  repo.saveDocument(makeDoc('doc-a'));
  repo.saveDocument(makeDoc('doc-b'));
  assert.equal(repo.runDocumentSessionMigration().migrated.length, 2);
  const before = JSON.stringify(repo.getStudySessions());
  for (let i = 0; i < 3; i++) {
    const again = repo.runDocumentSessionMigration();
    assert.equal(again.status, 'completed');
    assert.equal(again.migrated.length, 0);
    assert.deepEqual([...again.alreadyMigrated].sort(), ['doc-a', 'doc-b']);
  }
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.equal(repo.getStudySessions().length, 2);
  assert.equal(JSON.stringify(repo.getStudySessions()), before);
});

test('a failed migration changes nothing and is retried without duplicates; interrupted runs resume', async () => {
  const cloud = new FakeCloudStore();
  const storage = new FlakyStorage();
  const { repo } = device(cloud, { storage });
  await repo.syncWithCloudUser(fakeUser('alice'));
  for (const id of ['doc-a', 'doc-b', 'doc-c']) repo.saveDocument(makeDoc(id));

  storage.failKeySuffix = STORAGE_KEYS.STUDY_SESSIONS;
  const failed = repo.runDocumentSessionMigration();
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errors.length, 3);
  assert.match(failed.errors[0].reason, /storage/);
  assert.deepEqual(repo.getStudySessions(), []);

  storage.failKeySuffix = null;
  const retried = repo.runDocumentSessionMigration();
  assert.equal(retried.status, 'completed');
  assert.equal(retried.migrated.length, 3);
  assert.equal(repo.getStudySessions().length, 3);

  // A run interrupted after saving only some sessions resumes where it stopped.
  const { repo: other } = device(new FakeCloudStore());
  await other.syncWithCloudUser(fakeUser('bob'));
  for (const id of ['doc-a', 'doc-b', 'doc-c']) other.saveDocument(makeDoc(id));
  other.insertStudySessions([
    { id: sessionIdForDocument('doc-a'), name: 'doc-a notes', topicIds: [], resourceIds: ['doc-a'], createdAt: '2026-10-01T00:00:00.000Z', lastActiveAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z', migratedFromDocumentId: 'doc-a', schemaVersion: 1 },
  ]);
  const resumed = other.runDocumentSessionMigration();
  assert.deepEqual(resumed.alreadyMigrated, ['doc-a']);
  assert.deepEqual(resumed.migrated.map((m) => m.documentId).sort(), ['doc-b', 'doc-c']);
  assert.equal(other.getStudySessions().length, 3);
});

test('existing sessions are preserved: newer edits and documents already in a session are left alone', async () => {
  const cloud = new FakeCloudStore();
  const { repo } = device(cloud, { migration: true });
  await repo.syncWithCloudUser(fakeUser('alice'));
  for (const id of ['doc-a', 'doc-b', 'doc-c']) repo.saveDocument(makeDoc(id));
  repo.insertStudySessions([
    { id: sessionIdForDocument('doc-a'), name: 'Renamed by the student', topicIds: [], resourceIds: ['doc-a'], createdAt: '2026-10-01T00:00:00.000Z', lastActiveAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', migratedFromDocumentId: 'doc-a', schemaVersion: 1 },
  ]);
  const own = repo.createStudySession({ name: 'My optics plan', resourceIds: ['doc-b'] });
  const report = repo.runDocumentSessionMigration();
  assert.deepEqual([...report.alreadyMigrated].sort(), ['doc-a', 'doc-b']);
  assert.deepEqual(report.migrated.map((m) => m.documentId), ['doc-c']);
  const a = repo.getStudySession(sessionIdForDocument('doc-a'))!;
  assert.equal(a.name, 'Renamed by the student');
  assert.equal(a.updatedAt, '2026-11-02T00:00:00.000Z');
  assert.deepEqual(repo.getStudySession(own.id)?.resourceIds, ['doc-b']);
  assert.equal(repo.getStudySession(sessionIdForDocument('doc-b')), null, 'no second session for a document already in one');
});

test('deleted (tombstoned) migrated sessions are never re-created', async () => {
  const cloud = new FakeCloudStore();
  const { repo } = device(cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  repo.saveDocument(makeDoc('doc-a'));
  repo.saveDocument(makeDoc('doc-b'));
  repo.runDocumentSessionMigration();
  assert.equal(repo.deleteStudySession(sessionIdForDocument('doc-a')), true);
  for (let i = 0; i < 2; i++) {
    const report = repo.runDocumentSessionMigration();
    assert.deepEqual(report.skipped, [{ documentId: 'doc-a', reason: 'its study session was deleted by the student' }]);
    assert.deepEqual(report.alreadyMigrated, ['doc-b']);
    assert.equal(report.migrated.length, 0);
  }
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.equal(repo.getStudySession(sessionIdForDocument('doc-a')), null);
  assert.ok(repo.getDocumentById('doc-a'), 'the document itself is kept');
});

test('no documents: nothing is created; untitled or empty documents still get a valid session', async () => {
  const { repo } = device(new FakeCloudStore());
  await repo.syncWithCloudUser(fakeUser('alice'));
  const empty = repo.runDocumentSessionMigration();
  assert.equal(empty.status, 'completed');
  assert.deepEqual([empty.eligibleDocumentIds, empty.migrated, empty.alreadyMigrated, empty.skipped, empty.errors], [[], [], [], [], []]);
  assert.deepEqual(repo.getStudySessions(), []);

  repo.saveDocument(makeDoc('doc-blank', { title: '', pages: [], overview: '', topics: [] }));
  repo.saveDocument(makeDoc('doc-pdf', { title: '.pdf' }));
  const report = repo.runDocumentSessionMigration();
  assert.equal(report.migrated.length, 2);
  assert.equal(repo.getStudySession(sessionIdForDocument('doc-blank'))?.name, 'Study material');
  assert.equal(repo.getStudySession(sessionIdForDocument('doc-pdf'))?.name, 'Study material');
});

test('accounts and the guest scope are migrated separately and never see each other’s sessions', async () => {
  const cloud = new FakeCloudStore();
  const storage = new MemoryStorage();
  const { repo } = device(cloud, { storage });
  repo.activateAccount(null);
  repo.saveDocument(makeDoc('guest-doc'));
  repo.activateAccount(fakeUser('alice'));
  repo.activateAccount(null); // re-entering the guest scope runs the guest migration
  assert.ok(repo.getStudySession(sessionIdForDocument('guest-doc')));
  assert.equal(repo.getLastDocumentSessionMigrationReport()?.scope, 'guest');

  await seedCloudDocuments(cloud, [makeDoc('alice-doc')]);
  await seedCloudDocuments(cloud, [makeDoc('bob-doc')], 'bob');
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.deepEqual(repo.getStudySessions().map((s) => s.migratedFromDocumentId), ['alice-doc']);
  await repo.syncWithCloudUser(fakeUser('bob'));
  assert.deepEqual(repo.getStudySessions().map((s) => s.migratedFromDocumentId), ['bob-doc']);
  repo.activateAccount(null);
  assert.deepEqual(repo.getStudySessions().map((s) => s.migratedFromDocumentId), ['guest-doc']);

  assert.ok(!storage.getItem(scopedKey('u_alice', STORAGE_KEYS.STUDY_SESSIONS))?.includes('guest-doc'));
  assert.ok(!storage.getItem(scopedKey('u_bob', STORAGE_KEYS.STUDY_SESSIONS))?.includes('alice-doc'));
  assert.ok(![...cloud.docs.keys()].some((p) => p.includes('/studySessions/')), 'session cloud sync is off: nothing is uploaded');
});

test('migration never runs on partially loaded data', async () => {
  const cloud = new FakeCloudStore();
  await seedCloudDocuments(cloud, [makeDoc('doc-a'), makeDoc('doc-b')]);

  // Signed in but no sync yet.
  const { repo } = device(cloud);
  repo.activateAccount(fakeUser('alice'));
  const early = repo.runDocumentSessionMigration();
  assert.equal(early.status, 'not_ready');
  assert.deepEqual(repo.getStudySessions(), []);

  // Sync in progress.
  const gate = deferred();
  cloud.gate = gate.promise;
  const syncing = repo.syncWithCloudUser(fakeUser('alice'));
  assert.equal(repo.runDocumentSessionMigration().status, 'not_ready');
  gate.resolve();
  cloud.gate = null;
  await syncing;
  assert.equal(repo.isInitialSyncComplete(), true);
  assert.equal(repo.getStudySessions().length, 2);

  // Sync failed.
  const failing = new FakeCloudStore();
  failing.failCommits = 'UNAVAILABLE';
  const { repo: offline } = device(failing);
  await offline.syncWithCloudUser(fakeUser('carol'));
  offline.saveDocument(makeDoc('doc-local'));
  assert.equal(offline.isInitialSyncComplete(), false);
  assert.equal(offline.runDocumentSessionMigration().status, 'not_ready');
  assert.deepEqual(offline.getStudySessions(), []);
  failing.failCommits = false;
  await offline.syncWithCloudUser(fakeUser('carol'));
  assert.equal(offline.getStudySessions().length, 1, 'runs once a full sync succeeds');

  // Unreadable cloud items mean the data is incomplete.
  const broken = new FakeCloudStore();
  await seedCloudDocuments(broken, [makeDoc('doc-x')], 'dave');
  broken.docs.set(cloudPaths.document('dave', 'doc-corrupt'), { id: 'doc-corrupt', uid: 'dave', lastStudiedAt: '2026-11-01T00:00:00.000Z', pagesJson: '{bad' });
  const { repo: daveRepo } = device(broken);
  await daveRepo.syncWithCloudUser(fakeUser('dave'));
  assert.equal(daveRepo.isInitialSyncComplete(), false);
  assert.deepEqual(daveRepo.getStudySessions(), []);

  // Switching accounts during a sync never migrates into the other account.
  const switchCloud = new FakeCloudStore();
  await seedCloudDocuments(switchCloud, [makeDoc('erin-doc')], 'erin');
  const { repo: switcher } = device(switchCloud);
  const gate2 = deferred();
  switchCloud.gate = gate2.promise;
  const pending = switcher.syncWithCloudUser(fakeUser('erin'));
  switcher.activateAccount(fakeUser('frank'));
  gate2.resolve();
  switchCloud.gate = null;
  await pending;
  assert.deepEqual(switcher.getStudySessions(), []);
  assert.equal(switcher.runDocumentSessionMigration().status, 'not_ready');

  // Feature flag off (launch default).
  const { repo: disabled } = device(cloud, { migration: false });
  await disabled.syncWithCloudUser(fakeUser('alice'));
  assert.equal(disabled.runDocumentSessionMigration().status, 'disabled');
  assert.equal(new HybridCloudStudyRepository({ storage: new MemoryStorage() }).runDocumentSessionMigration().status, 'disabled');
});

test('documents, attempts, chats, mistakes, revision plans and their cloud copies are untouched', async () => {
  const cloud = new FakeCloudStore();
  const storage = new MemoryStorage();
  const { repo } = device(cloud, { storage, migration: false });
  await repo.syncWithCloudUser(fakeUser('alice'));
  repo.saveDocument(makeDoc('doc-a'));
  repo.saveQuizAttempt(makeAttempt('att-1', 'doc-a'));
  repo.saveTutorMessages('doc-a', [{ id: 'm1', role: 'user', content: 'Explain v = u + at', createdAt: '2026-10-05T00:00:00.000Z' } as never]);
  repo.saveMistakeInsights('doc-a', [{ id: 'mi1', topic: 'Kinematics' } as never]);
  repo.saveRevisionPlan('doc-a', [{ id: 'r1', documentId: 'doc-a', topic: 'Kinematics' } as never]);
  repo.setActiveDocumentId('doc-a');
  await repo.flushPendingWrites();

  const localBefore = snapshotOtherKeys(storage);
  const cloudBefore = cloudSnapshot(cloud);

  const migrating = new HybridCloudStudyRepository({ storage, documentSessionMigration: true });
  migrating.attachCloudStore(cloud);
  await migrating.syncWithCloudUser(fakeUser('alice'));
  await migrating.flushPendingWrites();
  assert.equal(migrating.getStudySessions().length, 1);

  const localAfter = snapshotOtherKeys(storage);
  assert.deepEqual([...localAfter.keys()].sort(), [...localBefore.keys()].sort());
  for (const [key, value] of localBefore) {
    if (key.endsWith(STORAGE_KEYS.DOCUMENTS)) {
      // Sync may re-order the array but must keep every document byte-for-byte.
      assert.deepEqual(JSON.parse(localAfter.get(key)!), JSON.parse(value));
    } else {
      assert.equal(localAfter.get(key), value, key);
    }
  }
  assert.equal(cloudSnapshot(cloud), cloudBefore, 'no cloud document was rewritten');
  assert.equal(migrating.getQuizAttempts('doc-a').length, 1);
  assert.equal(migrating.getTutorMessages('doc-a').length, 1);
  assert.equal(migrating.getMistakeInsights('doc-a').length, 1);
  assert.equal(migrating.getRevisionPlan('doc-a').length, 1);
  assert.equal(migrating.getActiveDocumentId(), 'doc-a');
});
