import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearScope,
  collectUsedDocumentIds,
  isPrivateRawKey,
  LEGACY_MIGRATION_MARKER,
  listScopeRawKeys,
  listUserScopes,
  migrateLegacyKeysToGuest,
  scopedKey,
  scopeForUid,
  STORAGE_KEYS,
} from './localScope';
import { legacyMigrationTransform } from './storageService';
import { removeForeignFirebaseAuthEntries } from './authStorageHygiene';
import { MemoryStorage } from './testDoubles';

test('private keys are scoped per account; device preferences are not', () => {
  assert.equal(scopedKey('guest', STORAGE_KEYS.DOCUMENTS), 'lm:guest:learnmate_documents_v1');
  assert.equal(scopedKey(scopeForUid('abc123'), `${STORAGE_KEYS.TUTOR_PREFIX}doc-1`), 'lm:u_abc123:learnmate_tutor_v1_doc-1');
  assert.equal(scopedKey(scopeForUid('abc123'), STORAGE_KEYS.THEME), STORAGE_KEYS.THEME);
  assert.equal(isPrivateRawKey(STORAGE_KEYS.STUDENT_PROFILE), true);
  assert.equal(isPrivateRawKey(STORAGE_KEYS.ACCESSIBILITY), false);
  assert.equal(scopeForUid(null), 'guest');
  assert.throws(() => scopeForUid('bad/uid'));
});

test('clearScope removes only the targeted account', () => {
  const storage = new MemoryStorage();
  storage.setItem(scopedKey('u_alice', STORAGE_KEYS.DOCUMENTS), '[]');
  storage.setItem(scopedKey('u_alice', `${STORAGE_KEYS.TUTOR_PREFIX}d`), '[]');
  storage.setItem(scopedKey('u_bob', STORAGE_KEYS.DOCUMENTS), '[]');
  storage.setItem(scopedKey('guest', STORAGE_KEYS.DOCUMENTS), '[]');
  storage.setItem(STORAGE_KEYS.THEME, 'dark');
  assert.deepEqual(listUserScopes(storage).sort(), ['u_alice', 'u_bob']);
  assert.equal(clearScope(storage, 'u_alice'), 2);
  assert.deepEqual(listScopeRawKeys(storage, 'u_alice'), []);
  assert.equal(listScopeRawKeys(storage, 'u_bob').length, 1);
  assert.equal(listScopeRawKeys(storage, 'guest').length, 1);
  assert.equal(storage.getItem(STORAGE_KEYS.THEME), 'dark');
});

