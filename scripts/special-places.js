// ── The places that stand out on the Buildings map (Miriam, 6 Nov 2026: "make the Kosel and the line of the current light rail a
//    different colour, and the tachana merkazit, Belz shul, Ger shul, Boyaner shul and all hospitals; mark all Meuchedet buildings with
//    a little Meuchedet logo that opens one main Meuchedet post — the same for all the kupos").
//    Once a day the droplet asks OpenStreetMap for them and hands the site a short list: the hospitals' grounds, the light rail as it
//    runs today (not the lines still being built), the Kotel, the central bus station, the three shuls, and every branch of the four
//    kupos. It also reads each kupah's own website — its logo for the map, and its branch pages, which the site keeps for the admin.
'use strict';
const SITE = (process.env.INGEST_URL || 'https://chutznik.org/api/ingest-whatsapp').replace(/\/api\/.*/, '');
const KEY = process.env.INGEST_KEY || '';
let LOG = (s) => console.log(s);
const BBOX = [31.70, 35.13, 31.86, 35.27];
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36';

const KUPOT = {
  meuhedet: { re: /מאוחדת|meuhedet|meuchedet|meuhedeth/i, site: 'https://www.meuhedet.co.il/' },
  clalit: { re: /כללית|clalit/i, site: 'https://www.clalit.co.il/he/Pages/default.aspx' },
  maccabi: { re: /מכבי\s*(?:שירותי בריאות|פארם|דנט|טבעי)|^מכבי$|maccabi\s*(?:health|healthcare|pharm|dent)|kupat holim maccabi|^maccabi$/i, site: 'https://www.maccabi4u.co.il/' },
  leumit: { re: /(?:^|קופ[תה]?\s*חולים\s*|שירותי בריאות\s*)לאומית|לאומית\s*שירותי|^לאומית|leumit/i, site: 'https://www.leumit.co.il/' },
};
const kupahOf = (t) => { const s = [t.brand, t.operator, t.name, t['name:he'], t['name:en']].filter(Boolean).join(' | '); for (const [k, K] of Object.entries(KUPOT)) { for (const part of s.split(' | ')) if (K.re.test(part.trim())) return k; } return ''; };
const SHUL = [['belz', /בעלז|belz/i], ['gur', /חסידי\s*גור|(?:^|\s)גור(?:\s|$)|\bgur\b|\bger\b/i], ['boyan', /בויאן|boyan/i]];

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const stack = [[0, pts.length - 1]];
  while (stack.length) { const [a, b] = stack.pop(); let best = -1, bi = -1; const [y1, x1] = pts[a], [y2, x2] = pts[b]; const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * (pts[i][1] - x1) - dx * (pts[i][0] - y1)) / L; if (d > best) { best = d; bi = i; } }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); } }
  return pts.filter((_, i) => keep[i]);
}
// a closed outline is cut in two at its farthest corner first, so the simplifying never folds it flat
function simplifyRing(pts, tol) {
  if (pts.length > 2 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-9 && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-9) pts = pts.slice(0, -1);
  if (pts.length < 4) return pts;
  let far = 1, best = -1; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > best) { best = d; far = i; } }
  const a = simplify(pts.slice(0, far + 1), tol), b = simplify(pts.slice(far).concat([pts[0]]), tol);
  return a.concat(b.slice(1, -1));
}
const r6 = (v) => +(+v).toFixed(6);
async function overpass(q) {
  for (const host of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try { const r = await fetch(host, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'chutznik-bridge map (info@chutznik.org)' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(240000) });
      if (r.ok) return await r.json(); LOG('⭐ special places: ' + host + ' answered ' + r.status); } catch (e) { LOG('⭐ special places: ' + host + ' — ' + (e && e.message)); }
  }
  return null;
}
// the outline(s) of a way or a relation (a hospital's grounds are often a relation of several parts)
function rings(el) {
  if (el.type === 'way' && Array.isArray(el.geometry)) return [el.geometry.map((p) => [p.lat, p.lon])];
  if (el.type === 'relation' && Array.isArray(el.members)) return el.members.filter((m) => m.type === 'way' && Array.isArray(m.geometry) && m.role !== 'inner').map((m) => m.geometry.map((p) => [p.lat, p.lon]));
  return [];
}
// the open pieces of a relation's outline joined end to end into closed rings (a line stays a line: only closed rings are kept)
function joinRings(parts) {
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9; const out = []; const left = parts.map((p) => p.slice());
  while (left.length) { let ring = left.shift(); let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) { grew = false;
      for (let i = 0; i < left.length; i++) { const p = left[i]; const end = ring[ring.length - 1];
        if (same(p[0], end)) { ring = ring.concat(p.slice(1)); } else if (same(p[p.length - 1], end)) { ring = ring.concat(p.slice(0, -1).reverse()); } else continue;
        left.splice(i, 1); grew = true; break; } }
    out.push(ring); }
  return out;
}
const centre = (el) => { if (el.type === 'node') return [el.lat, el.lon]; if (el.center) return [el.center.lat, el.center.lon]; const R = rings(el).flat(); if (!R.length) return null; return [R.reduce((a, p) => a + p[0], 0) / R.length, R.reduce((a, p) => a + p[1], 0) / R.length]; };
const nameOf = (t) => String(t['name:en'] || t.name || t['name:he'] || '').slice(0, 80);
const addrOf = (t) => t['addr:street'] ? (String(t['addr:street']).slice(0, 40) + (t['addr:housenumber'] ? ' ' + String(t['addr:housenumber']).slice(0, 8) : '')) : '';

