import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryDailyUsageStore,
  FirestoreDailyUsageStore,
  MAX_DAILY_ACTIVE_SECONDS,
  MAX_DAILY_VIDEO_GENERATIONS,
  MAX_DAILY_MODEL3D_GENERATIONS,
  QuotaLimitExceededError,
  computeDailyBudgetInfo,
  getProviderConfigChecklist,
} from './aiGateway.ts';
import { StrictFakeFirestore } from './firestoreTestDouble';

test('Asia/Kolkata daily rollover and reset boundary', async () => {
  const store = new MemoryDailyUsageStore();

  // 18:29:59 UTC = 23:59:59 IST on Nov 3
  const preMidnightUtc = new Date('2026-11-03T18:29:59Z');
  // 18:30:00 UTC = 00:00:00 IST on Nov 4
  const postMidnightUtc = new Date('2026-11-03T18:30:00Z');

  const preUsage = await store.getUsage('student-1', preMidnightUtc);
  assert.equal(preUsage.day, '2026-11-03');
  assert.equal(preUsage.timezone, 'Asia/Kolkata');

  const postUsage = await store.getUsage('student-1', postMidnightUtc);
  assert.equal(postUsage.day, '2026-11-04');
  assert.equal(postUsage.timezone, 'Asia/Kolkata');
});

test('Enforces 5-hour (18,000s) eligible daily AI activity limit', async () => {
  const store = new MemoryDailyUsageStore();
  const now = new Date('2026-11-04T06:00:00Z');

  // Consume 4.5 hours (16,200s)
  const res1 = await store.reserve({
    uid: 'student-2',
    capability: 'text_generation',
    provider: 'gemini_developer_api',
    model: 'gemini-3.8-flash',
    estimatedSeconds: 16200,
    now,
  });
  assert.equal(res1.allowed, true);
  await store.commit({
    reservationId: res1.reservationId,
    actualSeconds: 16200,
    success: true,
    now,
  });

  const check1 = await store.getUsage('student-2', now);
  assert.equal(check1.activeSeconds, 16200);
  assert.equal(check1.remainingActiveSeconds, 1800); // 30 minutes left

  // Attempting 2000s exceeds 18000s limit
  await assert.rejects(
    store.reserve({
      uid: 'student-2',
      capability: 'text_generation',
      provider: 'gemini_developer_api',
      model: 'gemini-3.8-flash',
      estimatedSeconds: 2000,
      now,
    }),
    (err: unknown) => {
      assert.ok(err instanceof QuotaLimitExceededError);
      assert.equal(err.code, 'daily_activity_limit_exceeded');
      return true;
    }
  );
});

test('Enforces exactly 3 successful video generations and rolls back on failure', async () => {
  const store = new MemoryDailyUsageStore();
  const now = new Date('2026-11-04T07:00:00Z');

  // 1st video: succeeds
  const v1 = await store.reserve({
    uid: 'student-video',
    capability: 'video_generation',
    provider: 'higgsfield_media',
    model: 'higgsfield-video-v1',
    now,
  });
  await store.commit({ reservationId: v1.reservationId, actualSeconds: 60, success: true, now });

  // 2nd video: FAILS (e.g. timeout / network error) -> must NOT consume video count
  const v2 = await store.reserve({
    uid: 'student-video',
    capability: 'video_generation',
    provider: 'higgsfield_media',
    model: 'higgsfield-video-v1',
    now,
  });
  await store.commit({ reservationId: v2.reservationId, actualSeconds: 10, success: false, now });

  const midway = await store.getUsage('student-video', now);
  assert.equal(midway.videoGenerations, 1, 'Failed generation must not count against quota');

  // 2nd successful video
  const v3 = await store.reserve({
    uid: 'student-video',
    capability: 'video_generation',
    provider: 'higgsfield_media',
    model: 'higgsfield-video-v1',
    now,
  });
  await store.commit({ reservationId: v3.reservationId, actualSeconds: 60, success: true, now });

  // 3rd successful video
  const v4 = await store.reserve({
    uid: 'student-video',
    capability: 'video_generation',
    provider: 'higgsfield_media',
    model: 'higgsfield-video-v1',
    now,
  });
  await store.commit({ reservationId: v4.reservationId, actualSeconds: 60, success: true, now });

  const finalCheck = await store.getUsage('student-video', now);
  assert.equal(finalCheck.videoGenerations, 3);
  assert.equal(finalCheck.remainingVideoGenerations, 0);

  // 4th video attempt must be rejected
  await assert.rejects(
    store.reserve({
      uid: 'student-video',
      capability: 'video_generation',
      provider: 'higgsfield_media',
      model: 'higgsfield-video-v1',
      now,
    }),
    (err: unknown) => {
      assert.ok(err instanceof QuotaLimitExceededError);
      assert.equal(err.code, 'video_quota_exceeded');
      return true;
    }
  );
});

