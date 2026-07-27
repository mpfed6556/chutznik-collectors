// scripts/updates-sync.js
// Runs on GitHub's servers (GitHub Actions) every few hours, with ZERO involvement.
// For each organization in feeds-config.json:
//   1. Checks robots.txt first (same rules as the rental sync — never scrapes a
//      site that says no; failures are recorded, not fatal)
//   2. Finds the org's RSS/Atom feed automatically (autodiscovery from the page),
//      or falls back to scanning the news page for article links
//   3. Takes only NEW items (permanent dedupe by link), keeps the newest few
//   4. Produces a SHORT ENGLISH summary: English sources are trimmed to ~2
//      sentences; Hebrew items are machine-translated when the free translation
//      service responds, otherwise kept with a [Hebrew] marker so the admin can
//      decide (translation quality is best-effort — see notes in chat)
//   5. Sends each as a PENDING item to Chutznik — nothing appears publicly until
//      the admin clicks Publish on the site
// A feeds-status.json report is committed each run showing which orgs worked,
// which were blocked, and which had no discoverable feed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { checkAllowed } = require('./robots');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'feeds-config.json'), 'utf8'));
const SEEN_FILE = path.join(__dirname, '..', 'seen-updates.json');
const STATUS_FILE = path.join(__dirname, '..', 'feeds-status.json');

function loadJSON(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fb; } }
const SEEN = new Set(loadJSON(SEEN_FILE, []));
const STATUS = {};
const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'ChutznikUpdates/1.0 (+community info feed; low-rate; respectful)' };

function fingerprint(link, title) {
  return crypto.createHash('sha256').update((link || '') + '|' + (title || '')).digest('hex').slice(0, 24);
}

const stripHtml = (h) => cheerio.load('<div>' + (h || '') + '</div>')('div').text().replace(/\s+/g, ' ').trim();
const hasHebrew = (t) => /[\u0590-\u05FF]/.test(t || '');

// Best-effort free translation (no API key). If it fails, we keep the original.
async function translateToEnglish(text) {
  const q = (text || '').slice(0, 450);
  if (!q) return '';
  try {
    const r = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) + '&langpair=he|en', { headers: UA });
    if (!r.ok) return '';
    const j = await r.json();
    const out = j && j.responseData && j.responseData.translatedText ? String(j.responseData.translatedText) : '';
    // The service sometimes echoes errors as "text"; sanity-check it looks like English
    if (out && !hasHebrew(out) && !/MYMEMORY|QUOTA|INVALID/i.test(out)) return out.trim();
    return '';
  } catch (e) { return ''; }
}

// Short English summary: first ~2 sentences, hard cap ~240 chars.
function summarizeEnglish(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const sentences = t.match(/[^.!?]+[.!?]+/g) || [t];
  let out = sentences.slice(0, 2).join(' ').trim();
  if (out.length > 240) out = out.slice(0, 240).replace(/\s+\S*$/, '') + '…';
  return out;
}

// ── Find the RSS/Atom feed for a page (autodiscovery), else null ─────────────
async function discoverFeed(pageUrl, html) {
  const $ = cheerio.load(html);
  const linkEl = $('link[type="application/rss+xml"], link[type="application/atom+xml"]').first();
  if (linkEl.length) {
    let href = linkEl.attr('href');
    try { return new URL(href, pageUrl).href; } catch (e) { return null; }
  }
  // Common conventional paths as a fallback probe (one attempt each)
  for (const guess of ['/rss', '/feed', '/rss.xml', '/feed.xml']) {
    try {
      const u = new URL(guess, pageUrl).href;
      const r = await fetch(u, { headers: UA });
      if (r.ok) {
        const t = await r.text();
        if (/<(rss|feed)[\s>]/i.test(t)) return u;
      }
    } catch (e) {}
  }
  return null;
}

