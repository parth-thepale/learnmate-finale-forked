import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  API_ROUTE_POLICIES,
  createApiAccessControl,
  jsonBodyErrorHandler,
  MEDIA_BODY_PATHS,
  resolveApiRoute,
} from './apiAccessControl.ts';
import type { IdTokenVerifier } from './authMiddleware.ts';
import { FixedWindowRateLimiter } from './rateLimiter.ts';
import {
  MemoryDailyQuotaStore,
  UnavailableDailyQuotaStore,
  type DailyQuotaStore,
} from './quotaStore.ts';
import { REQUEST_LIMITS } from './requestValidation.ts';
import type { LaunchFeature } from '../config/launchFeatures.ts';
import { withTestServer } from './testHttp.ts';

const verifier: IdTokenVerifier = async (token) => {
  if (token.startsWith('uid:')) return { uid: token.slice(4), signInProvider: 'google.com' };
  throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
};

interface BuildOptions {
  quotaStore?: DailyQuotaStore;
  dailyUnitLimit?: number;
  userPerMinute?: number;
  ipPerMinute?: number;
  enabledFeatures?: LaunchFeature[];
  diagnosticsEnabled?: boolean;
  adminUids?: string[];
}

function buildApp(opts: BuildOptions = {}) {
  const handlerHits: string[] = [];
  const quotaStore = opts.quotaStore ?? new MemoryDailyQuotaStore();
  const control = createApiAccessControl({
    verifyIdToken: verifier,
    quotaStore,
    ipLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, max: opts.ipPerMinute ?? 1000 }),
    userLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, max: opts.userPerMinute ?? 1000 }),
    dailyUnitLimit: opts.dailyUnitLimit ?? 100,
    isFeatureEnabled: (f) => (opts.enabledFeatures ?? []).includes(f),
    diagnosticsEnabled: opts.diagnosticsEnabled ?? false,
    adminUids: new Set(opts.adminUids ?? []),
    logger: { warn: () => {} },
  });

  const app = express();
  app.use(control.beforeBody);
  app.use(MEDIA_BODY_PATHS, express.json({ limit: REQUEST_LIMITS.mediaJsonBody }));
  app.use(express.json({ limit: REQUEST_LIMITS.defaultJsonBody }));
  app.use(control.afterBody);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  const echo = (name: string) => (req: express.Request, res: express.Response) => {
    handlerHits.push(name);
    res.json({ ok: true, uid: req.authUser?.uid ?? null });
  };
  app.post('/api/study/ask', echo('ask'));
  app.post('/api/study/quiz', echo('quiz'));
  app.post('/api/study/scan-notes', echo('scan'));
  app.post('/api/practice/submit', echo('submit'));
  app.post('/api/study/mistakes-and-plan', echo('mistakes'));
  app.post('/api/create/3d-model', echo('3d'));
  app.post('/api/create/lofi-music', echo('lofi'));
  app.post('/api/explore/daily-news', echo('news'));
  app.get('/api/usage', echo('usage'));
  app.post('/api/vertex/probe', echo('probe'));
  app.use(jsonBodyErrorHandler);
  return { app, handlerHits, quotaStore };
}

const pages = [{ pageNumber: 1, title: 'Kinematics', content: 'Velocity is the rate of change of displacement.' }];

function post(base: string, path: string, body: unknown, token?: string) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('every policy resolves, unknown API paths are denied by default', () => {
  for (const policy of API_ROUTE_POLICIES) {
    if (typeof policy.path === 'string') {
      assert.equal(resolveApiRoute(policy.method, policy.path)?.id, policy.id);
    }
  }
  assert.equal(resolveApiRoute('GET', '/api/create/video-jobs/vidjob-123-abc')?.id, 'create.videoJob');
  assert.equal(resolveApiRoute('GET', '/api/create/video-jobs/../../etc'), null);
  assert.equal(resolveApiRoute('POST', '/api/study/unknown'), null);
  assert.equal(resolveApiRoute('GET', '/api/study/ask'), null);
});

test('health check stays public; unknown API routes return 404 without auth', async () => {
  const { app } = buildApp();
  await withTestServer(app, async (base) => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const unknown = await post(base, '/api/study/does-not-exist', {});
    assert.equal(unknown.status, 404);
  });
});

test('paid AI routes reject unauthenticated and invalid-token requests before any work', async () => {
  const { app, handlerHits } = buildApp();
  await withTestServer(app, async (base) => {
    const noToken = await post(base, '/api/study/ask', { question: 'What is velocity?' });
    assert.equal(noToken.status, 401);
    const badToken = await post(base, '/api/study/ask', { question: 'What is velocity?' }, 'forged');
    assert.equal(badToken.status, 401);
    assert.deepEqual(handlerHits, []);
  });
});

test('authenticated handler receives the verified UID only', async () => {
  const { app } = buildApp();
  await withTestServer(app, async (base) => {
    const res = await post(base, '/api/study/ask', { question: 'Explain velocity', uid: 'mallory' }, 'uid:alice');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).uid, 'alice');
  });
});