test('legacy migration moves old global data into the guest scope once and drops untouched demo content', () => {
  const storage = new MemoryStorage();
  const userDoc = { id: 'doc-user-1', title: 'My notes' };
  storage.setItem(
    STORAGE_KEYS.DOCUMENTS,
    JSON.stringify([
      { id: 'doc-probability-notes', title: 'Probability Notes.pdf' },
      { id: 'doc-sets-relations', title: 'Sets and Relations' },
      userDoc,
    ])
  );
  // The student actually used one seeded document: it must be kept.
  storage.setItem(`${STORAGE_KEYS.TUTOR_PREFIX}doc-sets-relations`, '[{"id":"m1"}]');
  storage.setItem(
    STORAGE_KEYS.NOTIFICATIONS,
    JSON.stringify([{ id: 'notif-starter-1' }, { id: 'notif-123', title: 'Focus session done' }])
  );
  storage.setItem(STORAGE_KEYS.STUDY_PLANNER, JSON.stringify([{ id: 'plan-task-1' }, { id: 'plan-17' }]));
  storage.setItem(STORAGE_KEYS.SEEDED, 'true');
  storage.setItem(STORAGE_KEYS.ACTIVE_DOC_ID, 'doc-probability-notes');
  storage.setItem(STORAGE_KEYS.THEME, 'dark');

  const result = migrateLegacyKeysToGuest(storage, legacyMigrationTransform);
  assert.equal(result.status, 'migrated');

  const guestDocs = JSON.parse(storage.getItem(scopedKey('guest', STORAGE_KEYS.DOCUMENTS)) || '[]');
  assert.deepEqual(guestDocs.map((d: { id: string }) => d.id), ['doc-sets-relations', 'doc-user-1']);
  const notifs = JSON.parse(storage.getItem(scopedKey('guest', STORAGE_KEYS.NOTIFICATIONS)) || '[]');
  assert.deepEqual(notifs.map((n: { id: string }) => n.id), ['notif-123']);
  const planner = JSON.parse(storage.getItem(scopedKey('guest', STORAGE_KEYS.STUDY_PLANNER)) || '[]');
  assert.deepEqual(planner.map((t: { id: string }) => t.id), ['plan-17']);
  assert.equal(storage.getItem(scopedKey('guest', STORAGE_KEYS.ACTIVE_DOC_ID)), null);
  assert.equal(storage.getItem(scopedKey('guest', STORAGE_KEYS.SEEDED)), null);

  // Originals removed, device preference untouched, nothing attributed to any account.
  assert.equal(storage.getItem(STORAGE_KEYS.DOCUMENTS), null);
  assert.equal(storage.getItem(STORAGE_KEYS.THEME), 'dark');
  assert.deepEqual(listUserScopes(storage), []);

  // Idempotent.
  assert.equal(migrateLegacyKeysToGuest(storage, legacyMigrationTransform).status, 'already_done');
  assert.ok(storage.getItem(LEGACY_MIGRATION_MARKER));
});

test('legacy migration rolls back and keeps originals if the device runs out of space', () => {
  const big = 'x'.repeat(400);
  const storage = new MemoryStorage(1500);
  storage.setItem(STORAGE_KEYS.DOCUMENTS, big);
  storage.setItem(STORAGE_KEYS.ATTEMPTS, big);
  const result = migrateLegacyKeysToGuest(storage);
  assert.equal(result.status, 'failed');
  assert.equal(storage.getItem(STORAGE_KEYS.DOCUMENTS), big);
  assert.equal(storage.getItem(STORAGE_KEYS.ATTEMPTS), big);
  assert.deepEqual(listScopeRawKeys(storage, 'guest'), []);
  assert.equal(storage.getItem(LEGACY_MIGRATION_MARKER), null, 'migration must be retried later');
});

test('collectUsedDocumentIds finds documents with any recorded study activity', () => {
  const used = collectUsedDocumentIds(
    new Map([
      [`${STORAGE_KEYS.QUIZ_CACHE_PREFIX}doc-a_diagnostic`, '[]'],
      [`${STORAGE_KEYS.PDF_ANNOTATIONS_PREFIX}doc-b`, '[]'],
      [STORAGE_KEYS.ATTEMPTS, JSON.stringify([{ documentId: 'doc-c' }])],
    ])
  );
  assert.deepEqual([...used].sort(), ['doc-a', 'doc-b', 'doc-c']);
});

test('Firebase auth hygiene removes only sessions from other API keys', () => {
  const storage = new MemoryStorage();
  storage.setItem('firebase:authUser:CURRENT:[DEFAULT]', '{}');
  storage.setItem('firebase:authUser:OLDKEY:[DEFAULT]', '{}');
  storage.setItem('firebase:persistence:OLDKEY:[DEFAULT]', 'local');
  storage.setItem('learnmate_theme_v1', 'dark');
  assert.equal(removeForeignFirebaseAuthEntries(storage, 'CURRENT'), 2);
  assert.ok(storage.getItem('firebase:authUser:CURRENT:[DEFAULT]'));
  assert.equal(storage.getItem('firebase:authUser:OLDKEY:[DEFAULT]'), null);
  assert.equal(storage.getItem('learnmate_theme_v1'), 'dark');
});
