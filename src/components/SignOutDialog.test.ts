import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignOutDialog } from './SignOutDialog';
import type { SignOutSummary } from '../services/signOutFlow';

const summary: SignOutSummary = {
  uid: 'alice',
  unsyncedChanges: 2,
  deviceOnly: { notebookEntries: 1, plannerTasks: 0, annotatedDocuments: 0, focusSessions: 0, creativeAssets: 0, studySessions: 3 },
  deviceOnlyTotal: 4,
  roadmapPending: 0,
  roadmapPermanentFailures: 0,
  roadmapUnpersisted: 0,
};

test('sign-out dialog offers Keep (recommended, first), Remove and Cancel and lists what is local-only', () => {
  const html = renderToStaticMarkup(React.createElement(SignOutDialog, { summary, busy: false, error: null, onChoose: () => undefined }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  const keep = html.indexOf('Keep on this device');
  const remove = html.indexOf('Remove from this device');
  const cancel = html.indexOf('>Cancel<');
  assert.ok(keep > 0 && keep < remove && remove < cancel, 'Keep comes first, then Remove, then Cancel');
  assert.match(html, /\(recommended\)/);
  assert.match(html, /anyone using this profile could read it with browser tools/, 'shared-device warning is explicit');
  assert.match(html, /2 changes are not saved to your account yet/);
  assert.match(html, /3 study sessions, 1 notebook entry/);
  assert.doesNotMatch(html, /Delete and sign out/, 'deleting needs a second, explicit step');
});

test('a failed sign-out says that nothing was deleted', () => {
  const html = renderToStaticMarkup(React.createElement(SignOutDialog, { summary, busy: false, error: 'network-request-failed', onChoose: () => undefined }));
  assert.match(html, /Sign-out failed: network-request-failed Nothing was deleted\./);
});

test('sign-out dialog displays pending and failed roadmap mutations', () => {
  const roadmapSummary: SignOutSummary = {
    ...summary,
    roadmapPending: 3,
    roadmapPermanentFailures: 1,
  };
  const html = renderToStaticMarkup(React.createElement(SignOutDialog, { summary: roadmapSummary, busy: false, error: null, onChoose: () => undefined }));
  assert.match(html, /3 roadmap mutations are waiting to sync/);
  assert.match(html, /1 failed roadmap change needs attention/);
});
