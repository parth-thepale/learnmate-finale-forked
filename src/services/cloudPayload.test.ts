import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeChunkedPayload,
  encodePayload,
  parseJsonOrThrow,
  payloadChecksum,
  PayloadIntegrityError,
  PayloadTooLargeError,
  splitIntoByteChunks,
  utf8ByteLength,
} from './cloudPayload';
import { encodeStudyDocument } from './cloudEntities';
import type { StudyDocument } from '../types/study';

test('byte-chunking never splits multi-byte characters or surrogate pairs', () => {
  const text = 'aé∑😀'.repeat(5000) + 'तनाव ∫x dx = x²/2 + C';
  for (const maxBytes of [4, 7, 64, 1000]) {
    const chunks = splitIntoByteChunks(text, maxBytes);
    assert.equal(chunks.join(''), text);
    for (const chunk of chunks) {
      assert.ok(utf8ByteLength(chunk) <= maxBytes);
      assert.ok(!/[\uD800-\uDBFF]$/.test(chunk), 'chunk must not end with a lone high surrogate');
    }
  }
  assert.deepEqual(splitIntoByteChunks(''), ['']);
});

test('small payloads stay inline; large payloads are chunked and round-trip exactly', () => {
  const small = encodePayload({ a: 1 });
  assert.ok(small.inline);
  assert.equal(small.chunks, undefined);

  const big = { pages: Array.from({ length: 30 }, (_, i) => ({ n: i, text: `∑ step ${i} `.repeat(4000) })) };
  const encoded = encodePayload(big, { chunkMaxBytes: 300_000 });
  assert.ok(encoded.chunks && encoded.chunks.length > 1);
  const decoded = decodeChunkedPayload<typeof big>(
    encoded.chunks.map((data, index) => ({ index, data })).reverse(),
    { chunkCount: encoded.chunks.length, checksum: encoded.checksum, byteLength: encoded.byteLength }
  );
  assert.deepEqual(decoded, big);
});

test('missing, altered or truncated payloads are rejected instead of silently accepted', () => {
  const encoded = encodePayload({ text: 'x'.repeat(50_000) }, { inlineMaxBytes: 0, chunkMaxBytes: 10_000 });
  const chunks = (encoded.chunks || []).map((data, index) => ({ index, data }));
  const expected = { chunkCount: chunks.length, checksum: encoded.checksum, byteLength: encoded.byteLength };

  assert.throws(() => decodeChunkedPayload(chunks.slice(1), expected), PayloadIntegrityError);
  const altered = chunks.map((c, i) => (i === 0 ? { ...c, data: c.data.replace('x', 'y') } : c));
  assert.throws(() => decodeChunkedPayload(altered, expected), PayloadIntegrityError);
  assert.throws(() => parseJsonOrThrow('{"pages":[{"content":"abc'), PayloadIntegrityError);
  assert.notEqual(payloadChecksum('abc'), payloadChecksum('abd'));
});

test('payloads beyond the sync ceiling raise PayloadTooLargeError', () => {
  assert.throws(() => encodePayload({ blob: 'z'.repeat(8_100_000) }), PayloadTooLargeError);
});

test('study document encoding: inline legacy fields when small, chunked when large, never truncated', () => {
  const base: StudyDocument = {
    id: 'doc-1',
    title: 'Rotational Dynamics',
    sourceType: 'pdf',
    pageCount: 2,
    pages: [
      { pageNumber: 1, title: 'Torque', content: 'τ = r × F' },
      { pageNumber: 2, title: 'Angular momentum', content: 'L = Iω' },
    ],
    topics: [],
    overview: 'Rotation basics',
    createdAt: '2026-11-01T00:00:00.000Z',
    lastStudiedAt: '2026-11-02T00:00:00.000Z',
  };
  const inlineOps = encodeStudyDocument('alice', base);
  assert.equal(inlineOps.length, 1);
  const parent = inlineOps[0];
  assert.equal(parent.type, 'set');
  if (parent.type === 'set') {
    assert.equal(parent.data.pagesJson, JSON.stringify(base.pages));
    assert.equal(parent.data.payloadEncoding, 'inline');
  }

  const large: StudyDocument = {
    ...base,
    pages: Array.from({ length: 20 }, (_, i) => ({ pageNumber: i + 1, title: `p${i}`, content: 'F = ma. '.repeat(9000) })),
  };
  const ops = encodeStudyDocument('alice', large, 5);
  const chunkSets = ops.filter((op) => op.type === 'set' && op.path.includes('/chunks/'));
  const parentSet = ops.find((op) => op.type === 'set' && op.path === 'users/alice/documents/doc-1');
  const staleDeletes = ops.filter((op) => op.type === 'delete');
  assert.ok(chunkSets.length >= 2);
  assert.ok(parentSet && parentSet.type === 'set' && parentSet.data.payloadEncoding === 'chunked');
  assert.equal(staleDeletes.length, 5 - chunkSets.length);
  for (const op of ops) {
    if (op.type === 'set') assert.ok(utf8ByteLength(JSON.stringify(op.data)) < 1_048_576);
  }
});
