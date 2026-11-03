import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clientIpFromForwarded,
  isOriginAllowed,
  LiveSessionRegistry,
  parseAllowedOrigins,
} from './liveSocketGuard.ts';

test('parseAllowedOrigins reads ALLOWED_ORIGINS and APP_URL and ignores placeholders', () => {
  const origins = parseAllowedOrigins({
    ALLOWED_ORIGINS: 'https://learnmate.app, https://www.learnmate.app/some/path ,not a url',
    APP_URL: 'MY_APP_URL',
  });
  assert.deepEqual([...origins].sort(), ['https://learnmate.app', 'https://www.learnmate.app']);
  assert.equal(parseAllowedOrigins({ APP_URL: 'https://learnmate.onrender.com' }).has('https://learnmate.onrender.com'), true);
});

test('WebSocket origin check allows same host or allow-listed origins only', () => {
  const allowed = new Set(['https://learnmate.app']);
  assert.equal(isOriginAllowed('https://learnmate.onrender.com', 'learnmate.onrender.com', allowed), true);
  assert.equal(isOriginAllowed('https://learnmate.app', 'learnmate.onrender.com', allowed), true);
  assert.equal(isOriginAllowed('http://localhost:3000', 'localhost:3000', allowed), true);
  assert.equal(isOriginAllowed('https://evil.example', 'learnmate.onrender.com', allowed), false);
  assert.equal(isOriginAllowed('https://learnmate.onrender.com.evil.example', 'learnmate.onrender.com', allowed), false);
  assert.equal(isOriginAllowed(undefined, 'learnmate.onrender.com', allowed), false);
  assert.equal(isOriginAllowed('null', 'learnmate.onrender.com', allowed), false);
});

test('clientIpFromForwarded honours the configured proxy hop count', () => {
  assert.equal(clientIpFromForwarded(undefined, '10.0.0.1', 1), '10.0.0.1');
  assert.equal(clientIpFromForwarded('203.0.113.9', '10.0.0.1', 1), '203.0.113.9');
  // A client-forged left-most entry is ignored when only one proxy is trusted.
  assert.equal(clientIpFromForwarded('1.1.1.1, 203.0.113.9', '10.0.0.1', 1), '203.0.113.9');
  assert.equal(clientIpFromForwarded('1.1.1.1, 203.0.113.9', '10.0.0.1', 0), '10.0.0.1');
  assert.equal(clientIpFromForwarded('203.0.113.9, 172.16.0.2', '10.0.0.1', 2), '203.0.113.9');
});

test('live session registry caps concurrent sessions per user', () => {
  const registry = new LiveSessionRegistry(1);
  assert.equal(registry.tryAcquire('alice'), true);
  assert.equal(registry.tryAcquire('alice'), false);
  assert.equal(registry.tryAcquire('bob'), true);
  registry.release('alice');
  assert.equal(registry.count('alice'), 0);
  assert.equal(registry.tryAcquire('alice'), true);
});
