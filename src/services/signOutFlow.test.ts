import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudPaths } from './cloudStore';
import { listScopeRawKeys, STORAGE_KEYS } from './localScope';
import { performSignOut, prepareSignOutSummary } from './signOutFlow';
import { HybridCloudStudyRepository } from './storageService';
import { deferred, FakeCloudStore, fakeUser, MemoryStorage } from './testDoubles';
import type { StudyDocument } from '../types/study';

function makeDoc(id: string): StudyDocument {
  return {
    id,
    title: `${id}.pdf`,
    sourceType: 'pdf',
    pageCount: 1,
    pages: [{ pageNumber: 1, title: 'P1', content: `content ${id}` }],
    topics: [],
    overview: 'o',
    createdAt: '2026-10-01T00:00:00.000Z',
    lastStudiedAt: '2026-10-05T00:00:00.000Z',
  };
}

function setup(options: { cloudSync?: boolean } = {}) {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage, studySessionCloudSync: options.cloudSync ?? false });
  repo.attachCloudStore(cloud);
  let signOutCalls = 0;
  let failSignOut: string | null = null;
  /** Like Firebase: resolves, then the auth listener switches the app to the guest scope. */
  const signOut = async () => {
    signOutCalls++;
    if (failSignOut) throw new Error(failSignOut);
    await Promise.resolve();
    repo.activateAccount(null);
  };
  return {
    storage,
    cloud,
    repo,
    signOut,
    calls: () => signOutCalls,
    failNextSignOut: (message: string | null) => {
      failSignOut = message;
    },
  };
}

/** Alice with device-only sessions (one live, one deleted → tombstone), a notebook entry and a document. */
async function aliceWithLocalData(env: ReturnType<typeof setup>) {
  await env.repo.syncWithCloudUser(fakeUser('alice'));
  env.repo.saveDocument(makeDoc('alice-doc'));
  const kept = env.repo.createStudySession({ name: 'Alice kinematics', chapterId: 'physics.kinematics' });
  const deleted = env.repo.createStudySession({ name: 'Alice scratch' });
  env.repo.deleteStudySession(deleted.id);
  env.repo.saveNotebookEntry({ id: 'nb-1', title: 'Formula sheet', content: 'v = u + at', createdAt: '2026-11-01T00:00:00.000Z' } as never);
  await env.repo.flushPendingWrites();
  return { kept, deleted };
}

test('summary reports unsynced changes and device-only data before the choice', async () => {
  const env = setup();
  await aliceWithLocalData(env);
  const summary = await prepareSignOutSummary(env.repo, fakeUser('alice'));
  assert.equal(summary.uid, 'alice');
  assert.equal(summary.deviceOnly.studySessions, 1);
  assert.equal(summary.deviceOnly.notebookEntries, 1);
  assert.equal(summary.deviceOnlyTotal, 2);
  assert.equal(summary.unsyncedChanges, 0);
});

test('Keep signs out and retains sessions together with their tombstones; guests cannot see them', async () => {
  const env = setup();
  const { kept, deleted } = await aliceWithLocalData(env);
  const result = await performSignOut({ choice: 'keep', uid: 'alice', storage: env.repo, signOut: env.signOut });
  assert.deepEqual(result, { status: 'signed_out', kept: true });
  assert.equal(env.calls(), 1);
  assert.equal(env.repo.getActiveScope(), 'guest');

  const aliceKeys = listScopeRawKeys(env.storage, 'u_alice');
  assert.ok(aliceKeys.includes(STORAGE_KEYS.STUDY_SESSIONS));
  assert.ok(aliceKeys.includes(STORAGE_KEYS.STUDY_SESSION_TOMBSTONES));
  assert.ok(aliceKeys.includes(STORAGE_KEYS.NOTEBOOK));

  // Guest mode sees none of it.
  assert.deepEqual(env.repo.getStudySessions(), []);
  assert.deepEqual(env.repo.getDeletedStudySessionIds(), []);
  assert.deepEqual(env.repo.getDocuments(), []);
  assert.deepEqual(env.repo.getNotebookEntries(), []);

  // The same account gets everything back, deletion records included.
  await env.repo.syncWithCloudUser(fakeUser('alice'));
  assert.deepEqual(env.repo.getStudySessions().map((s) => s.id), [kept.id]);
  assert.deepEqual(env.repo.getDeletedStudySessionIds(), [deleted.id]);
  assert.equal(env.repo.getNotebookEntries().length, 1);
  assert.ok(env.repo.getDocumentById('alice-doc'));
});