function parseFeedItems(xml, baseUrl) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];
  $('item, entry').each((i, el) => {
    if (i >= 6) return;
    const $el = $(el);
    const title = stripHtml($el.find('title').first().text());
    let link = $el.find('link').first().text().trim();
    if (!link) link = $el.find('link').first().attr('href') || '';
    try { link = new URL(link, baseUrl).href; } catch (e) {}
    const desc = stripHtml($el.find('description, summary, content').first().text());
    const pub = $el.find('pubDate, published, updated').first().text().trim();
    if (title && link) items.push({ title, link, desc, published: pub ? Date.parse(pub) || Date.now() : Date.now() });
  });
  return items;
}

// Fallback: scan a news/home page for likely article links (best-effort)
function scanPageForItems(html, pageUrl) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const items = [];
  $('a').each((i, el) => {
    if (items.length >= 5) return;
    const $a = $(el);
    const text = $a.text().replace(/\s+/g, ' ').trim();
    let href = $a.attr('href') || '';
    if (!text || text.length < 25 || text.length > 200) return; // headlines are medium-length
    if (!/news|update|press|article|item|hodaa|announce|Pages\/|\/he\/|\/en\//i.test(href)) return;
    try { href = new URL(href, pageUrl).href; } catch (e) { return; }
    if (seen.has(href)) return;
    seen.add(href);
    items.push({ title: text, link: href, desc: '', published: Date.now() });
  });
  return items;
}

