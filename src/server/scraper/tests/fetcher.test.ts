import test from 'node:test';
import assert from 'node:assert/strict';
import { createSafeHttpsTransport, FetchError, PoliteFetcher, RobotsDisallowedError, type TransportRequest, type TransportResponse } from '../fetcher';
import { extractLinks } from '../htmlParser';
import { UnsafeUrlError } from '../netSafety';
import { assertSourceAllows, getSource, SourceNotPermittedError } from '../sourceRegistry';
import { testSource } from './fixtures';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n%fake\n');

type Handler = (req: TransportRequest) => TransportResponse;

function harness(routes: Record<string, Handler | TransportResponse[]>) {
  const requests: string[] = [];
  const sleeps: number[] = [];
  const counters = new Map<string, number>();
  const fetcher = new PoliteFetcher({
    userAgent: 'LearnmateQuestionImporter/test',
    now: () => 1_000_000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    transport: async (req) => {
      const key = req.url.toString();
      requests.push(key);
      const route = routes[key];
      if (!route) return { status: 404, headers: {}, body: new Uint8Array() };
      if (Array.isArray(route)) {
        const n = counters.get(key) ?? 0;
        counters.set(key, n + 1);
        return route[Math.min(n, route.length - 1)];
      }
      return route(req);
    },
  });
  return { fetcher, requests, sleeps };
}

const pdfResponse: TransportResponse = { status: 200, headers: { 'content-type': 'application/pdf' }, body: PDF_BYTES };

test('fetches an allowed PDF after checking robots.txt, with checksum and provenance', async () => {
  const { fetcher, requests } = harness({ 'https://papers.example.org/p/paper%201.pdf': [pdfResponse] });
  const doc = await fetcher.fetchDocument(testSource(), 'https://papers.example.org/p/paper%201.pdf', 'pdf');
  assert.deepEqual(requests, ['https://papers.example.org/robots.txt', 'https://papers.example.org/p/paper%201.pdf']);
  assert.equal(doc.fileName, 'paper 1.pdf');
  assert.equal(doc.sha256.length, 64);
  assert.equal(doc.contentType, 'application/pdf');
  assert.equal(doc.sourceId, 'test-source');
});

test('disabled sources, unknown hosts and redirects off the allow-list are refused', async () => {
  const { fetcher } = harness({
    'https://papers.example.org/redirect.pdf': [{ status: 302, headers: { location: 'https://evil.example/x.pdf' }, body: new Uint8Array() }],
    'https://papers.example.org/to-metadata.pdf': [{ status: 301, headers: { location: 'http://169.254.169.254/latest/' }, body: new Uint8Array() }],
  });
  await assert.rejects(fetcher.fetchDocument(testSource({ fetchEnabled: false }), 'https://papers.example.org/a.pdf', 'pdf'), FetchError);
  await assert.rejects(fetcher.fetchDocument(testSource(), 'https://evil.example/a.pdf', 'pdf'), UnsafeUrlError);
  await assert.rejects(fetcher.fetchDocument(testSource(), 'https://papers.example.org/redirect.pdf', 'pdf'), UnsafeUrlError);
  await assert.rejects(fetcher.fetchDocument(testSource(), 'https://papers.example.org/to-metadata.pdf', 'pdf'), UnsafeUrlError);
});

test('redirects within the allow-list are followed and limited', async () => {
  const loop: TransportResponse = { status: 302, headers: { location: '/loop.pdf' }, body: new Uint8Array() };
  const { fetcher } = harness({
    'https://papers.example.org/old.pdf': [{ status: 301, headers: { location: 'https://cdn.example.org/new.pdf' }, body: new Uint8Array() }],
    'https://cdn.example.org/new.pdf': [pdfResponse],
    'https://papers.example.org/loop.pdf': [loop],
  });
  const doc = await fetcher.fetchDocument(testSource(), 'https://papers.example.org/old.pdf', 'pdf');
  assert.equal(doc.url, 'https://cdn.example.org/new.pdf');
  await assert.rejects(fetcher.fetchDocument(testSource(), 'https://papers.example.org/loop.pdf', 'pdf'), /Too many redirects/);
});

test('robots.txt disallow and unreachable robots.txt both stop the fetch', async () => {
  const blocked = harness({
    'https://papers.example.org/robots.txt': [{ status: 200, headers: { 'content-type': 'text/plain' }, body: new TextEncoder().encode('User-agent: *\nDisallow: /p/') }],
    'https://papers.example.org/p/a.pdf': [pdfResponse],
  });
  await assert.rejects(blocked.fetcher.fetchDocument(testSource(), 'https://papers.example.org/p/a.pdf', 'pdf'), RobotsDisallowedError);
  assert.ok(!blocked.requests.includes('https://papers.example.org/p/a.pdf'));

  const down = harness({
    'https://papers.example.org/robots.txt': [{ status: 503, headers: {}, body: new Uint8Array() }],
    'https://papers.example.org/p/a.pdf': [pdfResponse],
  });
  await assert.rejects(down.fetcher.fetchDocument(testSource(), 'https://papers.example.org/p/a.pdf', 'pdf'), RobotsDisallowedError);
});