test('retained unsynced changes are uploaded when the same account returns', async () => {
  const env = setup({ cloudSync: true });
  await env.repo.syncWithCloudUser(fakeUser('alice'));
  env.cloud.failCommits = 'UNAVAILABLE';
  const s = env.repo.createStudySession({ name: 'Made offline' });
  await env.repo.flushPendingWrites();
  const summary = await prepareSignOutSummary(env.repo, fakeUser('alice'));
  assert.equal(summary.unsyncedChanges, 1);
  await performSignOut({ choice: 'keep', uid: 'alice', storage: env.repo, signOut: env.signOut });

  env.cloud.failCommits = false;
  await env.repo.syncWithCloudUser(fakeUser('alice'));
  await env.repo.flushPendingWrites();
  assert.equal(env.cloud.docs.get(cloudPaths.studySession('alice', s.id))?.name, 'Made offline');
  assert.equal(env.repo.getUnsyncedChangeCount(), 0);
});

test('another account never sees data retained for a different account', async () => {
  const env = setup();
  await aliceWithLocalData(env);
  await performSignOut({ choice: 'keep', uid: 'alice', storage: env.repo, signOut: env.signOut });
  await env.repo.syncWithCloudUser(fakeUser('bob'));
  assert.deepEqual(env.repo.getStudySessions(), []);
  assert.deepEqual(env.repo.getDeletedStudySessionIds(), []);
  assert.deepEqual(env.repo.getDocuments(), []);
  assert.deepEqual(env.repo.getNotebookEntries(), []);
  await env.repo.flushPendingWrites();
  assert.ok(![...env.cloud.docs.keys()].some((p) => p.startsWith('users/bob/') && p.includes('alice')), 'nothing of alice is uploaded to bob');
  assert.ok(![...env.cloud.docs.keys()].some((p) => p.includes('/studySessions/')), 'device-only data is not uploaded by signing out');
});

test('Remove deletes only the signed-out account’s local data', async () => {
  const env = setup();
  env.storage.setItem(STORAGE_KEYS.THEME, '"dark"');
  // Guest data and another retained account on the same device.
  env.repo.activateAccount(null);
  const guestSession = env.repo.createStudySession({ name: 'Guest session' });
  await env.repo.syncWithCloudUser(fakeUser('bob'));
  const bobSession = env.repo.createStudySession({ name: 'Bob session' });
  await performSignOut({ choice: 'keep', uid: 'bob', storage: env.repo, signOut: env.signOut });
  // An account whose id shares alice's prefix.
  await env.repo.syncWithCloudUser(fakeUser('alice2'));
  const alice2Session = env.repo.createStudySession({ name: 'Alice2 session' });
  await performSignOut({ choice: 'keep', uid: 'alice2', storage: env.repo, signOut: env.signOut });

  await aliceWithLocalData(env);
  const bobBefore = listScopeRawKeys(env.storage, 'u_bob').length;
  const result = await performSignOut({ choice: 'remove', uid: 'alice', storage: env.repo, signOut: env.signOut });
  assert.equal(result.status, 'signed_out');
  assert.ok(result.status === 'signed_out' && !result.kept && result.removedEntries > 0);
  assert.deepEqual(listScopeRawKeys(env.storage, 'u_alice'), [], 'alice’s scope is empty, tombstones included');
  assert.equal(listScopeRawKeys(env.storage, 'u_bob').length, bobBefore);
  assert.equal(env.storage.getItem(STORAGE_KEYS.THEME), '"dark"', 'device preferences are kept');

  assert.deepEqual(env.repo.getStudySessions().map((s) => s.id), [guestSession.id], 'guest data is untouched');
  await env.repo.syncWithCloudUser(fakeUser('bob'));
  assert.deepEqual(env.repo.getStudySessions().map((s) => s.id), [bobSession.id]);
  await env.repo.syncWithCloudUser(fakeUser('alice2'));
  assert.deepEqual(env.repo.getStudySessions().map((s) => s.id), [alice2Session.id]);

  // Alice's synced cloud data is unaffected and comes back; device-only data does not.
  await env.repo.syncWithCloudUser(fakeUser('alice'));
  assert.ok(env.repo.getDocumentById('alice-doc'), 'cloud-synced documents return');
  assert.deepEqual(env.repo.getStudySessions(), []);
  assert.deepEqual(env.repo.getNotebookEntries(), []);
});

