import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { initServerFirebaseAdmin, parseServiceAccountJson, resolveAdminCredentialConfig } from './firebaseAdmin.ts';
import { authenticateBearer } from './authMiddleware.ts';
import {
  MemoryApprovalRecordRepository,
  UnavailableApprovalRecordRepository,
} from './contentVerification/approvalRepository.ts';
import {
  MemoryReviewerRegistry,
  MemoryReviewerAuditRepository,
  UnavailableReviewerRegistry,
  UnavailableReviewerAuditRepository,
} from './contentVerification/reviewerAuthority.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const createdDirs: string[] = [];
test.after(() => {
  for (const dir of createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempRoot(config?: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-admin-'));
  createdDirs.push(dir);
  if (config) fs.writeFileSync(path.join(dir, 'firebase-applet-config.json'), JSON.stringify(config));
  return dir;
}

const fakeServiceAccount = {
  type: 'service_account',
  project_id: 'demo-project',
  client_email: 'svc@demo-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
};

test('service account JSON is accepted raw or base64 and validated', () => {
  const raw = JSON.stringify(fakeServiceAccount);
  assert.equal(parseServiceAccountJson(raw).client_email, fakeServiceAccount.client_email);
  assert.equal(parseServiceAccountJson(Buffer.from(raw).toString('base64')).client_email, fakeServiceAccount.client_email);
  assert.throws(() => parseServiceAccountJson('{"project_id":"x"}'));
  assert.throws(() => parseServiceAccountJson('not json at all'));
});

test('credential resolution: project comes from client config, credentials from env', () => {
  const root = tempRoot({ projectId: 'demo-project', firestoreDatabaseId: '(default)' });

  const none = resolveAdminCredentialConfig({}, root);
  assert.equal(none.mode, 'none');
  assert.equal(none.projectId, 'demo-project');

  const json = resolveAdminCredentialConfig({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(fakeServiceAccount) }, root);
  assert.equal(json.mode, 'service_account_json');
  assert.deepEqual(json.warnings, []);

  const mismatch = resolveAdminCredentialConfig(
    { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...fakeServiceAccount, project_id: 'other' }) },
    root
  );
  assert.equal(mismatch.warnings.length, 1);

  const broken = resolveAdminCredentialConfig({ FIREBASE_SERVICE_ACCOUNT_JSON: '{broken' }, root);
  assert.equal(broken.mode, 'none');
  assert.ok(broken.warnings[0].includes('could not be parsed'));
  assert.ok(!broken.warnings[0].includes('{broken'), 'secret contents must not be echoed');

  const adc = resolveAdminCredentialConfig({ GOOGLE_APPLICATION_CREDENTIALS: '/etc/secrets/firebase-admin.json' }, root);
  assert.equal(adc.mode, 'application_default');

  const override = resolveAdminCredentialConfig({ FIREBASE_PROJECT_ID: 'explicit' }, root);
  assert.equal(override.projectId, 'explicit');
});

test('production without Firebase Admin credentials fails closed; development uses memory quotas', () => {
  const prod = initServerFirebaseAdmin({ env: {}, rootDir: repoRoot, isProduction: true });
  assert.equal(prod.quotaStore.kind, 'unavailable');
  assert.ok(prod.approvalRepository instanceof UnavailableApprovalRecordRepository);
  assert.ok(prod.reviewerRegistry instanceof UnavailableReviewerRegistry);
  assert.ok(prod.reviewerAuditRepository instanceof UnavailableReviewerAuditRepository);
  const dev = initServerFirebaseAdmin({ env: {}, rootDir: repoRoot, isProduction: false });
  assert.equal(dev.quotaStore.kind, 'memory');
  assert.ok(dev.approvalRepository instanceof MemoryApprovalRecordRepository);
  assert.ok(dev.reviewerRegistry instanceof MemoryReviewerRegistry);
  assert.ok(dev.reviewerAuditRepository instanceof MemoryReviewerAuditRepository);
});

test('real Firebase Admin SDK rejects malformed ID tokens as invalid_token', async () => {
  const admin = initServerFirebaseAdmin({ env: {}, rootDir: repoRoot, isProduction: false });
  assert.ok(admin.config.projectId.length > 0);
  const outcome = await authenticateBearer({ token: 'not-a-jwt' }, admin.verifyIdToken);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.code, 'invalid_token');

  // Structurally valid but unsigned JWT with an expired exp claim is still rejected.
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'mallory', exp: 1 })}.`;
  const forged = await authenticateBearer({ token: unsigned }, admin.verifyIdToken);
  assert.equal(forged.ok, false);
});

test('no Firebase project configured: verification reports auth_unavailable', async () => {
  const admin = initServerFirebaseAdmin({ env: {}, rootDir: tempRoot(), isProduction: true });
  const outcome = await authenticateBearer({ token: 'anything' }, admin.verifyIdToken);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.code, 'auth_unavailable');
});
