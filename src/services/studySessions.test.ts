import test from 'node:test';
import assert from 'node:assert/strict';
import type { StudySession } from '../types/questionBank';
import { planDocumentSessionMigration } from '../utils/sessionModel';
import { cloudPaths, type CloudWriteOp } from './cloudStore';
import { scopedKey, STORAGE_KEYS } from './localScope';
import { HybridCloudStudyRepository, StudySessionError } from './storageService';
import { compareStudySessions, decodeStudySessionDoc, encodeStudySessionDoc, resolveStudySession } from './studySessionSync';
import { deferred, FakeCloudStore, fakeUser, MemoryStorage } from './testDoubles';
import type { StudyDocument } from '../types/study';

/** Fake cloud that also enforces the study-session rules: updatedAt never goes back, tombstones are final. */
class RulesFakeCloudStore extends FakeCloudStore {
  rejected = 0;
  override async commit(ops: CloudWriteOp[]): Promise<void> {
    for (const op of ops) {
      if (op.type === 'delete' && op.path.includes('/studySessions/')) throw this.deny();
      if (op.type !== 'set' || !op.path.includes('/studySessions/')) continue;
      const existing = this.docs.get(op.path);
      if (!existing) continue;
      if (existing.deleted === true) throw this.deny();
      if (op.data.deleted !== true && String(op.data.updatedAt) < String(existing.updatedAt)) throw this.deny();
    }
    return super.commit(ops);
  }
  private deny(): Error {
    this.rejected++;
    return new Error('PERMISSION_DENIED: Missing or insufficient permissions.');
  }
}

function device(cloud: FakeCloudStore, options: { storage?: MemoryStorage; cloudSync?: boolean } = {}) {
  const storage = options.storage ?? new MemoryStorage();
  const repo = new HybridCloudStudyRepository({ storage, studySessionCloudSync: options.cloudSync ?? true });
  repo.attachCloudStore(cloud);
  return { repo, storage };
}

const sessionDocs = (cloud: FakeCloudStore, uid: string) =>
  [...cloud.docs.entries()].filter(([p]) => p.startsWith(`users/${uid}/studySessions/`)).map(([, d]) => d);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeDoc(id: string): StudyDocument {
  return {
    id,
    title: `${id}.pdf`,
    sourceType: 'pdf',
    pageCount: 1,
    pages: [{ pageNumber: 1, title: 'P1', content: 'x' }],
    topics: [],
    overview: 'o',
    createdAt: '2026-10-01T00:00:00.000Z',
    lastStudiedAt: '2026-10-05T00:00:00.000Z',
  };
}

test('guest and account sessions are isolated; guest sessions are never uploaded to an account', async () => {
  const cloud = new RulesFakeCloudStore();
  const { repo, storage } = device(cloud);
  repo.activateAccount(null);
  const guest = repo.createStudySession({ name: 'Guest kinematics', chapterId: 'physics.kinematics' });
  assert.equal(repo.getStudySessionSyncState(guest.id), 'device_only');

  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.deepEqual(repo.getStudySessions(), [], 'alice does not see guest sessions');
  const alice = repo.createStudySession({ name: 'Alice optics' });
  await repo.flushPendingWrites();
  assert.deepEqual(sessionDocs(cloud, 'alice').map((d) => d.id), [alice.id]);

  await repo.syncWithCloudUser(fakeUser('bob'));
  assert.deepEqual(repo.getStudySessions(), [], 'bob does not see alice sessions');
  assert.deepEqual(sessionDocs(cloud, 'bob'), []);

  repo.activateAccount(null);
  assert.deepEqual(repo.getStudySessions().map((s) => s.id), [guest.id]);
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.deepEqual(repo.getStudySessions().map((s) => s.id), [alice.id]);

  assert.ok(storage.getItem(scopedKey('guest', STORAGE_KEYS.STUDY_SESSIONS))?.includes(guest.id));
  assert.ok(!storage.getItem(scopedKey('guest', STORAGE_KEYS.STUDY_SESSIONS))?.includes(alice.id));
  assert.equal(storage.getItem(STORAGE_KEYS.STUDY_SESSIONS), null, 'sessions are never stored unscoped');
  assert.ok([...cloud.docs.keys()].every((p) => !p.includes(guest.id)));
});