test('disabled launch features return 404 even for signed-in users', async () => {
  const { app, handlerHits } = buildApp();
  await withTestServer(app, async (base) => {
    for (const path of ['/api/create/3d-model', '/api/create/lofi-music', '/api/explore/daily-news']) {
      const res = await post(base, path, {}, 'uid:alice');
      assert.equal(res.status, 404, path);
      assert.equal((await res.json()).code, 'feature_disabled');
    }
    assert.deepEqual(handlerHits, []);
  });

  const enabled = buildApp({ enabledFeatures: ['create'] });
  await withTestServer(enabled.app, async (base) => {
    const res = await post(base, '/api/create/3d-model', { concept: 'torque' }, 'uid:alice');
    assert.equal(res.status, 200);
  });
});

test('internal diagnostics are hidden by default and admin-only when enabled', async () => {
  const hidden = buildApp();
  await withTestServer(hidden.app, async (base) => {
    assert.equal((await fetch(`${base}/api/usage`, { headers: { Authorization: 'Bearer uid:admin' } })).status, 404);
    assert.equal((await post(base, '/api/vertex/probe', {}, 'uid:admin')).status, 404);
  });

  const enabled = buildApp({ diagnosticsEnabled: true, adminUids: ['admin'] });
  await withTestServer(enabled.app, async (base) => {
    assert.equal((await fetch(`${base}/api/usage`)).status, 401);
    assert.equal((await fetch(`${base}/api/usage`, { headers: { Authorization: 'Bearer uid:student' } })).status, 403);
    assert.equal((await fetch(`${base}/api/usage`, { headers: { Authorization: 'Bearer uid:admin' } })).status, 200);
  });
});

test('payload validation rejects malformed and oversized requests without charging quota', async () => {
  const quotaStore = new MemoryDailyQuotaStore();
  const { app, handlerHits } = buildApp({ quotaStore, dailyUnitLimit: 2 });
  await withTestServer(app, async (base) => {
    const emptyQuestion = await post(base, '/api/study/ask', { question: '   ' }, 'uid:alice');
    assert.equal(emptyQuestion.status, 400);

    const longQuestion = await post(base, '/api/study/ask', { question: 'x'.repeat(2001) }, 'uid:alice');
    assert.equal(longQuestion.status, 413);

    const hugePages = Array.from({ length: 5 }, (_, i) => ({
      pageNumber: i + 1,
      title: `p${i}`,
      content: 'a'.repeat(60_000),
    }));
    const tooMuchMaterial = await post(base, '/api/study/quiz', { pages: hugePages }, 'uid:alice');
    assert.equal(tooMuchMaterial.status, 413);

    const tooManyPages = Array.from({ length: 31 }, (_, i) => ({ pageNumber: i + 1, title: 't', content: 'c' }));
    assert.equal((await post(base, '/api/study/quiz', { pages: tooManyPages }, 'uid:alice')).status, 413);

    const missingPages = await post(base, '/api/study/quiz', { mode: 'diagnostic' }, 'uid:alice');
    assert.equal(missingPages.status, 400);

    const badMode = await post(base, '/api/study/quiz', { pages, documentId: 'doc-1', mode: 'exam' }, 'uid:alice');
    assert.equal(badMode.status, 400);

    // Document practice needs a real document id (the old "unknown" placeholder is gone).
    for (const body of [{ pages }, { pages, documentId: '' }, { pages, documentId: 'unknown' }, { pages, documentId: 'a/b' }]) {
      assert.equal((await post(base, '/api/study/quiz', body, 'uid:alice')).status, 400, JSON.stringify(body.documentId));
    }

    const badImage = await post(base, '/api/study/scan-notes', { imageDataUrl: 'data:text/html;base64,AAAA' }, 'uid:alice');
    assert.equal(badImage.status, 400);

    const invalidJson = await post(base, '/api/study/ask', '{"question": ', 'uid:alice');
    assert.equal(invalidJson.status, 400);
    assert.equal((await invalidJson.json()).code, 'invalid_json');

    assert.deepEqual(handlerHits, []);
    // Quota untouched: a valid 2-unit quiz still fits in the 2-unit daily budget.
    assert.equal((await post(base, '/api/study/quiz', { pages, documentId: 'doc-1' }, 'uid:alice')).status, 200);
  });
});

test('JSON body limits: 2 MB default, larger limit only on media routes', async () => {
  const { app } = buildApp();
  await withTestServer(app, async (base) => {
    const bigText = { question: 'q', title: 'x'.repeat(2_200_000) };
    const tooLarge = await post(base, '/api/study/ask', bigText, 'uid:alice');
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json()).code, 'payload_too_large');

    const image = { imageDataUrl: `data:image/jpeg;base64,${'A'.repeat(3_000_000)}` };
    const mediaOk = await post(base, '/api/study/scan-notes', image, 'uid:alice');
    assert.equal(mediaOk.status, 200);

    const unauthLarge = await post(base, '/api/study/scan-notes', image);
    assert.equal(unauthLarge.status, 401);
  });
});