test('Cancel leaves the student signed in with everything intact', async () => {
  const env = setup();
  const { kept } = await aliceWithLocalData(env);
  const before = listScopeRawKeys(env.storage, 'u_alice').map((k) => [k, env.storage.getItem(`lm:u_alice:${k}`)]);
  const result = await performSignOut({ choice: 'cancel', uid: 'alice', storage: env.repo, signOut: env.signOut });
  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(env.calls(), 0);
  assert.equal(env.repo.getActiveScope(), 'u_alice');
  assert.equal(env.repo.getSyncSnapshot().state === 'local-only', false, 'still signed in');
  assert.deepEqual(env.repo.getStudySessions().map((s) => s.id), [kept.id]);
  assert.deepEqual(listScopeRawKeys(env.storage, 'u_alice').map((k) => [k, env.storage.getItem(`lm:u_alice:${k}`)]), before);
});

test('if signing out fails nothing is deleted and the student stays signed in', async () => {
  const env = setup();
  const { kept } = await aliceWithLocalData(env);
  env.failNextSignOut('network-request-failed');
  const result = await performSignOut({ choice: 'remove', uid: 'alice', storage: env.repo, signOut: env.signOut });
  assert.deepEqual(result, { status: 'failed', error: 'network-request-failed' });
  assert.equal(env.repo.getActiveScope(), 'u_alice');
  assert.deepEqual(env.repo.getStudySessions().map((s) => s.id), [kept.id]);
  assert.ok(listScopeRawKeys(env.storage, 'u_alice').length > 0);
});

test('implicit sign-outs (token expiry, another tab) never delete local data', async () => {
  const env = setup();
  const { kept, deleted } = await aliceWithLocalData(env);
  const keysBefore = listScopeRawKeys(env.storage, 'u_alice').sort();
  // What the auth listener does when Firebase reports no user without our sign-out flow.
  env.repo.activateAccount(null);
  assert.deepEqual(listScopeRawKeys(env.storage, 'u_alice').sort(), keysBefore);
  assert.deepEqual(env.repo.getStudySessions(), []);
  await env.repo.syncWithCloudUser(fakeUser('alice'));
  assert.deepEqual(env.repo.getStudySessions().map((s) => s.id), [kept.id]);
  assert.deepEqual(env.repo.getDeletedStudySessionIds(), [deleted.id]);
});

test('removal during an in-flight sync cannot write data back into the removed account', async () => {
  const env = setup();
  await aliceWithLocalData(env);
  const gate = deferred();
  env.cloud.gate = gate.promise;
  const syncing = env.repo.syncWithCloudUser(fakeUser('alice'));
  await performSignOut({ choice: 'remove', uid: 'alice', storage: env.repo, signOut: env.signOut });
  gate.resolve();
  env.cloud.gate = null;
  await syncing;
  await env.repo.flushPendingWrites();
  assert.deepEqual(listScopeRawKeys(env.storage, 'u_alice'), []);
});

test('account removal refuses the guest scope and malformed ids; the legacy clear still works', async () => {
  const env = setup();
  await aliceWithLocalData(env);
  assert.throws(() => env.repo.removeAccountDataFromDevice(''), /guest/);
  assert.throws(() => env.repo.removeAccountDataFromDevice('../alice'), /user id/);
  assert.ok(listScopeRawKeys(env.storage, 'u_alice').length > 0);

  // Removing the active account directly detaches it first.
  const removed = env.repo.removeAccountDataFromDevice('alice');
  assert.ok(removed > 0);
  assert.equal(env.repo.getActiveScope(), null);
  assert.deepEqual(listScopeRawKeys(env.storage, 'u_alice'), []);

  // clearCurrentAccountFromDevice (previous API) keeps its behaviour.
  await env.repo.syncWithCloudUser(fakeUser('carol'));
  env.repo.createStudySession({ name: 'Carol' });
  env.repo.clearCurrentAccountFromDevice();
  assert.deepEqual(listScopeRawKeys(env.storage, 'u_carol'), []);
});
