import type { User } from 'firebase/auth';
import type { DeviceOnlyDataSummary, IStudyStorageRepository } from './storageService';
import type { CloudDocStore } from './cloudStore';
import type { KeyValueStorage } from './localScope';
import { RoadmapOutboxService } from '../features/roadmaps/services/roadmapOutboxService';

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
  roadmapPending: number;
  roadmapPermanentFailures: number;
  roadmapUnpersisted: number;
}

export type SignOutResult =
  | { status: 'cancelled' }
  | { status: 'signed_out'; kept: true }
  | { status: 'signed_out'; kept: false; removedEntries: number }
  | {
      status: 'failed';
      error: string;
      blockedByRoadmapOutbox?: boolean;
      roadmapPending?: number;
      roadmapPermanentFailures?: number;
      roadmapUnpersisted?: number;
    };

type SignOutStorage = Pick<
  IStudyStorageRepository,
  'flushPendingWrites' | 'getUnsyncedChangeCount' | 'getDeviceOnlyDataSummary' | 'activateAccount' | 'removeAccountDataFromDevice'
> & {
  getUnderlyingStorage?: () => KeyValueStorage | null;
  getCloudStore?: () => CloudDocStore | null;
};

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
export async function prepareSignOutSummary(
  storage: SignOutStorage,
  user: Pick<User, 'uid'>,
  options?: { cloud?: CloudDocStore; customStorage?: KeyValueStorage }
): Promise<SignOutSummary> {
  await storage.flushPendingWrites();

  const cloud = options?.cloud ?? storage.getCloudStore?.() ?? null;
  const customStorage = options?.customStorage ?? storage.getUnderlyingStorage?.() ?? undefined;

  // Flush roadmap mutations before reporting summary
  if (cloud) {
    try {
      await RoadmapOutboxService.flush(user.uid, cloud, customStorage);
    } catch (err) {
      console.warn('[prepareSignOutSummary] Roadmap outbox flush warning:', err);
    }
  }

  const deviceOnly = storage.getDeviceOnlyDataSummary();
  const roadmapPending = RoadmapOutboxService.getPendingCount(user.uid, customStorage);
  const roadmapPermanentFailures = RoadmapOutboxService.getPermanentFailures(user.uid, customStorage).length;
  const roadmapUnpersisted = RoadmapOutboxService.getUnpersistedCount(user.uid);

  return {
    uid: user.uid,
    unsyncedChanges: storage.getUnsyncedChangeCount(),
    deviceOnly,
    deviceOnlyTotal: totalDeviceOnly(deviceOnly),
    roadmapPending,
    roadmapPermanentFailures,
    roadmapUnpersisted,
  };
}

export async function performSignOut(params: {
  choice: SignOutChoice;
  uid: string;
  storage: SignOutStorage;
  signOut: () => Promise<void>;
  cloud?: CloudDocStore;
  customStorage?: KeyValueStorage;
  forceRemoveWithUnsyncedRoadmap?: boolean;
}): Promise<SignOutResult> {
  const { choice, uid, storage, signOut, forceRemoveWithUnsyncedRoadmap } = params;
  if (choice === 'cancel') return { status: 'cancelled' };

  await storage.flushPendingWrites();

  const cloud = params.cloud ?? storage.getCloudStore?.() ?? null;
  const customStorage = params.customStorage ?? storage.getUnderlyingStorage?.() ?? undefined;

  // Flush roadmap mutations before destructive removal
  if (choice === 'remove' && cloud) {
    try {
      await RoadmapOutboxService.flush(uid, cloud, customStorage);
    } catch {
      // Recheck below - do not assume success
    }
  }

  // Recheck outbox after flush
  const remainingPending = RoadmapOutboxService.getPendingCount(uid, customStorage);
  const remainingFailed = RoadmapOutboxService.getPermanentFailures(uid, customStorage).length;
  const remainingUnpersisted = RoadmapOutboxService.getUnpersistedCount(uid);

  // Prevent destructive removal by default if mutations remain (pending, failed, or unpersisted)
  if (
    choice === 'remove' &&
    (remainingPending > 0 || remainingFailed > 0 || remainingUnpersisted > 0) &&
    !forceRemoveWithUnsyncedRoadmap
  ) {
    return {
      status: 'failed',
      error: `Cannot remove account data: ${remainingPending} pending, ${remainingFailed} failed, and ${remainingUnpersisted} unpersisted roadmap changes have not been saved to the cloud. Choose "Keep on this device" to preserve your progress or retry sync.`,
      blockedByRoadmapOutbox: true,
      roadmapPending: remainingPending,
      roadmapPermanentFailures: remainingFailed,
      roadmapUnpersisted: remainingUnpersisted,
    };
  }

  // Sign out first: if that fails the student is still signed in and nothing has been deleted.
  try {
    await signOut();
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : 'Sign-out failed.' };
  }

  // Cancel any retry timers for this account
  RoadmapOutboxService.cancelRetryTimers(uid);

  // Leave the account's scope immediately (the auth listener does the same; this is idempotent).
  storage.activateAccount(null);

  if (choice === 'keep') return { status: 'signed_out', kept: true };

  const removedEntries = storage.removeAccountDataFromDevice(uid, { force: forceRemoveWithUnsyncedRoadmap });
  RoadmapOutboxService.clearUnpersisted(uid);
  return { status: 'signed_out', kept: false, removedEntries };
}
