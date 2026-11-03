/**
 * Launch feature availability shared by the Express server and the React client.
 *
 * Disabled features keep their source code, but their API routes respond 404 and
 * their navigation entry points are hidden. Flip a flag (and redeploy) to re-enable.
 */
export type LaunchFeature = 'create' | 'explore' | 'lofi' | 'liveVoice';

export const LAUNCH_FEATURES: Readonly<Record<LaunchFeature, boolean>> = Object.freeze({
  create: false,
  explore: false,
  lofi: false,
  liveVoice: false,
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
