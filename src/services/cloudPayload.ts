/**
 * Size-safe encoding of large JSON payloads for Firestore.
 *
 * Firestore rejects documents over 1 MiB. Instead of truncating JSON (which corrupts it), a
 * payload is stored inline when it fits comfortably, otherwise split into ordered chunk
 * documents. A checksum and byte length let readers detect incomplete or mismatched chunks.
 */

export const FIRESTORE_DOCUMENT_LIMIT_BYTES = 1_048_576;
/** Inline payload budget, leaving headroom for field names and metadata in the same document. */
export const INLINE_PAYLOAD_MAX_BYTES = 850_000;
/** Size of each chunk document's data field. */
export const CHUNK_MAX_BYTES = 700_000;
/** Firestore batches are limited to 10 MiB per request; keep total payloads well below it. */
export const MAX_SYNCED_PAYLOAD_BYTES = 8_000_000;

const encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).length;
}

/** FNV-1a 32-bit checksum over UTF-16 code units (stable across browsers and Node). */
export function payloadChecksum(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function codePointByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/** Splits a string into pieces of at most `maxBytes` UTF-8 bytes without breaking characters. */
export function splitIntoByteChunks(value: string, maxBytes: number = CHUNK_MAX_BYTES): string[] {
  if (maxBytes < 4) throw new Error('maxBytes must be at least 4.');
  const chunks: string[] = [];
  let start = 0;
  let bytes = 0;
  let i = 0;
  while (i < value.length) {
    const codePoint = value.codePointAt(i) as number;
    const units = codePoint > 0xffff ? 2 : 1;
    const size = codePointByteLength(codePoint);
    if (bytes + size > maxBytes) {
      chunks.push(value.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += size;
    i += units;
  }
  if (start < value.length || chunks.length === 0) chunks.push(value.slice(start));
  return chunks;
}

export interface EncodedPayload {
  json: string;
  byteLength: number;
  checksum: string;
  /** Present when the payload fits inline. */
  inline?: string;
  /** Present when the payload must be chunked. */
  chunks?: string[];
}

export class PayloadTooLargeError extends Error {
  constructor(readonly byteLength: number) {
    super(`Payload of ${byteLength} bytes exceeds the ${MAX_SYNCED_PAYLOAD_BYTES} byte sync limit.`);
    this.name = 'PayloadTooLargeError';
  }
}

export function encodePayload(
  value: unknown,
  options: { inlineMaxBytes?: number; chunkMaxBytes?: number } = {}
): EncodedPayload {
  const json = JSON.stringify(value);
  const byteLength = utf8ByteLength(json);
  if (byteLength > MAX_SYNCED_PAYLOAD_BYTES) throw new PayloadTooLargeError(byteLength);
  const checksum = payloadChecksum(json);
  if (byteLength <= (options.inlineMaxBytes ?? INLINE_PAYLOAD_MAX_BYTES)) {
    return { json, byteLength, checksum, inline: json };
  }
  return { json, byteLength, checksum, chunks: splitIntoByteChunks(json, options.chunkMaxBytes ?? CHUNK_MAX_BYTES) };
}

export class PayloadIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadIntegrityError';
  }
}

/** Reassembles chunk documents; throws PayloadIntegrityError if any chunk is missing or altered. */
export function decodeChunkedPayload<T>(
  chunkDocs: ReadonlyArray<{ index: unknown; data: unknown }>,
  expected: { chunkCount: number; checksum: string; byteLength?: number }
): T {
  if (!Number.isInteger(expected.chunkCount) || expected.chunkCount < 1) {
    throw new PayloadIntegrityError('Invalid chunk count.');
  }
  const byIndex = new Map<number, string>();
  for (const chunk of chunkDocs) {
    if (typeof chunk.index === 'number' && typeof chunk.data === 'string') {
      byIndex.set(chunk.index, chunk.data);
    }
  }
  const parts: string[] = [];
  for (let i = 0; i < expected.chunkCount; i++) {
    const part = byIndex.get(i);
    if (part === undefined) throw new PayloadIntegrityError(`Missing chunk ${i} of ${expected.chunkCount}.`);
    parts.push(part);
  }
  const json = parts.join('');
  if (payloadChecksum(json) !== expected.checksum) {
    throw new PayloadIntegrityError('Checksum mismatch.');
  }
  if (typeof expected.byteLength === 'number' && utf8ByteLength(json) !== expected.byteLength) {
    throw new PayloadIntegrityError('Byte length mismatch.');
  }
  return parseJsonOrThrow<T>(json);
}

/** Parses JSON, converting syntax errors (e.g. legacy truncated payloads) into integrity errors. */
export function parseJsonOrThrow<T>(json: string): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new PayloadIntegrityError('Stored JSON is incomplete or corrupted.');
  }
}