test('with session cloud sync disabled (launch default) sessions stay on the device and say so', async () => {
  const cloud = new FakeCloudStore();
  const { repo } = device(cloud, { cloudSync: false });
  await repo.syncWithCloudUser(fakeUser('alice'));
  const session = repo.createStudySession({ name: 'Device only' });
  await repo.flushPendingWrites();
  assert.equal(repo.isStudySessionCloudSyncEnabled(), false);
  assert.equal(repo.getStudySessionSyncState(session.id), 'device_only');
  assert.equal(repo.getDeviceOnlyDataSummary().studySessions, 1);
  assert.equal(repo.getUnsyncedChangeCount(), 0, 'not reported as a pending upload');
  assert.deepEqual(sessionDocs(cloud, 'alice'), []);
  assert.equal(new HybridCloudStudyRepository({ storage: new MemoryStorage() }).isStudySessionCloudSyncEnabled(), false, 'launch flag is off');
});

test('sessions survive a reload and unsynced changes are retried after it', async () => {
  const cloud = new RulesFakeCloudStore();
  const storage = new MemoryStorage();
  const first = device(cloud, { storage }).repo;
  await first.syncWithCloudUser(fakeUser('alice'));
  cloud.failCommits = 'UNAVAILABLE: offline';
  const s = first.createStudySession({ name: 'Reload me', chapterId: 'physics.kinematics' });
  first.updateStudySession(s.id, { name: 'Reload me (edited)' });
  await first.flushPendingWrites();
  assert.equal(first.getStudySessionSyncState(s.id), 'pending');

  cloud.failCommits = false;
  const reloaded = device(cloud, { storage }).repo;
  reloaded.activateAccount(fakeUser('alice'));
  assert.equal(reloaded.getStudySession(s.id)?.name, 'Reload me (edited)', 'restored from this device before any network');
  assert.ok(reloaded.getUnsyncedChangeCount() > 0, 'the pending change survived the reload');
  await reloaded.syncWithCloudUser(fakeUser('alice'));
  await reloaded.flushPendingWrites();
  assert.equal(cloud.docs.get(cloudPaths.studySession('alice', s.id))?.name, 'Reload me (edited)');
  assert.equal(reloaded.getStudySessionSyncState(s.id), 'synced');
  assert.equal(reloaded.getUnsyncedChangeCount(), 0);
});