test('Enforces exactly 3 successful 3D model generations', async () => {
  const store = new MemoryDailyUsageStore();
  const now = new Date('2026-11-04T08:00:00Z');

  for (let i = 1; i <= 3; i++) {
    const r = await store.reserve({
      uid: 'student-3d',
      capability: 'model3d_generation',
      provider: 'anthropic_claude',
      model: 'claude-3-5-sonnet',
      now,
    });
    await store.commit({ reservationId: r.reservationId, actualSeconds: 15, success: true, now });
  }

  const check = await store.getUsage('student-3d', now);
  assert.equal(check.model3DGenerations, 3);
  assert.equal(check.remainingModel3DGenerations, 0);

  await assert.rejects(
    store.reserve({
      uid: 'student-3d',
      capability: 'model3d_generation',
      provider: 'anthropic_claude',
      model: 'claude-3-5-sonnet',
      now,
    }),
    (err: unknown) => {
      assert.ok(err instanceof QuotaLimitExceededError);
      assert.equal(err.code, 'model3d_quota_exceeded');
      return true;
    }
  );
});

test('Dynamic budget calculation returns null when unconfigured and calculates remaining correctly when configured', () => {
  const originalEnv = process.env.DAILY_COST_BUDGET_USD;
  try {
    delete process.env.DAILY_COST_BUDGET_USD;
    const unconfigured = computeDailyBudgetInfo(1.5, 0.5);
    assert.equal(unconfigured.budget, null);
    assert.equal(unconfigured.remaining, null);

    process.env.DAILY_COST_BUDGET_USD = '5.00';
    const configured = computeDailyBudgetInfo(1.25, 0.50);
    assert.equal(configured.budget, 5.00);
    assert.equal(configured.remaining, 3.25); // 5 - 1.25 - 0.50 = 3.25
  } finally {
    if (originalEnv !== undefined) {
      process.env.DAILY_COST_BUDGET_USD = originalEnv;
    } else {
      delete process.env.DAILY_COST_BUDGET_USD;
    }
  }
});

test('Provider configuration checklist produces all required provider specifications', () => {
  const checklist = getProviderConfigChecklist();
  assert.ok(checklist.length >= 6);
  const providerIds = checklist.map((c) => c.providerId);
  assert.ok(providerIds.includes('gemini_developer_api'));
  assert.ok(providerIds.includes('vertex_ai'));
  assert.ok(providerIds.includes('anthropic_claude'));
  assert.ok(providerIds.includes('openai_adapter'));
  assert.ok(providerIds.includes('deepseek_adapter'));
  assert.ok(providerIds.includes('higgsfield_media'));

  for (const item of checklist) {
    assert.ok(item.name.length > 0);
    assert.ok(item.requiredCredentialEnv.length > 0);
    assert.ok(Array.isArray(item.supportedCapabilities) && item.supportedCapabilities.length > 0);
    assert.ok(item.pricingStructure.length > 0);
  }
});

test('FirestoreDailyUsageStore commits and rolls back usage atomically inside Firestore transactions', async () => {
  const db = new StrictFakeFirestore();
  const store = new FirestoreDailyUsageStore(db);
  const now = new Date('2026-11-04T12:00:00Z');

  // Reserve 1 video
  const v1 = await store.reserve({
    uid: 'fire-user',
    capability: 'video_generation',
    provider: 'higgsfield_media',
    model: 'higgsfield-video-v1',
    now,
  });
  assert.equal(v1.allowed, true);

  // Commit successful video
  await store.commit({
    reservationId: v1.reservationId,
    uid: 'fire-user',
    capability: 'video_generation',
    actualSeconds: 45,
    success: true,
    now,
  });

  const check1 = await store.getUsage('fire-user', now);
  assert.equal(check1.videoGenerations, 1);
  assert.equal(check1.activeSeconds, 45);

  // Reserve 2nd video but simulate FAILURE -> must NOT increment video count
  const v2 = await store.reserve({
    uid: 'fire-user',
    capability: 'video_generation',
    provider: 'higgsfield_media',
    model: 'higgsfield-video-v1',
    now,
  });
  await store.commit({
    reservationId: v2.reservationId,
    uid: 'fire-user',
    capability: 'video_generation',
    actualSeconds: 0,
    success: false,
    now,
  });

  const check2 = await store.getUsage('fire-user', now);
  assert.equal(check2.videoGenerations, 1, 'Failed generation must not increment videoGenerations in Firestore');
});