// Pull the org's real logo from its own page: og:image, apple-touch-icon, an
// <img> that looks like a logo, or the biggest declared icon — first hit wins.
function extractLogo(html, pageUrl) {
  try {
    const $ = cheerio.load(html);
    const cands = [];
    const og = $('meta[property="og:image"], meta[name="og:image"]').attr('content');
    if (og) cands.push(og);
    $('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').each((i, el) => {
      const h = $(el).attr('href'); if (h) cands.push(h);
    });
    $('img').each((i, el) => {
      if (cands.length > 6 || i > 80) return;
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      const idc = (($(el).attr('class') || '') + ' ' + ($(el).attr('id') || '') + ' ' + ($(el).attr('alt') || '') + ' ' + src).toLowerCase();
      if (/logo/.test(idc) && src) cands.push(src);
    });
    $('link[rel="icon"], link[rel="shortcut icon"]').each((i, el) => {
      const h = $(el).attr('href'); if (h) cands.push(h);
    });
    for (const cnd of cands) {
      try {
        const abs = new URL(cnd, pageUrl).href;
        if (/^https?:\/\//.test(abs)) return abs;
      } catch (e) {}
    }
  } catch (e) {}
  return '';
}

const LOGOS = {}; // domain -> { n: name, d: domain, logo: url }

async function collectOrg(org) {
  const permission = await checkAllowed(org.page);
  if (!permission.allowed) {
    STATUS[org.name] = 'blocked: ' + permission.reason;
    log('BLOCKED ' + org.name + ' — ' + permission.reason);
    return [];
  }
  let html;
  try {
    const r = await fetch(org.page, { headers: UA, redirect: 'follow' });
    if (!r.ok) { STATUS[org.name] = 'page HTTP ' + r.status; return []; }
    html = await r.text();
  } catch (e) { STATUS[org.name] = 'unreachable: ' + e.message; return []; }

  // Grab the org's logo from this same page, and DOWNLOAD the image itself so
  // the site can store its own copy (visitors then load logos from Chutznik —
  // instant, cached, no external requests, works forever).
  try {
    const dom = new URL(org.page).hostname;
    const lg = extractLogo(html, org.page);
    const entry = { n: org.name, d: dom, logo: lg };
    if (lg) {
      try {
        const ir = await fetch(lg, { headers: UA });
        const ct = (ir.headers.get('content-type') || '').toLowerCase();
        if (ir.ok && /image\//.test(ct)) {
          const buf = Buffer.from(await ir.arrayBuffer());
          if (buf.length > 100 && buf.length <= 90000) { // sane size only
            entry.image = buf.toString('base64');
            entry.ext = ct.includes('svg') ? 'svg' : ct.includes('png') ? 'png' : ct.includes('gif') ? 'gif' : ct.includes('webp') ? 'webp' : ct.includes('icon') ? 'ico' : 'jpg';
          }
        }
      } catch (e) {}
    }
    LOGOS[dom] = entry;
  } catch (e) {}

  let items = [];
  const feedUrl = org.feedUrl || await discoverFeed(org.page, html);
  if (feedUrl) {
    try {
      const fr = await fetch(feedUrl, { headers: UA });
      if (fr.ok) items = parseFeedItems(await fr.text(), feedUrl);
      STATUS[org.name] = items.length ? ('ok via RSS (' + items.length + ' items)') : 'RSS found but empty';
    } catch (e) { STATUS[org.name] = 'RSS fetch failed'; }
  }
  if (!items.length) {
    items = scanPageForItems(html, org.page);
    if (items.length) STATUS[org.name] = 'ok via page-scan (' + items.length + ' items) — no RSS found';
    else if (!STATUS[org.name]) STATUS[org.name] = 'no feed and no scannable items — needs manual selector or has no public news list';
  }
  return items.slice(0, 4).map((it) => ({ ...it, _org: org }));
}

async function buildUpdateItem(raw) {
  const org = raw._org;
  let title = raw.title || '';
  let body = raw.desc || '';
  // English-only output: translate Hebrew (best-effort), else trim English.
  if (hasHebrew(title)) {
    const t = await translateToEnglish(title);
    title = t || ('[Hebrew] ' + title);
  }
  if (hasHebrew(body)) {
    const t = await translateToEnglish(body);
    body = t || '';
  }
  const summary = summarizeEnglish(body) || summarizeEnglish(title);
  return {
    source: 'official-updates',
    group: org.name,
    author: org.name,
    title: ('' + title).slice(0, 150),
    memo: (summary + '\n\nRead the full update: ' + raw.link).slice(0, 1200),
    types: Array.isArray(org.types) && org.types.length ? org.types.slice(0, 3) : ['Community'],
    area: '',
    communities: [],
    contactWebsite: raw.link,
    created: raw.published || Date.now(),
    status: 'pending',
    dedupeKey: fingerprint(raw.link, raw.title),
  };
}

async function forward(item) {
  try {
    const res = await fetch(process.env.INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-key': process.env.INGEST_KEY },
      body: JSON.stringify({ file: 'updates', item }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.added) log('  queued for review: [' + item.group + '] "' + item.title.slice(0, 60) + '"');
    else if (res.ok) log('  duplicate skipped: "' + item.title.slice(0, 50) + '"');
    else log('  ingest error ' + res.status + ': ' + (j.error || ''));
  } catch (e) { log('  could not reach Chutznik: ' + e.message); }
}

async function main() {
  if (!process.env.INGEST_URL || !process.env.INGEST_KEY) { console.error('Missing INGEST_URL/INGEST_KEY secrets'); process.exit(1); }
  log('=== Chutznik official-updates sync starting ===');
  let queued = 0;
  for (const org of CONFIG.feeds) {
    if (org.enabled === false) continue;
    const raws = await collectOrg(org);
    for (const raw of raws) {
      const key = fingerprint(raw.link, raw.title);
      if (SEEN.has(key)) continue;
      SEEN.add(key);
      const item = await buildUpdateItem(raw);
      await forward(item);
      queued++;
      await sleep(CONFIG.minDelayMs || 2500);
    }
    await sleep(CONFIG.minDelayMs || 2500);
  }
  // Publish the collected real logos to the site (drives the top marquee)
  try {
    const logoList = Object.values(LOGOS);
    if (logoList.length) {
      const r = await fetch(process.env.INGEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ingest-key': process.env.INGEST_KEY },
        body: JSON.stringify({ action: 'logos', logos: logoList }),
      });
      log('logo list published: ' + logoList.length + ' orgs (HTTP ' + r.status + ')');
    }
  } catch (e) { log('logo publish failed: ' + e.message); }

  fs.writeFileSync(SEEN_FILE, JSON.stringify(Array.from(SEEN).slice(-30000)));
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ lastRun: new Date().toISOString(), orgs: STATUS }, null, 2));
  log('=== Done — ' + queued + ' new item(s) queued for admin review. Per-org status written to feeds-status.json ===');
}

main();