test('daily quota is enforced per user and is not shared between users', async () => {
  const { app, handlerHits } = buildApp({ dailyUnitLimit: 5 });
  await withTestServer(app, async (base) => {
    // quiz = 2 units: 2 + 2 = 4 allowed, third would be 6 > 5.
    assert.equal((await post(base, '/api/study/quiz', { pages, documentId: 'doc-1' }, 'uid:alice')).status, 200);
    assert.equal((await post(base, '/api/study/quiz', { pages, documentId: 'doc-1' }, 'uid:alice')).status, 200);
    const blocked = await post(base, '/api/study/quiz', { pages, documentId: 'doc-1' }, 'uid:alice');
    assert.equal(blocked.status, 429);
    const body = await blocked.json();
    assert.equal(body.code, 'daily_quota_exceeded');
    assert.equal(body.quota.limit, 5);
    assert.equal(body.quota.used, 4);

    // A 1-unit tutor question still fits (4 + 1 = 5).
    assert.equal((await post(base, '/api/study/ask', { question: 'Why?' }, 'uid:alice')).status, 200);
    assert.equal((await post(base, '/api/study/ask', { question: 'Why?' }, 'uid:alice')).status, 429);

    // Another user has an independent budget.
    assert.equal((await post(base, '/api/study/quiz', { pages, documentId: 'doc-1' }, 'uid:bob')).status, 200);
    assert.equal(handlerHits.length, 4);
  });
});

test('premium tutor model costs more quota units', async () => {
  const { app } = buildApp({ dailyUnitLimit: 3 });
  await withTestServer(app, async (base) => {
    const premium = { question: 'Explain torque', modelPreference: 'gemini-4-argon' };
    assert.equal((await post(base, '/api/study/ask', premium, 'uid:alice')).status, 200);
    assert.equal((await post(base, '/api/study/ask', { question: 'Explain torque' }, 'uid:alice')).status, 429);
  });
});

test('per-user burst limit and per-IP rate limit return 429', async () => {
  const userLimited = buildApp({ userPerMinute: 2 });
  await withTestServer(userLimited.app, async (base) => {
    assert.equal((await post(base, '/api/study/ask', { question: 'a' }, 'uid:alice')).status, 200);
    assert.equal((await post(base, '/api/study/ask', { question: 'b' }, 'uid:alice')).status, 200);
    const limited = await post(base, '/api/study/ask', { question: 'c' }, 'uid:alice');
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, 'rate_limited');
    assert.ok(limited.headers.get('retry-after'));
    assert.equal((await post(base, '/api/study/ask', { question: 'd' }, 'uid:bob')).status, 200);
  });

  const ipLimited = buildApp({ ipPerMinute: 3 });
  await withTestServer(ipLimited.app, async (base) => {
    for (let i = 0; i < 3; i++) {
      assert.equal((await post(base, '/api/study/ask', { question: `q${i}` })).status, 401);
    }
    // Unauthenticated floods are throttled too.
    assert.equal((await post(base, '/api/study/ask', { question: 'q4' })).status, 429);
    // Health check is exempt from the API rate limit.
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  });
});

test('quota store failure fails closed with 503 and never reaches the AI handler', async () => {
  const { app, handlerHits } = buildApp({ quotaStore: new UnavailableDailyQuotaStore('no credentials') });
  await withTestServer(app, async (base) => {
    const res = await post(base, '/api/study/ask', { question: 'What is work?' }, 'uid:alice');
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'quota_unavailable');
    assert.ok(!JSON.stringify(body).includes('credentials'), 'internal reason must not leak');
    assert.deepEqual(handlerHits, []);
  });
});

test('practice submission and mistake analysis require sign-in and a valid set id, and cost no AI quota', async () => {
  const quotaStore = new MemoryDailyQuotaStore();
  const { app, handlerHits } = buildApp({ quotaStore, dailyUnitLimit: 1 });
  const setId = 'qs_' + 'a'.repeat(32);
  await withTestServer(app, async (base) => {
    assert.equal((await post(base, '/api/practice/submit', { setId, responses: {} })).status, 401);
    assert.equal((await post(base, '/api/practice/submit', { setId: 'qs_bad', responses: {} }, 'uid:alice')).status, 400);
    assert.equal((await post(base, '/api/practice/submit', { setId, responses: { q1: 'A' } }, 'uid:alice')).status, 400);
    for (let i = 0; i < 3; i++) {
      assert.equal((await post(base, '/api/practice/submit', { setId, responses: {} }, 'uid:alice')).status, 200);
    }
    // Mistake analysis no longer accepts client-graded attempts; it needs the server-held set.
    const legacy = await post(base, '/api/study/mistakes-and-plan', { pages, attempt: { questions: [], answers: [] } }, 'uid:alice');
    assert.equal(legacy.status, 400);
    assert.equal((await post(base, '/api/study/mistakes-and-plan', { setId, pages }, 'uid:alice')).status, 200);
    assert.deepEqual(handlerHits, ['submit', 'submit', 'submit', 'mistakes']);
  });
});
