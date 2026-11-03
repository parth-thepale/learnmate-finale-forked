import type { User } from 'firebase/auth';
import type { DeviceOnlyDataSummary, IStudyStorageRepository } from './storageService';

/**
 * Explicit sign-out with a data-retention choice.
 *
 *  keep   (default) — sign out; this account's private local data stays on the device in its own
 *                     scope (study sessions together with their deletion records, unsynced
 *                     changes, device-only items). It is shown again only when the same account
 *                     signs in here; guests and other accounts never see it.
 *  remove           — sign out, then delete only this account's local data from this device.
 *  cancel           — nothing happens; the student stays signed in.
 *
 * Implicit sign-outs (token expiry, sign-out in another tab) never go through this flow, so they
 * never delete anything. Nothing is uploaded here: device-only data stays device-only.
 */

export type SignOutChoice = 'keep' | 'remove' | 'cancel';

export interface SignOutSummary {
  uid: string;
  unsyncedChanges: number;
  deviceOnly: DeviceOnlyDataSummary;
  deviceOnlyTotal: number;
}

export type SignOutResult =
  | { status: 'cancelled' }
  | { status: 'signed_out'; kept: true }
  | { status: 'signed_out'; kept: false; removedEntries: number }
  | { status: 'failed'; error: string };

type SignOutStorage = Pick<
  IStudyStorageRepository,
  'flushPendingWrites' | 'getUnsyncedChangeCount' | 'getDeviceOnlyDataSummary' | 'activateAccount' | 'removeAccountDataFromDevice'
>;

export function totalDeviceOnly(summary: DeviceOnlyDataSummary): number {
  return (
    summary.notebookEntries +
    summary.plannerTasks +
    summary.annotatedDocuments +
    summary.focusSessions +
    summary.creativeAssets +
    summary.studySessions
  );
}

/** What would be kept or removed for the signed-in account (after pending writes settle). */
export async function prepareSignOutSummary(storage: SignOutStorage, user: Pick<User, 'uid'>): Promise<SignOutSummary> {
  await storage.flushPendingWrites();
  const deviceOnly = storage.getDeviceOnlyDataSummary();
  return { uid: user.uid, unsyncedChanges: storage.getUnsyncedChangeCount(), deviceOnly, deviceOnlyTotal: totalDeviceOnly(deviceOnly) };
}

export async function performSignOut(params: {
  choice: SignOutChoice;
  uid: string;
  storage: SignOutStorage;
  signOut: () => Promise<void>;
}): Promise<SignOutResult> {
  const { choice, uid, storage, signOut } = params;
  if (choice === 'cancel') return { status: 'cancelled' };

  await storage.flushPendingWrites();
  // Sign out first: if that fails the student is still signed in and nothing has been deleted.
  try {
    await signOut();
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : 'Sign-out failed.' };
  }
  // Leave the account's scope immediately (the auth listener does the same; this is idempotent).
  storage.activateAccount(null);

  if (choice === 'keep') return { status: 'signed_out', kept: true };
  const removedEntries = storage.removeAccountDataFromDevice(uid);
  return { status: 'signed_out', kept: false, removedEntries };
}
