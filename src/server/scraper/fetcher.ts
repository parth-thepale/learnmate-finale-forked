import { createHash } from 'crypto';
import dns from 'dns';
import https from 'https';
import type { LookupAddress } from 'dns';
import { isBlockedAddress, UnsafeUrlError, validateFetchUrl } from './netSafety';
import { robotsPolicyForResponse, type RobotsPolicy } from './robots';
import type { SourceDefinition, SourceDocument } from './types';

/**
 * Polite, SSRF-safe document fetcher used only by administrative import scripts (never by a public
 * HTTP endpoint). It never sends cookies or credentials and never executes downloaded content.
 */

export interface TransportRequest {
  url: URL;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export type HttpTransport = (request: TransportRequest) => Promise<TransportResponse>;

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows fetching ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

/** DNS lookup that refuses hostnames resolving to private, loopback or metadata addresses. */
function checkedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
): void {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      const blocked = Object.assign(new Error(`Refusing to connect: ${hostname} resolves to a non-public address.`), {
        code: 'EBLOCKEDADDRESS',
      });
      return callback(blocked, '');
    }
    if (options && options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

/** Default transport: Node https with the checked lookup, a hard deadline and a size cap. */
export function createSafeHttpsTransport(): HttpTransport {
  return (request) =>
    new Promise<TransportResponse>((resolve, reject) => {
      const agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
      const req = https.request(
        request.url,
        {
          method: 'GET',
          headers: request.headers,
          agent,
          lookup: checkedLookup as unknown as typeof dns.lookup,
          timeout: request.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > request.maxBytes) {
              req.destroy(new FetchError(`Response exceeds ${request.maxBytes} bytes.`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            clearTimeout(deadline);
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              if (typeof v === 'string') headers[k.toLowerCase()] = v;
              else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(', ');
            }
            resolve({ status: res.statusCode ?? 0, headers, body: new Uint8Array(Buffer.concat(chunks)) });
          });
          res.on('error', (e) => {
            clearTimeout(deadline);
            reject(e);
          });
        }
      );
      const deadline = setTimeout(() => req.destroy(new FetchError('Request timed out.')), request.timeoutMs);
      req.on('timeout', () => req.destroy(new FetchError('Request timed out.')));
      req.on('error', (e) => {
        clearTimeout(deadline);
        reject(e);
      });
      req.end();
    });
}

export interface PoliteFetcherOptions {
  userAgent: string;
  transport?: HttpTransport;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum gap between requests to the same host. */
  minIntervalMs?: number;
  maxRedirects?: number;
  maxRetries?: number;
  timeoutMs?: number;
  maxBytes?: number;
}

const EXPECTED_TYPES = {
  pdf: { mime: 'application/pdf' as const, matches: (t: string) => t.startsWith('application/pdf') },
  html: { mime: 'text/html' as const, matches: (t: string) => t.startsWith('text/html') },
};

export class PoliteFetcher {
  private readonly transport: HttpTransport;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly maxRedirects: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly lastRequestAt = new Map<string, number>();
  private readonly robotsCache = new Map<string, RobotsPolicy>();

  constructor(private readonly options: PoliteFetcherOptions) {
    this.transport = options.transport ?? createSafeHttpsTransport();
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.minIntervalMs = options.minIntervalMs ?? 5_000;
    this.maxRedirects = options.maxRedirects ?? 3;
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
  }

  private async throttle(host: string): Promise<void> {
    const last = this.lastRequestAt.get(host);
    if (last !== undefined) {
      const wait = last + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastRequestAt.set(host, this.now());
  }

  private async request(url: URL, maxBytes: number): Promise<TransportResponse> {
    let attempt = 0;
    for (;;) {
      await this.throttle(url.hostname);
      try {
        const response = await this.transport({
          url,
          headers: {
            'User-Agent': this.options.userAgent,
            Accept: 'application/pdf, text/html;q=0.9, text/plain;q=0.5',
            'Accept-Encoding': 'identity',
          },
          timeoutMs: this.timeoutMs,
          maxBytes,
        });
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= this.maxRetries) return response;
        const retryAfter = Number(response.headers['retry-after']);
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : this.backoff(attempt));
      } catch (err) {
        if ((err as { code?: string }).code === 'EBLOCKEDADDRESS' || err instanceof UnsafeUrlError) throw err;
        if (attempt >= this.maxRetries) throw new FetchError(`Request failed: ${err instanceof Error ? err.message : 'unknown error'}`);
        await this.sleep(this.backoff(attempt));
      }
      attempt++;
    }
  }

  private backoff(attempt: number): number {
    return Math.min(30_000, 2_000 * 2 ** attempt);
  }

  private async robotsFor(url: URL): Promise<RobotsPolicy> {
    const cached = this.robotsCache.get(url.host);
    if (cached) return cached;
    let policy: RobotsPolicy;
    try {
      const res = await this.request(new URL('/robots.txt', url.origin), 512 * 1024);
      const isRedirect = res.status >= 300 && res.status < 400;
      policy = robotsPolicyForResponse(isRedirect ? null : res.status, new TextDecoder().decode(res.body), this.options.userAgent);
    } catch (err) {
      if ((err as { code?: string }).code === 'EBLOCKEDADDRESS') throw err;
      policy = robotsPolicyForResponse(null, '', this.options.userAgent);
    }
    this.robotsCache.set(url.host, policy);
    return policy;
  }

  /** Fetches one document from an enabled source, enforcing allow-list, robots and type checks. */
  async fetchDocument(source: SourceDefinition, rawUrl: string, expect: 'pdf' | 'html'): Promise<SourceDocument> {
    if (!source.fetchEnabled) throw new FetchError(`Fetching is disabled for source "${source.id}".`);
    let url = validateFetchUrl(rawUrl, source.allowedHosts);

    for (let redirects = 0; ; redirects++) {
      const robots = await this.robotsFor(url);
      if (!robots.isAllowed(url.pathname + url.search)) throw new RobotsDisallowedError(url.toString());

      const response = await this.request(url, this.maxBytes);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers['location'];
        if (!location) throw new FetchError('Redirect without a Location header.', response.status);
        if (redirects >= this.maxRedirects) throw new FetchError('Too many redirects.', response.status);
        url = validateFetchUrl(new URL(location, url).toString(), source.allowedHosts);
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new FetchError(`Unexpected HTTP status ${response.status}.`, response.status);
      }

      const contentType = (response.headers['content-type'] || '').toLowerCase();
      const expected = EXPECTED_TYPES[expect];
      if (!expected.matches(contentType)) throw new FetchError(`Unexpected content type "${contentType || 'none'}".`);
      if (expect === 'pdf' && new TextDecoder().decode(response.body.slice(0, 5)) !== '%PDF-') {
        throw new FetchError('Downloaded file is not a PDF.');
      }

      return {
        sourceId: source.id,
        url: url.toString(),
        fileName: decodeURIComponent(url.pathname.split('/').pop() || 'document'),
        bytes: response.body,
        sha256: createHash('sha256').update(response.body).digest('hex'),
        retrievedAt: new Date(this.now()).toISOString(),
        contentType: expected.mime,
      };
    }
  }
}
