import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedWindowRateLimiter } from './rateLimiter.ts';

test('fixed window limiter allows max hits per window and resets afterwards', () => {
  let now = 1_000;
  const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 3, now: () => now });
  assert.equal(limiter.hit('k').allowed, true);
  assert.equal(limiter.hit('k').allowed, true);
  const third = limiter.hit('k');
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);
  const blocked = limiter.hit('k');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 60_000);
  assert.equal(limiter.hit('other').allowed, true);

  now += 60_000;
  assert.equal(limiter.hit('k').allowed, true);
});

test('limiter memory stays bounded under many distinct keys', () => {
  let now = 0;
  const limiter = new FixedWindowRateLimiter({ windowMs: 1_000, max: 1, maxKeys: 100, now: () => now });
  for (let i = 0; i < 1_000; i++) limiter.hit(`ip:${i}`);
  assert.ok(limiter.size <= 100);
  now += 2_000;
  limiter.hit('fresh');
  assert.ok(limiter.size <= 100);
});

test('limiter rejects invalid configuration', () => {
  assert.throws(() => new FixedWindowRateLimiter({ windowMs: 0, max: 1 }));
  assert.throws(() => new FixedWindowRateLimiter({ windowMs: 1000, max: 0 }));
});