async function places() {
  const bb = BBOX.join(',');
  const KR = 'מאוחדת|כללית|מכבי|לאומית|[Mm]euhedet|[Mm]euchedet|[Cc]lalit|[Mm]accabi|[Ll]eumit';
  const q = '[out:json][timeout:200];('
    + 'nwr["amenity"="hospital"](' + bb + ');'
    + 'way["railway"="light_rail"](' + bb + ');'
    + 'nwr["amenity"="bus_station"](' + bb + ');'
    + 'nwr["name:en"="Western Wall"](' + bb + ');nwr["name"="הכותל המערבי"](' + bb + ');'
    + 'nwr["amenity"="place_of_worship"]["name"~"בעלז|בויאן|גור|[Bb]elz|[Bb]oyan|[Gg]ur|[Gg]er "](' + bb + ');'
    + 'nwr["amenity"="place_of_worship"]["name:en"~"[Bb]elz|[Bb]oyan|[Gg]ur|[Gg]er "](' + bb + ');'
    + 'nwr["name"~"' + KR + '"]["amenity"~"^(clinic|doctors|pharmacy|hospital|dentist)$"](' + bb + ');'
    + 'nwr["name"~"' + KR + '"]["healthcare"](' + bb + ');'
    + 'nwr["brand"~"' + KR + '"](' + bb + ');nwr["operator"~"' + KR + '"]["amenity"~"^(clinic|doctors|pharmacy|dentist)$"](' + bb + ');'
    + 'nwr["name"~"^קופת חולים"](' + bb + ');'
    + ');out geom tags;';
  const j = await overpass(q); if (!j || !Array.isArray(j.elements)) return null;
  const f = []; const seen = new Set();
  for (const el of j.elements) {
    const t = el.tags || {}; const id = el.type[0] + el.id; if (seen.has(id)) continue;
    let k = '', extra = {};
    if (t.railway === 'light_rail') { if (t.service) continue; k = 'rail'; }
    else if (t.amenity === 'hospital') k = 'hospital';
    else if (t['name:en'] === 'Western Wall' || t.name === 'הכותל המערבי') k = 'kotel';
    else if (t.amenity === 'bus_station') { if (!/מרכזית|central/i.test([t.name, t['name:en']].join(' '))) continue; k = 'cbs'; }
    else if (t.amenity === 'place_of_worship') { const s = [t.name, t['name:en'], t['name:he']].filter(Boolean).join(' | '); const hit = SHUL.find(([, re]) => re.test(s)); if (!hit || t.religion && t.religion !== 'jewish') continue; k = 'shul'; extra.shul = hit[0]; }
    else { const kp = kupahOf(t); if (!kp) continue; k = 'kupah'; extra.brand = kp; }
    seen.add(id);
    const nm = nameOf(t), ad = addrOf(t);
    if (k === 'rail') { const R = rings(el)[0] || []; if (R.length < 2) continue; f.push({ k, id, line: simplify(R, 0.00002).map((p) => [r6(p[0]), r6(p[1])]) }); continue; }
    const c = centre(el); if (!c) continue;
    const item = Object.assign({ k, id, nm, ad, pt: [r6(c[0]), r6(c[1])] }, extra);
    if (el.type !== 'node') { const R = joinRings(rings(el)).filter((r) => r.length >= 4 && Math.abs(r[0][0] - r[r.length - 1][0]) < 1e-9 && Math.abs(r[0][1] - r[r.length - 1][1]) < 1e-9).map((r) => simplifyRing(r, 0.000008).map((p) => [r6(p[0]), r6(p[1])])); if (R.length) item.polys = R.slice(0, 12); }
    f.push(item);
  }
  return f;
}

