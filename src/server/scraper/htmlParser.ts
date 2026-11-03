/**
 * Minimal, dependency-free HTML link extraction for paper listing pages. It reads anchors only;
 * scripts are stripped and never executed. Source adapters filter the links they need.
 */

export interface ExtractedLink {
  url: string;
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function extractLinks(html: string, baseUrl: string): ExtractedLink[] {
  const cleaned = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();
  const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(cleaned))) {
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(match[1]);
    if (!hrefMatch) continue;
    const rawHref = decodeHtmlEntities((hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '').trim());
    if (!rawHref || /^(javascript|data|vbscript|mailto|tel):/i.test(rawHref)) continue;
    let resolved: URL;
    try {
      resolved = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') continue;
    resolved.hash = '';
    const text = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const key = `${resolved.toString()}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ url: resolved.toString(), text });
  }
  return links;
}
