import type { KeyValueStorage } from './localScope';

/**
 * Firebase Auth persists sessions under keys like `firebase:authUser:<apiKey>:[DEFAULT]`.
 *
 * The original app wiped *all* persisted sessions on every load (and used in-memory auth) so that
 * sessions left over from a previous Firebase project could not trigger failing token refreshes.
 * That also logged every user out on reload. This removes only entries created for a different
 * web API key; the current project's session is kept.
 */
export function removeForeignFirebaseAuthEntries(storage: KeyValueStorage, currentApiKey: string): number {
  if (!currentApiKey) return 0;
  const toRemove: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith('firebase:')) continue;
    const match = /^firebase:(?:authUser|redirectUser|persistence):([^:]+):/.exec(key);
    if (match && match[1] !== currentApiKey) toRemove.push(key);
  }
  for (const key of toRemove) storage.removeItem(key);
  return toRemove.length;
}
