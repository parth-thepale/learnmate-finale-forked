/**
 * Minimal robots.txt (RFC 9309) support: groups by user-agent, Allow/Disallow with longest-match
 * precedence (Allow wins ties), "*" wildcards and "$" end anchors.
 */

interface Rule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  /** 'parsed' rules, 'allow_all' (no robots.txt), or 'disallow_all' (robots.txt unreachable). */
  mode: 'parsed' | 'allow_all' | 'disallow_all';
  isAllowed(pathWithQuery: string): boolean;
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function parseRobotsTxt(text: string, userAgentToken: string): RobotsPolicy {
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      if (field === 'disallow' && value === '') continue; // empty Disallow allows everything
      current.rules.push({ allow: field === 'allow', pattern: value });
    }
  }

  const token = userAgentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules).map((r) => ({ ...r, re: patternToRegExp(r.pattern) }));

  return {
    mode: 'parsed',
    isAllowed(path: string) {
      if (path === '/robots.txt') return true;
      let best: { allow: boolean; length: number } | null = null;
      for (const rule of rules) {
        if (!rule.re.test(path)) continue;
        const length = rule.pattern.length;
        if (!best || length > best.length || (length === best.length && rule.allow && !best.allow)) {
          best = { allow: rule.allow, length };
        }
      }
      return best ? best.allow : true;
    },
  };
}

export const ALLOW_ALL: RobotsPolicy = { mode: 'allow_all', isAllowed: () => true };
export const DISALLOW_ALL: RobotsPolicy = { mode: 'disallow_all', isAllowed: () => false };

/** RFC 9309: 4xx → no restrictions; 5xx or network failure → treat the site as fully disallowed. */
export function robotsPolicyForResponse(status: number | null, body: string, userAgentToken: string): RobotsPolicy {
  if (status !== null && status >= 200 && status < 300) return parseRobotsTxt(body, userAgentToken);
  if (status !== null && status >= 400 && status < 500) return ALLOW_ALL;
  return DISALLOW_ALL;
}