test('retries 429/5xx with Retry-After or exponential backoff, then gives up', async () => {
  const { fetcher, sleeps } = harness({
    'https://papers.example.org/a.pdf': [
      { status: 429, headers: { 'retry-after': '7' }, body: new Uint8Array() },
      { status: 503, headers: {}, body: new Uint8Array() },
      pdfResponse,
    ],
    'https://papers.example.org/b.pdf': [{ status: 500, headers: {}, body: new Uint8Array() }],
  });
  await fetcher.fetchDocument(testSource(), 'https://papers.example.org/a.pdf', 'pdf');
  assert.ok(sleeps.includes(7_000), `Retry-After honoured: ${sleeps}`);
  assert.ok(sleeps.includes(4_000), `backoff after the second failure: ${sleeps}`);
  await assert.rejects(fetcher.fetchDocument(testSource(), 'https://papers.example.org/b.pdf', 'pdf'), /HTTP status 500/);
});

test('requests to the same host are spaced by the minimum interval', async () => {
  const { fetcher, sleeps } = harness({ 'https://papers.example.org/a.pdf': [pdfResponse], 'https://papers.example.org/b.pdf': [pdfResponse] });
  await fetcher.fetchDocument(testSource(), 'https://papers.example.org/a.pdf', 'pdf');
  await fetcher.fetchDocument(testSource(), 'https://papers.example.org/b.pdf', 'pdf');
  assert.ok(sleeps.filter((ms) => ms === 5_000).length >= 2, `throttled: ${sleeps}`);
});

test('content type and PDF signature are checked', async () => {
  const { fetcher } = harness({
    'https://papers.example.org/html.pdf': [{ status: 200, headers: { 'content-type': 'text/html' }, body: new TextEncoder().encode('<html>') }],
    'https://papers.example.org/fake.pdf': [{ status: 200, headers: { 'content-type': 'application/pdf' }, body: new TextEncoder().encode('MZ\x90\x00 not a pdf') }],
  });
  await assert.rejects(fetcher.fetchDocument(testSource(), 'https://papers.example.org/html.pdf', 'pdf'), /content type/);
  await assert.rejects(fetcher.fetchDocument(testSource(), 'https://papers.example.org/fake.pdf', 'pdf'), /not a PDF/);
});

test('the real transport refuses hostnames that resolve to loopback (DNS-level SSRF guard)', async () => {
  const transport = createSafeHttpsTransport();
  await assert.rejects(
    transport({ url: new URL('https://localhost/secret'), headers: {}, timeoutMs: 5_000, maxBytes: 1024 }),
    (err: NodeJS.ErrnoException) => err.code === 'EBLOCKEDADDRESS'
  );
});

test('source registry: NTA is registered but disabled pending permission; unknown sources are refused', () => {
  const nta = getSource('nta-jee-main');
  assert.ok(nta);
  assert.equal(nta.reuse.status, 'permission_required');
  assert.equal(nta.fetchEnabled, false);
  assert.equal(nta.importEnabled, false);
  assert.throws(() => assertSourceAllows('nta-jee-main', 'fetch'), SourceNotPermittedError);
  assert.throws(() => assertSourceAllows('nta-jee-main', 'import'), SourceNotPermittedError);
  assert.throws(() => assertSourceAllows('some-coaching-site', 'import'), SourceNotPermittedError);
  assert.throws(() => assertSourceAllows('manual-upload', 'fetch'), SourceNotPermittedError);
  assert.equal(assertSourceAllows('manual-upload', 'import').id, 'manual-upload');
});

test('HTML link extraction ignores scripts, comments and non-http links and resolves relative URLs', () => {
  const html = `
    <script>var a = '<a href="https://evil.example/x.pdf">x</a>';</script>
    <!-- <a href="/hidden.pdf">hidden</a> -->
    <a class="dl" href="/uploads/2026/key.pdf">Final Answer Key &amp; Notice</a>
    <a href='paper.pdf'><span>Paper</span> 1</a>
    <a href=javascript:alert(1)>bad</a>
    <a href="mailto:a@b.c">mail</a>
    <a href="/uploads/2026/key.pdf#page=2">Final Answer Key &amp; Notice</a>`;
  const links = extractLinks(html, 'https://jeemain.nta.nic.in/notices/');
  assert.deepEqual(links, [
    { url: 'https://jeemain.nta.nic.in/uploads/2026/key.pdf', text: 'Final Answer Key & Notice' },
    { url: 'https://jeemain.nta.nic.in/notices/paper.pdf', text: 'Paper 1' },
  ]);
});