// the kupah's own website: its logo, and the pages that list its branches (kept for the admin to look through)
async function getText(url) { try { const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'he,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(30000) }); return { url: r.url || url, status: r.status, type: r.headers.get('content-type') || '', html: r.ok ? (await r.text()).slice(0, 220000) : '' }; } catch (e) { return { url, status: 0, error: String(e && e.message || e).slice(0, 200), html: '' }; } }
async function getImage(url) {
  try { const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) }); if (!r.ok) return null;
    const type = (r.headers.get('content-type') || '').split(';')[0].trim(); if (!/^image\/(png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer()); if (!buf.length || buf.length > 90000) return null;
    return { url, type, size: buf.length, data: 'data:' + type + ';base64,' + buf.toString('base64') }; } catch (e) { return null; }
}
function abs(base, href) { try { return new URL(href.replace(/&amp;/g, '&'), base).href; } catch (e) { return ''; } }
async function website(key) {
  const K = KUPOT[key]; const home = await getText(K.site); const out = { home: { url: home.url, status: home.status, error: home.error }, pages: [], logos: [] };
  if (!home.html) return out;
  out.pages.push({ url: home.url, status: home.status, html: home.html });
  const html = home.html; const icons = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) { const tag = m[0]; if (!/rel=["'][^"']*(apple-touch-icon|icon)[^"']*["']/i.test(tag)) continue; const h = (tag.match(/href=["']([^"']+)["']/i) || [])[1]; if (h) icons.push({ how: (tag.match(/rel=["']([^"']+)["']/i) || [])[1], sizes: (tag.match(/sizes=["']([^"']+)["']/i) || [])[1] || '', url: abs(home.url, h) }); }
  for (const m of html.matchAll(/<meta\b[^>]*property=["']og:image["'][^>]*>/gi)) { const h = (m[0].match(/content=["']([^"']+)["']/i) || [])[1]; if (h) icons.push({ how: 'og:image', url: abs(home.url, h) }); }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) { const tag = m[0]; if (!/logo/i.test(tag)) continue; const h = (tag.match(/src=["']([^"']+)["']/i) || [])[1]; if (h) icons.push({ how: 'img logo', url: abs(home.url, h) }); if (icons.length > 14) break; }
  icons.push({ how: 'favicon', url: abs(home.url, '/favicon.ico') });
  const seenI = new Set();
  for (const ic of icons) { if (!ic.url || seenI.has(ic.url)) continue; seenI.add(ic.url); const im = await getImage(ic.url); if (im) out.logos.push(Object.assign({ how: ic.how, sizes: ic.sizes || '' }, im)); if (out.logos.length >= 5) break; }
  // the pages about branches, on the kupah's own site
  const links = []; const host = new URL(home.url).host;
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) { const u = abs(home.url, m[1]); const txt = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    try { if (new URL(u).host !== host) continue; } catch (e) { continue; }
    if (/סניפ|מרפאו?ת|איתור|branch|clinic|find/i.test(txt + ' ' + u) && !links.includes(u)) links.push(u); }
  for (const u of links.slice(0, 5)) { const p = await getText(u); out.pages.push({ url: p.url, status: p.status, error: p.error, html: p.html }); }
  const sm = await getText(abs(home.url, '/robots.txt')); out.pages.push({ url: sm.url, status: sm.status, html: sm.html.slice(0, 20000) });
  return out;
}

async function post(body) {
  const r = await fetch(SITE + '/api/live-data?type=buildings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  return r.status;
}
let _running = false;
async function run() {
  if (_running) return; _running = true;
  try {
    const f = await places();
    const logos = {}; const web = {};
    for (const k of Object.keys(KUPOT)) { const w = await website(k); web[k] = w; if (w.logos.length) logos[k] = w.logos.map((l) => ({ how: l.how, sizes: l.sizes, type: l.type, size: l.size, url: l.url, data: l.data })); }
    if (f) { const st = await post({ special: { at: Date.now(), f, logos } }); const by = {}; for (const x of f) by[x.k] = (by[x.k] || 0) + 1;
      LOG('⭐ special places: ' + f.length + ' (' + Object.entries(by).map(([k, n]) => k + ' ' + n).join(', ') + '), logos for ' + Object.keys(logos).join(', ') + (st === 200 ? '' : ' — the site answered ' + st)); }
    else LOG('⭐ special places: OpenStreetMap did not answer — tried again tomorrow');
    for (const k of Object.keys(web)) { const st = await post({ kupahweb: { key: k, at: Date.now(), home: web[k].home, pages: web[k].pages } }).catch(() => 0);
      LOG('⭐ ' + k + ' website: ' + (web[k].home.status || web[k].home.error) + ', ' + web[k].pages.length + ' page(s), ' + (web[k].logos.length) + ' logo(s)' + (st === 200 ? '' : ' — the site answered ' + st)); }
  } catch (e) { LOG('⭐ special places: ' + (e && e.message)); } finally { _running = false; }
}
function start(log) { if (log) LOG = log; setTimeout(() => run().catch(() => {}), 2 * 60 * 1000); setInterval(() => run().catch(() => {}), 24 * 3600 * 1000); }
module.exports = { start, run, places, website, kupahOf };
