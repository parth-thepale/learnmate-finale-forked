import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDailyUsageStore, QuotaLimitExceededError } from './aiGateway.ts';

test('Concurrent video generation reservations strictly cannot exceed 3', async () => {
  const store = new MemoryDailyUsageStore();
  const now = new Date('2026-11-04T10:00:00Z');

  // Launch 10 parallel attempts to reserve and commit video generation
  const attempts = await Promise.allSettled(
    Array.from({ length: 10 }, async (_, i) => {
      const res = await store.reserve({
        uid: 'concurrent-user',
        capability: 'video_generation',
        provider: 'higgsfield_media',
        model: 'higgsfield-video-v1',
        idempotencyKey: `video-attempt-${i}`,
        now,
      });
      await store.commit({
        reservationId: res.reservationId,
        actualSeconds: 20,
        success: true,
        now,
      });
      return true;
    })
  );

  const succeeded = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');

  assert.equal(succeeded.length, 3, 'Exactly 3 reservations must succeed');
  assert.equal(rejected.length, 7, 'Remaining 7 attempts must be rejected');

  const usage = await store.getUsage('concurrent-user', now);
  assert.equal(usage.videoGenerations, 3);
  assert.equal(usage.remainingVideoGenerations, 0);
});

test('Duplicate idempotency key does not consume duplicate reservations', async () => {
  const store = new MemoryDailyUsageStore();
  const now = new Date('2026-11-04T11:00:00Z');
  const idKey = 'unique-transaction-key-123';

  const res1 = await store.reserve({
    uid: 'idem-user',
    capability: 'video_generation',
    provider: 'higgsfield_media',
    model: 'higgsfield-video-v1',
    idempotencyKey: idKey,
    now,
  });

  // Second attempt with exact same idempotency key while reserved
  const res2 = await store.reserve({
    uid: 'idem-user',
    capability: 'video_generation',
    provider: 'higgsfield_media',
    model: 'higgsfield-video-v1',
    idempotencyKey: idKey,
    now,
  });

  assert.equal(res1.reservationId, res2.reservationId, 'Same reservation ID returned for duplicate idempotency key');
  
  await store.commit({
    reservationId: res1.reservationId,
    actualSeconds: 15,
    success: true,
    now,
  });

  const usage = await store.getUsage('idem-user', now);
  assert.equal(usage.videoGenerations, 1, 'Only 1 generation counted despite duplicate attempts');
});
