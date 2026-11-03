import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  authenticateBearer,
  classifyVerificationError,
  createRequireAuth,
  extractBearerToken,
  type IdTokenVerifier,
} from './authMiddleware.ts';
import { withTestServer } from './testHttp.ts';

function firebaseError(code: string): Error {
  return Object.assign(new Error(`firebase error ${code}`), { code });
}

const verifier: IdTokenVerifier = async (token) => {
  switch (token) {
    case 'valid-alice':
      return { uid: 'alice', email: 'alice@example.com', signInProvider: 'google.com' };
    case 'valid-anon':
      return { uid: 'anon-1', signInProvider: 'anonymous' };
    case 'expired':
      throw firebaseError('auth/id-token-expired');
    case 'revoked':
      throw firebaseError('auth/id-token-revoked');
    case 'network':
      throw firebaseError('app/network-error');
    default:
      throw firebaseError('auth/argument-error');
  }
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/protected', createRequireAuth(verifier), (req, res) => {
    res.json({ uid: req.authUser?.uid });
  });
  return app;
}

test('extractBearerToken accepts only well-formed Bearer headers', () => {
  assert.equal(extractBearerToken('Bearer abc.def'), 'abc.def');
  assert.equal(extractBearerToken('bearer abc'), 'abc');
  assert.equal(extractBearerToken(undefined), null);
  assert.equal(extractBearerToken('Basic abc'), null);
  assert.equal(extractBearerToken('Bearer'), null);
  assert.equal(extractBearerToken('Bearer a b'), null);
  assert.equal(extractBearerToken(`Bearer ${'x'.repeat(5000)}`), null);
  assert.equal(extractBearerToken(['Bearer abc']), null);
});

test('classifyVerificationError maps Firebase Admin codes to client-safe failures', () => {
  assert.equal(classifyVerificationError(firebaseError('auth/id-token-expired')).code, 'token_expired');
  assert.equal(classifyVerificationError(firebaseError('auth/id-token-revoked')).code, 'token_revoked');
  assert.equal(classifyVerificationError(firebaseError('auth/user-disabled')).code, 'token_revoked');
  assert.equal(classifyVerificationError(firebaseError('auth/argument-error')).code, 'invalid_token');
  assert.equal(classifyVerificationError(new Error('boom')).code, 'invalid_token');
  const unavailable = classifyVerificationError(firebaseError('app/network-error'));
  assert.equal(unavailable.code, 'auth_unavailable');
  assert.equal(unavailable.status, 503);
});

test('authenticateBearer works with a raw token (WebSocket first-message auth)', async () => {
  const ok = await authenticateBearer({ token: 'valid-alice' }, verifier);
  assert.equal(ok.ok, true);
  const missing = await authenticateBearer({ token: '' }, verifier);
  assert.equal(missing.ok, false);
  const nonString = await authenticateBearer({ token: 42 }, verifier);
  assert.equal(nonString.ok, false);
});

test('requireAuth middleware: missing, invalid, expired, revoked, anonymous and valid tokens', async () => {
  await withTestServer(buildApp(), async (base) => {
    const call = (headers: Record<string, string>, body: unknown = {}) =>
      fetch(`${base}/protected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });

    const missing = await call({});
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).code, 'auth_required');

    const malformed = await call({ Authorization: 'Token valid-alice' });
    assert.equal(malformed.status, 401);
    assert.equal((await malformed.json()).code, 'auth_required');

    const invalid = await call({ Authorization: 'Bearer forged-token' });
    assert.equal(invalid.status, 401);
    const invalidBody = await invalid.json();
    assert.equal(invalidBody.code, 'invalid_token');
    assert.ok(!JSON.stringify(invalidBody).includes('forged-token'), 'token must never be echoed');

    const expired = await call({ Authorization: 'Bearer expired' });
    assert.equal(expired.status, 401);
    assert.equal((await expired.json()).code, 'token_expired');

    const revoked = await call({ Authorization: 'Bearer revoked' });
    assert.equal(revoked.status, 401);
    assert.equal((await revoked.json()).code, 'token_revoked');

    const unavailable = await call({ Authorization: 'Bearer network' });
    assert.equal(unavailable.status, 503);

    const anonymous = await call({ Authorization: 'Bearer valid-anon' });
    assert.equal(anonymous.status, 403);
    assert.equal((await anonymous.json()).code, 'anonymous_not_allowed');

    const valid = await call({ Authorization: 'Bearer valid-alice' });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { uid: 'alice' });
  });
});

test('requireAuth never trusts a client-supplied UID', async () => {
  await withTestServer(buildApp(), async (base) => {
    const res = await fetch(`${base}/protected`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-alice',
        'X-User-Id': 'mallory',
      },
      body: JSON.stringify({ uid: 'mallory', userId: 'mallory' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).uid, 'alice');
  });
});
