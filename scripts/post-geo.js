// ── Every post with an address, on the Buildings map (Miriam, 6 Nov 2026: "put all posts from past and future Chutznik that
//    have an address show on the map"). The droplet knows every building's address from the squares it handed the site; it
//    reads the posts, finds a street and number that really exist ("Shamgar 12", "12 Panim Meirot", "שמגר 12") and hands the
//    site where each post belongs. Only an address that matches a real building counts — a bare street or a guess never does.
'use strict';
const SITE = (process.env.INGEST_URL || 'https://chutznik.org/api/ingest-whatsapp').replace(/\/api\/.*/, '');
const KEY = process.env.INGEST_KEY || '';
let LOG = (s) => console.log(s);
const ROWS = 16, COLS = 14;

const normHe = (s) => String(s || '').replace(/["'״׳`]/g, '').replace(/^(?:רחוב|רח|שדרות|שד)\s+/, '').replace(/\s+/g, ' ').trim();
const normEn = (s) => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/\b(?:st|street|str|rd|road|rechov|rehov|blvd|ave|avenue)\b\.?/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const skel = (s) => normEn(s).replace(/\bha\s*/g, '').replace(/tz|ts|z/g, 'z').replace(/ch|kh|h/g, 'h').replace(/v|w/g, 'v').replace(/k|q|c/g, 'k').replace(/[aeiouy ]/g, '').replace(/(.)\1+/g, '$1');

// the address book: Hebrew street → number → place; and every English spelling the map knows for that street
function buildIndex(tiles, cityNames) {
  const addr = new Map();
  for (const t of tiles) {
    if (!t || !Array.isArray(t.b) || !Array.isArray(t.o)) continue;
    const o = t.o, sc = t.sc || 1e5;
    for (const x of t.b) {
      const a = String(x[3] || ''); if (a.indexOf('|') < 0) continue;
      const [st, numS] = a.split('|'); const k = normHe(st); if (!k || !numS) continue;
      let y = 0, xx = 0, cy = 0, cx = 0, n = 0; for (let q = 4; q + 1 < x.length; q += 2) { y += x[q]; xx += x[q + 1]; cy += y; cx += xx; n++; }
      if (!n) continue;
      const lat = +(o[0] + cy / n / sc).toFixed(6), lon = +(o[1] + cx / n / sc).toFixed(6);
      const m = addr.get(k) || new Map(); addr.set(k, m);
      const parts = String(numS).split(/[–\-,]/).map((p) => p.trim()).filter(Boolean);
      const nums = new Set([String(numS).trim()]);
      for (const p of parts) { nums.add(p); const d = (p.match(/^\d+/) || [])[0]; if (d) nums.add(d); }
      if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) && +parts[1] > +parts[0] && +parts[1] - +parts[0] <= 8) for (let v = +parts[0]; v <= +parts[1]; v++) nums.add(String(v));
      for (const v of nums) if (!m.has(v)) m.set(v, [lat, lon, st + ' ' + numS]);
    }
  }
  const en = new Map(), sk = new Map(), enName = new Map();
  for (const nm of cityNames || []) {
    const e = nm && nm[0], h = nm && nm[1]; if (!e || !h) continue; const hk = normHe(h); if (!addr.has(hk)) continue;
    en.set(normEn(e), hk); enName.set(hk, e);
    const s = skel(e); if (s.length >= 3) { if (sk.has(s) && sk.get(s) !== hk) sk.set(s, null); else sk.set(s, hk); }
  }
  return { addr, en, sk, enName };
}

const HE_RE = /([\u05d0-\u05ea][\u05d0-\u05ea"'׳״\- ]{1,30}?)\s+(\d{1,3}[\u05d0-\u05ea]?)(?![\d:\/.]\d|\s*(?:ש"ח|שח|₪|%|שקל|דקות|שעות|חדרים|קומה))/g;
const EN_A = /\b([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,3})\s+(?:St\.?|Street|Rd\.?|Road)?\s*#?(\d{1,3}[a-zA-Z]?)\b(?![:\/.,]?\d|\s*(?:am|pm|nis|₪|%|shekel|rooms?|bdrm|bedrooms?|years?|yrs|min|minutes|hours?|kg|cm|m2|sqm|people|kids|children|floor|th\b|st\b|nd\b|rd\b))/g;
const EN_B = /(?:^|[^\d₪$:\/.])(\d{1,3}[a-zA-Z]?)\s+([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,3})/g;

