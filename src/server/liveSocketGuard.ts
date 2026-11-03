/**
 * Guards for the /api/live WebSocket (voice tutor): origin validation and per-user session caps.
 * Authentication itself happens on the first socket message ({ type: 'auth', token }) because
 * browsers cannot attach an Authorization header to WebSocket upgrades.
 */

export const LIVE_SOCKET_LIMITS = Object.freeze({
  authTimeoutMs: 5_000,
  maxSessionMs: 10 * 60 * 1000,
  maxPayloadBytes: 512 * 1024,
  maxSessionsPerUser: 1,
  sessionQuotaUnits: 10,
});

function toOrigin(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Builds the explicit origin allow-list from ALLOWED_ORIGINS (comma-separated) and APP_URL. */
export function parseAllowedOrigins(env: Record<string, string | undefined>): Set<string> {
  const origins = new Set<string>();
  const raw = [env.ALLOWED_ORIGINS || '', env.APP_URL || ''].join(',');
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === 'MY_APP_URL') continue;
    const origin = toOrigin(trimmed);
    if (origin) origins.add(origin);
  }
  return origins;
}

/**
 * A browser WebSocket upgrade is accepted only when its Origin is the app's own host or an
 * explicitly allowed origin. Requests without an Origin header (non-browser clients) are rejected.
 */
export function isOriginAllowed(
  originHeader: string | undefined,
  hostHeader: string | undefined,
  allowedOrigins: ReadonlySet<string>
): boolean {
  if (!originHeader) return false;
  const origin = toOrigin(originHeader);
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  if (!hostHeader) return false;
  try {
    return new URL(origin).host === hostHeader.trim().toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Mirrors Express `trust proxy = <hops>` semantics for raw upgrade requests: walk back `hops`
 * entries from the connecting address through X-Forwarded-For.
 */
export function clientIpFromForwarded(
  forwardedFor: string | string[] | undefined,
  remoteAddress: string | undefined,
  trustedHops: number
): string {
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor || '';
  const chain = [
    ...header
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    remoteAddress || 'unknown',
  ];
  const index = Math.max(0, chain.length - 1 - Math.max(0, trustedHops));
  return chain[index];
}

export class LiveSessionRegistry {
  private readonly active = new Map<string, number>();

  constructor(private readonly maxPerUser: number = LIVE_SOCKET_LIMITS.maxSessionsPerUser) {}

  tryAcquire(uid: string): boolean {
    const current = this.active.get(uid) ?? 0;
    if (current >= this.maxPerUser) return false;
    this.active.set(uid, current + 1);
    return true;
  }

  release(uid: string): void {
    const current = this.active.get(uid) ?? 0;
    if (current <= 1) this.active.delete(uid);
    else this.active.set(uid, current - 1);
  }

  count(uid: string): number {
    return this.active.get(uid) ?? 0;
  }
}