test('offline creation and editing work; failures are reported honestly and retried', async () => {
  const cloud = new RulesFakeCloudStore();
  const { repo } = device(cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  cloud.failCommits = 'UNAVAILABLE: network down';
  const s = repo.createStudySession({ name: 'Offline', subjectId: 'chemistry' });
  repo.updateStudySession(s.id, { topicIds: [], name: 'Offline v2' });
  await repo.flushPendingWrites();
  const snap = repo.getSyncSnapshot();
  assert.equal(snap.state, 'unsynced');
  assert.equal(snap.unsyncedChanges, 1);
  assert.match(String(snap.lastError), /Study session sync failed/);
  assert.equal(repo.getStudySessionSyncState(s.id), 'pending');
  assert.equal(repo.getStudySession(s.id)?.name, 'Offline v2');

  cloud.failCommits = false;
  await repo.syncWithCloudUser(fakeUser('alice'));
  await repo.flushPendingWrites();
  assert.equal(cloud.docs.get(cloudPaths.studySession('alice', s.id))?.name, 'Offline v2');
  assert.equal(repo.getSyncSnapshot().state, 'synced');
  assert.equal(repo.getStudySessionSyncState(s.id), 'synced');
});

test('switching accounts mid-write never sends the previous account’s session to the new account', async () => {
  const cloud = new RulesFakeCloudStore();
  const { repo } = device(cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  const gate = deferred();
  cloud.gate = gate.promise;
  const s = repo.createStudySession({ name: 'Alice only' });
  repo.activateAccount(fakeUser('bob'));
  gate.resolve();
  cloud.gate = null;
  await repo.flushPendingWrites();
  await repo.syncWithCloudUser(fakeUser('bob'));
  await repo.flushPendingWrites();
  assert.deepEqual(sessionDocs(cloud, 'bob'), []);
  assert.deepEqual(repo.getStudySessions(), []);

  await repo.syncWithCloudUser(fakeUser('alice'));
  await repo.flushPendingWrites();
  assert.deepEqual(sessionDocs(cloud, 'alice').map((d) => d.id), [s.id], 'alice’s pending session is uploaded on her next sync');
});

test('concurrent edits on two devices converge on the newest version; older writes cannot overwrite it', async () => {
  const cloud = new RulesFakeCloudStore();
  const d1 = device(cloud).repo;
  const d2 = device(cloud).repo;
  await d1.syncWithCloudUser(fakeUser('alice'));
  const s = d1.createStudySession({ name: 'Shared' });
  await d1.flushPendingWrites();
  await d2.syncWithCloudUser(fakeUser('alice'));
  assert.equal(d2.getStudySession(s.id)?.name, 'Shared');

  cloud.failCommits = 'UNAVAILABLE';
  d1.updateStudySession(s.id, { name: 'Edited on device 1' });
  await wait(5);
  d2.updateStudySession(s.id, { name: 'Edited later on device 2' });
  await d1.flushPendingWrites();
  await d2.flushPendingWrites();
  cloud.failCommits = false;

  await d2.syncWithCloudUser(fakeUser('alice'));
  await d2.flushPendingWrites();
  await d1.syncWithCloudUser(fakeUser('alice'));
  await d1.flushPendingWrites();
  const final = cloud.docs.get(cloudPaths.studySession('alice', s.id));
  assert.equal(final?.name, 'Edited later on device 2');
  assert.equal(d1.getStudySession(s.id)?.name, 'Edited later on device 2', 'device 1 adopts the newer copy');
  assert.equal(d1.getUnsyncedChangeCount(), 0);
  assert.equal(d1.getSyncSnapshot().lastError, null);

  // Rapid successive edits on one device: the last edit is what the cloud keeps.
  for (let i = 1; i <= 5; i++) d1.updateStudySession(s.id, { name: `Rapid ${i}` });
  await d1.flushPendingWrites();
  assert.equal(cloud.docs.get(cloudPaths.studySession('alice', s.id))?.name, 'Rapid 5');

  // An older write racing a newer one is refused by the rules and resolved by adopting the cloud copy.
  const stale = d2.getStudySession(s.id)!;
  cloud.docs.set(cloudPaths.studySession('alice', s.id), encodeStudySessionDoc('alice', { ...stale, name: 'Newest elsewhere', updatedAt: '2099-01-01T00:00:00.000Z' }));
  const rejectedBefore = cloud.rejected;
  d1.updateStudySession(s.id, { name: 'Older than cloud' });
  await d1.flushPendingWrites();
  assert.equal(d1.getStudySession(s.id)?.name, 'Newest elsewhere');
  assert.ok(cloud.rejected >= rejectedBefore);
  assert.equal(d1.getUnsyncedChangeCount(), 0);
});

test('equal timestamps resolve deterministically on every device', () => {
  const base: StudySession = { id: 'sess-x', name: 'A', topicIds: [], resourceIds: [], createdAt: '2026-11-01T00:00:00.000Z', lastActiveAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z', schemaVersion: 1 };
  const other = { ...base, name: 'B' };
  assert.equal(Math.sign(compareStudySessions(base, other)), -Math.sign(compareStudySessions(other, base)));
  assert.notEqual(compareStudySessions(base, other), 0);
  assert.equal(compareStudySessions(base, { ...base }), 0);
  assert.equal(resolveStudySession(base, undefined, { kind: 'live', session: other }), compareStudySessions(base, other) > 0 ? 'push_local' : 'adopt_remote');
});

test('deletion is final: an offline edit or an older copy never resurrects a deleted session', async () => {
  const cloud = new RulesFakeCloudStore();
  const d1 = device(cloud).repo;
  const d2Storage = new MemoryStorage();
  const d2 = device(cloud, { storage: d2Storage }).repo;
  await d1.syncWithCloudUser(fakeUser('alice'));
  const s = d1.createStudySession({ name: 'To delete' });
  await d1.flushPendingWrites();
  await d2.syncWithCloudUser(fakeUser('alice'));
  const staleSnapshot = new Map<string, string>();
  for (let i = 0; i < d2Storage.length; i++) staleSnapshot.set(d2Storage.key(i)!, d2Storage.getItem(d2Storage.key(i)!)!);

  // Device 1 deletes; device 2 (offline) edits the session afterwards, with a newer timestamp.
  assert.equal(d1.deleteStudySession(s.id), true);
  await d1.flushPendingWrites();
  assert.equal(cloud.docs.get(cloudPaths.studySession('alice', s.id))?.deleted, true);
  await wait(5);
  cloud.failCommits = 'UNAVAILABLE';
  const edited = d2.updateStudySession(s.id, { name: 'Edited offline after the delete' })!;
  await d2.flushPendingWrites();
  cloud.failCommits = false;
  assert.ok(edited.updatedAt > String(cloud.docs.get(cloudPaths.studySession('alice', s.id))?.deletedAt));
  assert.equal(d2.getStudySessionSyncState(s.id), 'pending');

  await d2.syncWithCloudUser(fakeUser('alice'));
  await d2.flushPendingWrites();
  assert.equal(d2.getStudySession(s.id), null, 'the offline edit does not win over the deletion');
  assert.ok(d2.getDeletedStudySessionIds().includes(s.id));
  assert.equal(cloud.docs.get(cloudPaths.studySession('alice', s.id))?.deleted, true);

  // A device restored from an old backup still holding the session cannot bring it back.
  const d3Storage = new MemoryStorage();
  for (const [k, v] of staleSnapshot) d3Storage.setItem(k, v);
  const d3 = device(cloud, { storage: d3Storage }).repo;
  await d3.syncWithCloudUser(fakeUser('alice'));
  await d3.flushPendingWrites();
  assert.equal(d3.getStudySession(s.id), null);
  assert.equal(cloud.docs.get(cloudPaths.studySession('alice', s.id))?.deleted, true);

  // Deleting while offline: the tombstone is pushed later and beats the live cloud copy.
  const t = d1.createStudySession({ name: 'Delete offline' });
  await d1.flushPendingWrites();
  cloud.failCommits = 'UNAVAILABLE';
  d1.deleteStudySession(t.id);
  await d1.flushPendingWrites();
  assert.equal(cloud.docs.get(cloudPaths.studySession('alice', t.id))?.deleted, false);
  cloud.failCommits = false;
  await d1.syncWithCloudUser(fakeUser('alice'));
  await d1.flushPendingWrites();
  assert.equal(cloud.docs.get(cloudPaths.studySession('alice', t.id))?.deleted, true);
  assert.equal(d1.getUnsyncedChangeCount(), 0);
});

test('migration inserts are idempotent and never re-create deleted or duplicate sessions', async () => {
  const cloud = new RulesFakeCloudStore();
  const d1 = device(cloud).repo;
  const d2 = device(cloud).repo;
  await d1.syncWithCloudUser(fakeUser('alice'));
  await d2.syncWithCloudUser(fakeUser('alice'));
  const docs = [makeDoc('doc-a'), makeDoc('doc-b')];

  const plan1 = planDocumentSessionMigration(docs, d1.getStudySessions(), d1.getDeletedStudySessionIds());
  assert.deepEqual(d1.insertStudySessions(plan1.toCreate).inserted.sort(), ['sess-doc-doc-a', 'sess-doc-doc-b']);
  assert.deepEqual(d1.insertStudySessions(plan1.toCreate).skipped.map((s) => s.reason), ['already exists', 'already exists']);
  assert.equal(planDocumentSessionMigration(docs, d1.getStudySessions(), d1.getDeletedStudySessionIds()).toCreate.length, 0);

  // A second device migrates the same documents before syncing: identical ids, no duplicates.
  d2.insertStudySessions(planDocumentSessionMigration(docs, d2.getStudySessions(), d2.getDeletedStudySessionIds()).toCreate);
  await d1.flushPendingWrites();
  await d2.flushPendingWrites();
  await d1.syncWithCloudUser(fakeUser('alice'));
  await d2.syncWithCloudUser(fakeUser('alice'));
  assert.equal(sessionDocs(cloud, 'alice').length, 2);
  assert.equal(d1.getStudySessions().length, 2);

  // The student deletes a migrated session: migration never brings it back.
  d1.deleteStudySession('sess-doc-doc-a');
  await d1.flushPendingWrites();
  const again = planDocumentSessionMigration(docs, d1.getStudySessions(), d1.getDeletedStudySessionIds());
  assert.equal(again.toCreate.length, 0);
  assert.deepEqual(d1.insertStudySessions(planDocumentSessionMigration(docs, [], []).toCreate).skipped.find((s) => s.id === 'sess-doc-doc-a')?.reason, 'deleted by the student');
  await d2.syncWithCloudUser(fakeUser('alice'));
  assert.equal(d2.getStudySession('sess-doc-doc-a'), null);
  assert.equal(planDocumentSessionMigration(docs, d2.getStudySessions(), d2.getDeletedStudySessionIds()).toCreate.length, 0);
});

test('documents, attempts and focus-timer sessions are untouched by study sessions', async () => {
  const cloud = new FakeCloudStore();
  const { repo, storage } = device(cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  repo.saveDocument(makeDoc('doc-a'));
  repo.saveFocusSession({ id: 'focus-1', documentId: 'doc-a', startedAt: '2026-11-03T10:00:00.000Z', durationMinutes: 25 } as never);
  await repo.flushPendingWrites();
  const before = new Map<string, string>();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)!;
    if (/documents|attempts|focus_sessions/.test(key)) before.set(key, storage.getItem(key)!);
  }
  const cloudBefore = JSON.stringify([...cloud.docs.entries()].filter(([p]) => !p.includes('/studySessions/')));
  const s = repo.createStudySession({ name: 'Doc session', resourceIds: ['doc-a'] });
  repo.updateStudySession(s.id, { name: 'Renamed' });
  repo.deleteStudySession(s.id);
  await repo.flushPendingWrites();
  for (const [key, value] of before) assert.equal(storage.getItem(key), value, key);
  assert.equal(JSON.stringify([...cloud.docs.entries()].filter(([p]) => !p.includes('/studySessions/'))), cloudBefore);
  assert.equal(repo.getFocusSessions().length, 1);
  assert.notEqual(STORAGE_KEYS.STUDY_SESSIONS, STORAGE_KEYS.FOCUS_SESSIONS);
});

test('invalid sessions are refused locally and invalid cloud documents are ignored', async () => {
  const cloud = new FakeCloudStore();
  const { repo } = device(cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.throws(() => repo.createStudySession({ name: '   ' }), StudySessionError);
  assert.throws(() => repo.createStudySession({ name: 'x', chapterId: 'not-a-chapter' }), StudySessionError);
  assert.throws(() => repo.createStudySession({ name: 'x', resourceIds: Array.from({ length: 101 }, (_, i) => `d${i}`) }), StudySessionError);
  const s = repo.createStudySession({ name: 'Valid' });
  assert.throws(() => repo.updateStudySession(s.id, { chapterId: 'chemistry.nope' }), StudySessionError);
  assert.equal(repo.getStudySession(s.id)?.chapterId, undefined, 'a refused update changes nothing');

  const good = encodeStudySessionDoc('alice', s);
  assert.equal(decodeStudySessionDoc(s.id, good)?.kind, 'live');
  assert.equal(decodeStudySessionDoc('other-id', good), null);
  assert.equal(decodeStudySessionDoc(s.id, { ...good, extra: 'x' }), null);
  assert.equal(decodeStudySessionDoc(s.id, { ...good, updatedAt: 'yesterday' }), null);
  assert.equal(decodeStudySessionDoc(s.id, { ...good, deleted: true }), null, 'a tombstone needs deletedAt');

  cloud.docs.set(cloudPaths.studySession('alice', 'sess-broken'), { id: 'sess-broken', schemaVersion: 1, deleted: false, name: '' });
  await repo.syncWithCloudUser(fakeUser('alice'));
  assert.equal(repo.getStudySession('sess-broken'), null);
  assert.match(String(repo.getSyncSnapshot().lastError), /could not be read/);
});