const NOT_STREET = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday|shabbos|shabbat|day|week|room|rooms|bus|line|floor|apt|apartment|age|ages|grade|size|page|chapter|kislev|tishrei|cheshvan|teves|tevet|shevat|adar|nissan|iyar|sivan|tammuz|av|elul)$/;
function lookupStreet(ix, words, he) {
  for (let k = Math.min(4, words.length); k >= 1; k--) {
    const cand = words.slice(-k).join(' ');
    if (he) { const h = normHe(cand); if (ix.addr.has(h)) return h; const h2 = h.replace(/^[בלמה]/, ''); if (h2 !== h && ix.addr.has(h2)) return h2; continue; }
    const e = normEn(cand); if (!e || NOT_STREET.test(e)) continue;   // "Nov 6" is a date, though Jerusalem has a Nov Street
    if (ix.en.has(e)) return ix.en.get(e);
    const s = skel(cand); if (s.length >= 4 && ix.sk.get(s)) return ix.sk.get(s);
  }
  return null;
}
function findAddress(ix, text) {
  const t = String(text || '').replace(/<[^>]+>/g, ' ').slice(0, 6000);
  const hit = (hk, num) => { const m = ix.addr.get(hk); if (!m) return null; const n = String(num).replace(/[a-z]$/i, ''); const g = m.get(String(num)) || m.get(n); return g ? { lat: g[0], lon: g[1], label: (ix.enName.get(hk) || hk) + ' ' + num } : null; };
  let m;
  HE_RE.lastIndex = 0; while ((m = HE_RE.exec(t))) { const words = m[1].trim().split(/\s+/); const hk = lookupStreet(ix, words, true); if (hk) { const g = hit(hk, m[2]); if (g) return g; } }
  EN_A.lastIndex = 0; while ((m = EN_A.exec(t))) { const words = m[1].trim().split(/\s+/); const hk = lookupStreet(ix, words, false); if (hk) { const g = hit(hk, m[2]); if (g) return g; } }
  EN_B.lastIndex = 0; while ((m = EN_B.exec(t))) { const words = m[2].trim().split(/\s+/); for (let k = Math.min(4, words.length); k >= 1; k--) { const hk = lookupStreet(ix, words.slice(0, k), false); if (hk) { const g = hit(hk, m[1]); if (g) return g; break; } } }
  return null;
}
function geocodePosts(ix, updates, posts) {
  const out = {};
  const each = (p, key) => {
    if (!p || p.deleted || (p.status && p.status !== 'public')) return;
    const g = findAddress(ix, [p.title, p.memo, p.contactAddress, p.picText].filter(Boolean).join('\n'));
    if (g) out[key] = [g.lat, g.lon, g.label.slice(0, 60)];
  };
  for (const u of updates || []) each(u, 'up_' + u.id);
  for (const p of posts || []) if (p && !p._ad && !p._cfg) each(p, String(p.id));
  return out;
}

async function getJson(url) { try { const r = await fetch(url, { headers: { 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' }, signal: AbortSignal.timeout(120000) }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
let _running = false;
async function run() {
  if (_running) return; _running = true;
  try {
    const city = await getJson(SITE + '/api/live-data?type=buildings&part=city');
    const tiles = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const t = await getJson(SITE + '/api/live-data?type=buildings&part=tile&t=' + r + '_' + c); if (t && Array.isArray(t.b) && t.b.length) tiles.push(t); }
    if (!tiles.length) { LOG('📍 post map: no building squares yet'); return; }
    const ix = buildIndex(tiles, city && city.names);
    const [ups, posts] = await Promise.all([getJson(SITE + '/api/live-data?type=updates&t=' + Date.now()), getJson(SITE + '/api/live-data?type=posts&t=' + Date.now())]);
    if (!Array.isArray(ups)) { LOG('📍 post map: could not read the posts'); return; }
    const map = geocodePosts(ix, ups, Array.isArray(posts) ? posts : []);
    const n = Object.keys(map).length;
    const r = await fetch(SITE + '/api/live-data?type=buildings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' }, body: JSON.stringify({ postgeo: { at: Date.now(), map } }), signal: AbortSignal.timeout(60000) });
    LOG('📍 post map: ' + n + ' posts with an address placed (' + ix.addr.size + ' streets known)' + (r.ok ? '' : ' — the site answered ' + r.status));
  } catch (e) { LOG('📍 post map: ' + (e && e.message)); } finally { _running = false; }
}
function start(log) { if (log) LOG = log; setTimeout(() => run().catch(() => {}), 8 * 60 * 1000); setInterval(() => run().catch(() => {}), 3 * 3600 * 1000); }
module.exports = { start, run, buildIndex, findAddress, geocodePosts, normEn, normHe, skel };
