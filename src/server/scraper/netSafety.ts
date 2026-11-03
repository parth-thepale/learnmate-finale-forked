import net from 'net';

/**
 * SSRF protection for the question importer. Only https URLs on a source's exact allow-listed
 * hostnames are fetched, and every resolved address is checked so that a hostname can never point
 * the server at localhost, private networks or cloud metadata endpoints.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

function ipv4ToInt(address: string): number {
  return address.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4Range(address: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(address) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local incl. 169.254.169.254 cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function expandIpv6(address: string): number[] | null {
  let addr = address.toLowerCase();
  const zone = addr.indexOf('%');
  if (zone >= 0) addr = addr.slice(0, zone);
  let tailV4: number[] = [];
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (net.isIPv4(tail) !== true) return null;
    const v = ipv4ToInt(tail);
    tailV4 = [(v >>> 16) & 0xffff, v & 0xffff];
    addr = addr.slice(0, lastColon + 1) + '0:0';
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const parts = [...head, ...Array(fill).fill('0'), ...rest].map((h) => parseInt(h || '0', 16));
  if (parts.length !== 8 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 0xffff)) return null;
  if (tailV4.length) {
    parts[6] = tailV4[0];
    parts[7] = tailV4[1];
  }
  return parts;
}

/** True for any address the importer must never connect to. Unknown formats are blocked. */
export function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) return BLOCKED_V4.some(([base, bits]) => inV4Range(address, base, bits));
  if (!net.isIPv6(address)) return true;
  const p = expandIpv6(address);
  if (!p) return true;
  const allZeroPrefix = p.slice(0, 5).every((x) => x === 0);
  if (p.every((x) => x === 0)) return true; // ::
  if (allZeroPrefix && p[5] === 0 && p[6] === 0 && p[7] === 1) return true; // ::1
  if (allZeroPrefix && (p[5] === 0xffff || p[5] === 0)) {
    // IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible (::a.b.c.d): judge the embedded IPv4.
    const v4 = `${p[6] >>> 8}.${p[6] & 0xff}.${p[7] >>> 8}.${p[7] & 0xff}`;
    return isBlockedAddress(v4);
  }
  if (p[0] === 0x64 && p[1] === 0xff9b) return true; // NAT64 can reach IPv4 internals
  if ((p[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (incl. fd00:ec2::254 metadata)
  if ((p[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((p[0] & 0xff00) === 0xff00) return true; // multicast
  if (p[0] === 0x2001 && p[1] === 0x0db8) return true; // documentation
  if (p[0] === 0x0100 && p[1] === 0 && p[2] === 0 && p[3] === 0) return true; // discard-only
  if (p[0] === 0x2002) return true; // 6to4 can embed private IPv4
  return false;
}

/**
 * Validates a URL for fetching: https only, default port, no credentials, a hostname (never an IP
 * literal) that is exactly one of the allowed hosts.
 */
export function validateFetchUrl(raw: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Not a valid URL.');
  }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('Only https URLs may be fetched.');
  if (url.username || url.password) throw new UnsafeUrlError('URLs with credentials are not allowed.');
  if (url.port && url.port !== '443') throw new UnsafeUrlError('Non-standard ports are not allowed.');
  const host = url.hostname.toLowerCase();
  if (!host || host.endsWith('.')) throw new UnsafeUrlError('Invalid hostname.');
  if (net.isIP(host.replace(/^\[|\]$/g, ''))) throw new UnsafeUrlError('IP address URLs are not allowed.');
  if (!allowedHosts.map((h) => h.toLowerCase()).includes(host)) {
    throw new UnsafeUrlError(`Host "${host}" is not on this source's allow-list.`);
  }
  url.hash = '';
  return url;
}
