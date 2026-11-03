import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFirestoreValue, FirestoreDataError, toFirestoreData } from './firestoreData';
import { createSession } from './sessionModel';

test('undefined object fields are omitted recursively; null, Dates, arrays and falsy values are preserved', () => {
  const when = new Date('2026-11-03T10:00:00Z');
  const input = {
    id: 'x',
    optional: undefined,
    keepNull: null,
    zero: 0,
    empty: '',
    no: false,
    at: when,
    nested: { a: 1, b: undefined, deeper: { c: undefined, d: null } },
    list: [{ chapterId: undefined, topicIds: [], topicLabel: 'Kinematics' }, 'text', 3, null],
  };
  const snapshot = structuredClone(input);
  const out = toFirestoreData(input);
  assert.deepEqual(out, {
    id: 'x',
    keepNull: null,
    zero: 0,
    empty: '',
    no: false,
    at: when,
    nested: { a: 1, deeper: { d: null } },
    list: [{ topicIds: [], topicLabel: 'Kinematics' }, 'text', 3, null],
  });
  assert.ok(out.at instanceof Date);
  assert.ok(!('optional' in out) && !('b' in (out.nested as object)));
  assert.deepEqual(input, snapshot, 'the input is not mutated');
  assert.doesNotThrow(() => assertFirestoreValue(out));
  assert.throws(() => assertFirestoreValue(input), /undefined/, 'the raw object is exactly what Firestore rejects');
});

test('values that cannot be stored faithfully are refused, not altered', () => {
  assert.throws(() => toFirestoreData({ list: [1, undefined, 3] }), /list\[1\]/);
  assert.throws(() => toFirestoreData({ grid: [[1, 2]] }), /nested array/);
  assert.throws(() => toFirestoreData({ fn: () => 1 }), /function/);
  assert.throws(() => toFirestoreData({ big: BigInt(1) }), /bigint/);
  assert.throws(() => toFirestoreData({ m: new Map() }), /Map/);
  let deep: Record<string, unknown> = { leaf: 1 };
  for (let i = 0; i < 25; i++) deep = { deep };
  assert.throws(() => toFirestoreData(deep), /deeper/);
  assert.throws(() => toFirestoreData([] as unknown as Record<string, unknown>), /plain object/);
});

test('required fields are checked before anything is dropped', () => {
  assert.throws(() => toFirestoreData({ id: 'a', uid: undefined }, { required: ['id', 'uid'], label: 'set a' }), (err: Error) => {
    return err instanceof FirestoreDataError && err.message === 'set a: required field "uid" is missing.';
  });
  assert.throws(() => toFirestoreData({ id: 'a', uid: null }, { required: ['uid'] }), /uid/);
  assert.deepEqual(toFirestoreData({ id: 'a', uid: 'u', note: undefined }, { required: ['id', 'uid'] }), { id: 'a', uid: 'u' });
});

test('study sessions with unset optional fields become valid Firestore documents', () => {
  const session = createSession({ id: 'sess-1', name: 'Kinematics revision', now: new Date('2026-11-03T10:00:00Z') });
  assert.equal(session.subjectId, undefined);
  assert.equal(session.chapterId, undefined);
  assert.throws(() => assertFirestoreValue(session as unknown as Record<string, unknown>), /undefined/);
  const data = toFirestoreData(session as unknown as Record<string, unknown>, { required: ['id', 'name', 'topicIds', 'resourceIds', 'createdAt', 'lastActiveAt', 'updatedAt', 'schemaVersion'] });
  assert.deepEqual(Object.keys(data).sort(), ['createdAt', 'id', 'lastActiveAt', 'name', 'resourceIds', 'schemaVersion', 'topicIds', 'updatedAt']);
  assert.doesNotThrow(() => assertFirestoreValue(data));

  const withChapter = createSession({ id: 'sess-2', name: 'Units', chapterId: 'physics.units-measurements', topicIds: ['physics.units-measurements.units-si'] });
  const chapterData = toFirestoreData(withChapter as unknown as Record<string, unknown>);
  assert.equal(chapterData.subjectId, 'physics');
  assert.deepEqual(chapterData.topicIds, ['physics.units-measurements.units-si']);
});
