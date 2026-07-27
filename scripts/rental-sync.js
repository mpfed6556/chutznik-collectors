// scripts/rental-sync.js
// Runs entirely on GitHub's own servers via GitHub Actions — NOT on your
// computer. You never start it, stop it, or keep anything open. GitHub runs
// it on the schedule set in .github/workflows/rental-sync.yml (default: every
// hour) whether your computer is on, off, or you're on vacation.
//
// Each run:
//   1. Reads the sites you've configured in scripts/sites-config.json
//   2. Checks each site's robots.txt first — skips (and remembers) any site
//      that says automated tools aren't welcome there
//   3. Scrapes the ones that allow it, using the CSS selectors you set
//   4. Filters to your Jewish-areas allowlist (areas.js) — skips anything else
//   5. Forwards new, non-duplicate listings to Chutznik via the SAME
//      /api/ingest-whatsapp endpoint the WhatsApp bridge uses — so external
//      rental posts get identical treatment (single unified feed, "external"
//      tag, admin edit/delete, full comments) with zero extra site code
//
// "Seen" memory (dedupe) is stored in a file in THIS repo (seen-rentals.json)
// and committed back automatically after each run — so it's permanent and
// shared across every run, no local computer or storage needed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { detectJewishAreas } = require('./areas');
const { checkAllowed } = require('./robots');

const CONFIG_PATH = path.join(__dirname, 'sites-config.json');
const CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const SEEN_FILE = path.join(__dirname, '..', 'seen-rentals.json');
const BLOCKED_FILE = path.join(__dirname, '..', 'blocked-sites.json');

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
const SEEN = new Set(loadJSON(SEEN_FILE, []));
let BLOCKED = loadJSON(BLOCKED_FILE, {});

function log(msg) { console.log('[' + new Date().toISOString() + '] ' + msg); }

