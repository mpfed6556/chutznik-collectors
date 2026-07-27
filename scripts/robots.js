// robots.js — checks a site's robots.txt before we touch it.
// This is THE standard way sites say "crawlers/scrapers welcome" or "not welcome."
// We fetch it once per site, cache it, and use it to decide:
//   1. Is this path allowed for a generic bot (User-agent: *)?
//   2. How fast are we allowed to go (Crawl-delay)?
// If a site disallows the paths we need, or has no robots.txt reachable in a way
// that suggests active blocking, we skip that site entirely and say why.

const cache = new Map(); // origin -> { rules, fetchedAt }
const CACHE_MS = 6 * 3600 * 1000; // re-check every 6 hours in case a site changes its mind

function parseRobots(text) {
  // Minimal robots.txt parser: collects Disallow/Allow rules for User-agent: *
  // (and our own UA if named), plus Crawl-delay.
  const lines = text.split(/\r?\n/);
  let inRelevantGroup = false;
  let sawAnyGroup = false;
  const disallow = [];
  const allow = [];
  let crawlDelay = 0;

  for (let raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = (rawKey || '').trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'user-agent') {
      sawAnyGroup = true;
      inRelevantGroup = (val === '*' || /chutznik/i.test(val));
      continue;
    }
    if (!inRelevantGroup) continue;
    if (key === 'disallow' && val) disallow.push(val);
    if (key === 'allow' && val) allow.push(val);
    if (key === 'crawl-delay') crawlDelay = parseFloat(val) || 0;
  }
  return { disallow, allow, crawlDelay, hadRules: sawAnyGroup };
}

async function getRobots(origin) {
  const cached = cache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.rules;
  let rules = { disallow: [], allow: [], crawlDelay: 1, hadRules: false, reachable: false };
  try {
    const r = await fetch(origin.replace(/\/$/, '') + '/robots.txt', {
      headers: { 'User-Agent': 'ChutznikRentalAggregator/1.0 (+respectful, low-rate, read-only)' },
    });
    if (r.ok) {
      const text = await r.text();
      rules = { ...parseRobots(text), reachable: true };
    } else if (r.status === 404) {
      // No robots.txt at all = no stated restriction. Proceed, but stay gentle.
      rules.reachable = true;
    }
  } catch (e) {
    // Couldn't even reach robots.txt — be conservative and treat as blocked.
    rules.reachable = false;
  }
  cache.set(origin, { rules, fetchedAt: Date.now() });
  return rules;
}

// Returns { allowed: bool, reason: string, crawlDelay: number }
async function checkAllowed(pageUrl) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch (e) { return { allowed: false, reason: 'invalid URL' }; }
  const path = new URL(pageUrl).pathname;
  const rules = await getRobots(origin);

  if (!rules.reachable) {
    return { allowed: false, reason: 'robots.txt unreachable — skipping to be safe' };
  }
  // Longest-match wins between allow/disallow (standard robots.txt behavior)
  const matchLen = (patterns) => Math.max(0, ...patterns
    .filter(p => path.startsWith(p.replace(/\*.*$/, '')))
    .map(p => p.length));
  const disallowLen = matchLen(rules.disallow);
  const allowLen = matchLen(rules.allow);
  const blocked = disallowLen > 0 && disallowLen >= allowLen;

  if (blocked) {
    return { allowed: false, reason: 'robots.txt disallows this path', crawlDelay: rules.crawlDelay };
  }
  return { allowed: true, reason: rules.hadRules ? 'robots.txt allows this' : 'no robots.txt restrictions found', crawlDelay: rules.crawlDelay || 1 };
}

module.exports = { checkAllowed, getRobots };
