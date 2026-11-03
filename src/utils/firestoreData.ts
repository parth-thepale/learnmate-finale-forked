/**
 * Firestore write-data preparation shared by the client sync layer and the server Admin SDK
 * stores. Both SDKs reject `undefined` anywhere in a document, so optional fields that are
 * `undefined` must be removed before writing. Rules:
 *  - `undefined` object properties are omitted (they mean "not set"); `null` is preserved.
 *  - `undefined` array elements, nested arrays, functions, symbols, bigints and Map/Set values are
 *    errors: they cannot be stored faithfully, so the write is refused instead of altered.
 *  - Required top-level fields are checked first, so required data is never silently dropped.
 *  - Dates and other SDK value types (Timestamp, FieldValue...) pass through unchanged.
 * The input is never mutated.
 */

export class FirestoreDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirestoreDataError';
  }
}

/** Firestore's documented maximum nesting depth for maps and arrays. */
export const FIRESTORE_MAX_DEPTH = 20;

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describe(path: string): string {
  return path || '(document root)';
}

function clean(value: unknown, path: string, depth: number, insideArray: boolean): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value;
    case 'undefined':
      throw new FirestoreDataError(`undefined at ${describe(path)} cannot be stored.`);
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new FirestoreDataError(`${typeof value} at ${describe(path)} cannot be stored.`);
  }
  if (depth > FIRESTORE_MAX_DEPTH) throw new FirestoreDataError(`${describe(path)} is nested deeper than ${FIRESTORE_MAX_DEPTH} levels.`);
  const obj = value as object;
  if (Array.isArray(obj)) {
    if (insideArray) throw new FirestoreDataError(`nested array at ${describe(path)} cannot be stored (Firestore has no arrays of arrays).`);
    return obj.map((item, i) => {
      if (item === undefined) throw new FirestoreDataError(`undefined array element at ${path}[${i}] cannot be stored.`);
      return clean(item, `${path}[${i}]`, depth + 1, true);
    });
  }
  if (obj instanceof Map || obj instanceof Set) throw new FirestoreDataError(`${obj.constructor.name} at ${describe(path)} cannot be stored.`);
  if (!isPlainObject(obj)) return obj; // Date, Timestamp, FieldValue, GeoPoint, DocumentReference, Bytes...
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(obj)) {
    if (child === undefined) continue;
    out[key] = clean(child, path ? `${path}.${key}` : key, depth + 1, false);
  }
  return out;
}

/**
 * Returns a copy of `data` that is safe to pass to Firestore `set()`. Throws FirestoreDataError
 * when a required field is missing or a value cannot be represented.
 */
export function toFirestoreData<T extends Record<string, unknown>>(
  data: T,
  options: { required?: readonly string[]; label?: string } = {}
): Record<string, unknown> {
  const label = options.label ? `${options.label}: ` : '';
  if (typeof data !== 'object' || data === null || Array.isArray(data) || !isPlainObject(data)) {
    throw new FirestoreDataError(`${label}document data must be a plain object.`);
  }
  for (const field of options.required ?? []) {
    if (data[field] === undefined || data[field] === null) throw new FirestoreDataError(`${label}required field "${field}" is missing.`);
  }
  try {
    return clean(data, '', 0, false) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof FirestoreDataError && label) throw new FirestoreDataError(`${label}${err.message}`);
    throw err;
  }
}

/**
 * Strict check used by test doubles: throws exactly where the Firestore SDK or backend would
 * reject the value (including `undefined` object properties, which toFirestoreData removes).
 */
export function assertFirestoreValue(value: unknown, path = ''): void {
  if (value === undefined) throw new FirestoreDataError(`Cannot use "undefined" as a Firestore value (found in field ${describe(path)}).`);
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
      throw new FirestoreDataError(`Unsupported ${typeof value} in field ${describe(path)}.`);
    }
    return;
  }
  const depth = path ? path.split(/[.[]/).length : 0;
  if (depth > FIRESTORE_MAX_DEPTH) throw new FirestoreDataError(`Field ${describe(path)} exceeds the maximum depth.`);
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (Array.isArray(item)) throw new FirestoreDataError(`Nested arrays are not supported (field ${path}[${i}]).`);
      assertFirestoreValue(item, `${path}[${i}]`);
    });
    return;
  }
  if (value instanceof Map || value instanceof Set) throw new FirestoreDataError(`Unsupported ${value.constructor.name} in field ${describe(path)}.`);
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) assertFirestoreValue(child, path ? `${path}.${key}` : key);
}