function fingerprint(listing) {
  const norm = [
    (listing.title || '').toLowerCase().trim(),
    (listing.phone || '').replace(/\D/g, ''),
    (listing.price || ''),
    (listing.address || listing.area || ''),
  ].join('|');
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 24);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrapeSite(site) {
  const RECHECK_BLOCKED_MS = 24 * 3600 * 1000;
  const already = BLOCKED[site.listUrl];
  if (already && Date.now() - already.checkedAt < RECHECK_BLOCKED_MS) {
    log('skip ' + site.name + ': still blocked (' + already.reason + ')');
    return [];
  }
  const permission = await checkAllowed(site.listUrl);
  if (!permission.allowed) {
    BLOCKED[site.listUrl] = { reason: permission.reason, checkedAt: Date.now() };
    log('blocked ' + site.name + ': ' + permission.reason);
    return [];
  }
  if (BLOCKED[site.listUrl]) delete BLOCKED[site.listUrl];

  const crawlDelayMs = Math.max((permission.crawlDelay || 0) * 1000, CONFIG.minDelayMs || 2000);
  log('allowed ' + site.name + ': ' + permission.reason);

  let html;
  try {
    const r = await fetch(site.listUrl, {
      headers: { 'User-Agent': 'ChutznikRentalSync/1.0 (+respectful, low-rate, read-only, runs hourly via GitHub Actions)' },
    });
    if (!r.ok) { log('  HTTP ' + r.status + ' from ' + site.name); return []; }
    html = await r.text();
  } catch (e) {
    log('  fetch failed for ' + site.name + ': ' + e.message);
    return [];
  }

  const $ = cheerio.load(html);
  const sel = site.selectors || {};
  const items = [];
  $(sel.item || '.listing').each((i, el) => {
    const $el = $(el);
    const get = (s) => (s ? $el.find(s).first().text().trim() : '');
    const images = [];
    if (sel.image) {
      $el.find(sel.image).each((j, imgEl) => {
        const src = $(imgEl).attr('src') || $(imgEl).attr('data-src');
        if (src) { try { images.push(new URL(src, site.listUrl).href); } catch (e) { images.push(src); } }
      });
    }
    let website = '';
    if (sel.website) website = get(sel.website);
    else if (sel.link) {
      let href = $el.find(sel.link).first().attr('href');
      if (href && !/^https?:\/\//i.test(href)) { try { href = new URL(href, site.listUrl).href; } catch (e) {} }
      website = href || '';
    }
    items.push({
      title: get(sel.title),
      description: get(sel.description),
      price: get(sel.price),
      phone: get(sel.phone),
      website,
      images,
      address: get(sel.address) || (get(sel.title) + ' ' + get(sel.description)),
    });
  });
  log('  found ' + items.length + ' raw listing(s)');
  return items.map((it) => Object.assign({}, it, { _sourceSite: site.name, _crawlDelayMs: crawlDelayMs }));
}

function buildItem(listing) {
  const title = (listing.title || '').toString().trim();
  const description = (listing.description || '').toString().trim();
  const fullText = title + ' ' + description + ' ' + (listing.address || '');
  const areas = detectJewishAreas(fullText);
  if (!areas.length) return null;

  const phone = (listing.phone || '').toString().trim();
  const website = (listing.website || '').toString().trim();
  const images = Array.isArray(listing.images) ? listing.images : [];
  const attachments = images.slice(0, 10).map((url) => ({ type: 'image', url: String(url) }));
  const price = listing.price || '';
  const finalTitle = title || ('Rental in ' + areas[0] + (price ? ' - ' + price : ''));
  const finalMemo = description || ('Rental in ' + areas.join(', ') + (price ? ', ' + price : '') + '.');

  const item = {
    source: 'rental-aggregator',
    group: listing._sourceSite || 'Rental Sync',
    title: finalTitle.slice(0, 160),
    memo: finalMemo.slice(0, 4000),
    types: ['Rental'],
    area: areas[0],
    communities: areas,
    author: 'Rental listing',
    contactPhone: phone,
    contactWebsite: website,
    attachments,
    created: Date.now(),
  };
  item.dedupeKey = fingerprint({ title: finalTitle, phone, price, address: areas[0] });
  return item;
}

async function forward(item) {
  const ingestUrl = process.env.INGEST_URL;
  const ingestKey = process.env.INGEST_KEY;
  try {
    const res = await fetch(ingestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-key': ingestKey },
      body: JSON.stringify({ item }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.added) log('  forwarded: "' + item.title + '" (' + item.area + ')');
    else if (res.ok) log('  duplicate skipped: "' + item.title + '"');
    else log('  ingest error ' + res.status + ': ' + (j.error || ''));
  } catch (e) {
    log('  could not reach Chutznik: ' + e.message);
  }
}

async function main() {
  if (!process.env.INGEST_URL || !process.env.INGEST_KEY) {
    console.error('Missing INGEST_URL / INGEST_KEY secrets in GitHub Actions settings.');
    process.exit(1);
  }
  log('=== Chutznik rental sync run (GitHub Actions) starting ===');
  const sites = Array.isArray(CONFIG.sites) ? CONFIG.sites : [];
  if (!sites.length) { log('No sites configured in scripts/sites-config.json — nothing to do.'); return; }

  let allListings = [];
  for (const site of sites) {
    const items = await scrapeSite(site);
    allListings = allListings.concat(items);
    if (items.length && items[0]._crawlDelayMs) await sleep(items[0]._crawlDelayMs);
  }

  let sent = 0, skippedDup = 0, skippedArea = 0;
  for (const raw of allListings) {
    const item = buildItem(raw);
    if (!item) { skippedArea++; continue; }
    if (SEEN.has(item.dedupeKey)) { skippedDup++; continue; }
    SEEN.add(item.dedupeKey);
    await forward(item);
    sent++;
    await sleep(CONFIG.minDelayMs || 1500);
  }

  saveJSON(SEEN_FILE, Array.from(SEEN).slice(-20000));
  saveJSON(BLOCKED_FILE, BLOCKED);
  log('=== Run complete: ' + sent + ' forwarded, ' + skippedDup + ' already-seen, ' + skippedArea + ' outside Jewish-area list ===');
}

main();
