/**
 * Launch feature availability shared by the Express server and the React client.
 *
 * Disabled features keep their source code, but their API routes respond 404 and
 * their navigation entry points are hidden. Flip a flag (and redeploy) to re-enable.
 */
export type LaunchFeature =
  | 'create'
  | 'explore'
  | 'lofi'
  | 'liveVoice'
  | 'companionChat'
  | 'studySessionCloudSync'
  | 'documentSessionMigration';

export const LAUNCH_FEATURES: Readonly<Record<LaunchFeature, boolean>> = Object.freeze({
  create: false,
  explore: false,
  lofi: false,
  liveVoice: false,
  // Mini AI chat in the floating companion duplicates the session tutor (and its AI cost).
  companionChat: false,
  // Study sessions sync to users/{uid}/studySessions only after the rules for that collection are
  // emulator-tested and deployed. Until then sessions are kept on the device and labelled as such.
  studySessionCloudSync: false,
  // Creates one study session per existing document (by reference) after the first full sync.
  // Keep off until session cloud sync is enabled (otherwise deleted sessions are remembered only
  // on the device and could be re-created after an explicit sign-out).
  documentSessionMigration: false,
});

export function isFeatureEnabled(feature: LaunchFeature): boolean {
  return LAUNCH_FEATURES[feature] === true;
}

const TAB_FEATURES: Readonly<Record<string, LaunchFeature>> = Object.freeze({
  create: 'create',
  explore: 'explore',
});

/** Whether a top-level app tab (hash route) is available in this release. */
export function isTabAvailable(tab: string): boolean {
  const feature = TAB_FEATURES[tab];
  return feature ? isFeatureEnabled(feature) : true;
}
