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
  for (const host of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
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

const fs = require('fs'), path = require('path');
const CACHE = path.join(__dirname, '..', 'special-places-cache.json');
// three smaller questions instead of one big one (6 Nov: the big one timed out); each answer is remembered, so one that fails
// leaves the others' places on the map
async function places() {
  const bb = BBOX.join(',');
  const KR = 'מאוחדת|כללית|מכבי|לאומית|[Mm]euhedet|[Mm]euchedet|[Cc]lalit|[Mm]accabi|[Ll]eumit';
  const Q = {
    rail: '[out:json][timeout:120];(way["railway"="light_rail"](' + bb + ');nwr["amenity"="bus_station"](' + bb + ');nwr["name:en"="Western Wall"](' + bb + ');nwr["name"="הכותל המערבי"](' + bb + '););out geom tags;',
    hospitals: '[out:json][timeout:150];nwr["amenity"="hospital"](' + bb + ');out geom tags;',
    // every park and garden, and the playgrounds that carry a name (Miriam, 9 Nov 2026: "add all the parks, find them all")
    parks: '[out:json][timeout:180];(nwr["leisure"~"^(park|garden)$"](' + bb + ');nwr["leisure"="playground"]["name"](' + bb + '););out geom tags;',
    // every shul (Miriam, 9 Nov 2026: "there are so many shuls missing"): jewish places of worship, synagogue buildings, and
    // anything named beit knesset / beit midrash; a point each (the map colours the building the point falls in)
    shuls: '[out:json][timeout:180];(nwr["amenity"="place_of_worship"]["religion"="jewish"](' + bb + ');nwr["building"="synagogue"](' + bb + ');nwr["amenity"="place_of_worship"]["name"~"בית ?ה?כנסת|בית ?ה?מדרש|ביהכ|ביהמ|[Ss]ynagogue|[Ss]hul|[Bb]ei[st] ?[KkMm]"](' + bb + '););out center tags;',
    kupot: '[out:json][timeout:150];(nwr["name"~"' + KR + '"]["amenity"~"^(clinic|doctors|pharmacy|hospital|dentist)$"](' + bb + ');nwr["name"~"' + KR + '"]["healthcare"](' + bb + ');nwr["brand"~"' + KR + '"](' + bb + ');nwr["operator"~"' + KR + '"]["amenity"~"^(clinic|doctors|pharmacy|dentist)$"](' + bb + ');nwr["name"~"^קופת חולים"](' + bb + '););out geom tags;',
  };
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) {}
  const missing = [];
  for (const [g, q] of Object.entries(Q)) {
    const j = await overpass(q);
    if (j && Array.isArray(j.elements)) cache[g] = { at: Date.now(), elements: j.elements }; else missing.push(g);
    await new Promise((ok) => setTimeout(ok, 20 * 1000));
  }
  try { fs.writeFileSync(CACHE, JSON.stringify(cache)); } catch (e) {}
  const elements = [].concat(...Object.keys(Q).map((g) => (cache[g] && cache[g].elements) || []));
  return { f: elements.length ? parse(elements) : null, missing };
}
function parse(elements) {
  const j = { elements };
  const f = []; const seen = new Set();
  for (const el of j.elements) {
    const t = el.tags || {}; const id = el.type[0] + el.id; if (seen.has(id)) continue;
    let k = '', extra = {};
    if (t.railway === 'light_rail') { if (t.service) continue; k = 'rail'; }
    else if (t.amenity === 'hospital') k = 'hospital';
    else if (/^(park|garden|playground)$/.test(t.leisure || '')) { if (t.leisure === 'playground' && !t.name && !t['name:en']) continue; k = 'park'; }
    else if (t['name:en'] === 'Western Wall' || t.name === 'הכותל המערבי') k = 'kotel';
    else if (t.amenity === 'bus_station') { if (!/מרכזית|central/i.test([t.name, t['name:en']].join(' '))) continue; k = 'cbs'; }
    else if (t.amenity === 'place_of_worship' || t.building === 'synagogue') {
      const s = [t.name, t['name:en'], t['name:he']].filter(Boolean).join(' | '); const hit = SHUL.find(([, re]) => re.test(s));
      if (t.religion && t.religion !== 'jewish') continue;
      if (!hit && t.building !== 'synagogue' && t.religion !== 'jewish' && !/בית ?ה?כנסת|בית ?ה?מדרש|ביהכ|ביהמ|synagogue|shul|bei[st] ?[km]/i.test(s)) continue;
      k = 'shul'; if (hit) extra.shul = hit[0]; }
    else { const kp = kupahOf(t); if (!kp) continue; k = 'kupah'; extra.brand = kp; }
    seen.add(id);
    const nm = nameOf(t), ad = addrOf(t);
    if (k === 'rail') { const R = rings(el)[0] || []; if (R.length < 2) continue; f.push({ k, id, line: simplify(R, 0.00002).map((p) => [r6(p[0]), r6(p[1])]) }); continue; }
    const c = centre(el); if (!c) continue;
    const item = Object.assign({ k, id, nm, ad, pt: [r6(c[0]), r6(c[1])] }, extra);
    if (el.type !== 'node' && !(k === 'shul' && !extra.shul)) { const R = joinRings(rings(el)).filter((r) => r.length >= 4 && Math.abs(r[0][0] - r[r.length - 1][0]) < 1e-9 && Math.abs(r[0][1] - r[r.length - 1][1]) < 1e-9).map((r) => simplifyRing(r, 0.000008).map((p) => [r6(p[0]), r6(p[1])])); if (R.length) item.polys = R.slice(0, 12); }
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
  await wikipedia(key, out);   // a site that turns the droplet away still has its logo and a few words on Wikipedia
  if (!home.html) return out;
  out.pages.push({ url: home.url, status: home.status, html: home.html });
  const html = home.html; const icons = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) { const tag = m[0]; if (!/rel=["'][^"']*(apple-touch-icon|icon)[^"']*["']/i.test(tag)) continue; const h = (tag.match(/href=["']([^"']+)["']/i) || [])[1]; if (h) icons.push({ how: (tag.match(/rel=["']([^"']+)["']/i) || [])[1], sizes: (tag.match(/sizes=["']([^"']+)["']/i) || [])[1] || '', url: abs(home.url, h) }); }
  for (const m of html.matchAll(/<meta\b[^>]*property=["']og:image["'][^>]*>/gi)) { const h = (m[0].match(/content=["']([^"']+)["']/i) || [])[1]; if (h) icons.push({ how: 'og:image', url: abs(home.url, h) }); }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) { const tag = m[0]; if (!/logo/i.test(tag)) continue; const h = (tag.match(/src=["']([^"']+)["']/i) || [])[1]; if (h) icons.push({ how: 'img logo', url: abs(home.url, h) }); if (icons.length > 14) break; }
  icons.push({ how: 'favicon', url: abs(home.url, '/favicon.ico') });
  const seenI = new Set();
  for (const ic of icons) { if (!ic.url || seenI.has(ic.url)) continue; seenI.add(ic.url); const im = await getImage(ic.url); if (im) out.logos.push(Object.assign({ how: ic.how, sizes: ic.sizes || '' }, im)); if (out.logos.length >= 7) break; }
  // the pages about branches, on the kupah's own site
  const links = []; const host = new URL(home.url).host;
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) { const u = abs(home.url, m[1]); const txt = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    try { if (new URL(u).host !== host) continue; } catch (e) { continue; }
    if (/סניפ|מרפאו?ת|איתור|branch|clinic|find/i.test(txt + ' ' + u) && !links.includes(u)) links.push(u); }
  const sm = await getText(abs(home.url, '/robots.txt')); out.pages.push({ url: sm.url, status: sm.status, html: sm.html.slice(0, 20000) });
  // the site's own list of its pages (its sitemap, which robots.txt points to): the ones about contact, branches or Jerusalem
  const maps = [...(sm.html || '').matchAll(/sitemap:\s*(\S+)/gi)].map((m) => m[1]); if (!maps.length) maps.push(abs(home.url, '/sitemap.xml'));
  const locs = []; const seenM = new Set();
  for (let i = 0; i < maps.length && i < 6; i++) { const u = maps[i]; if (seenM.has(u)) continue; seenM.add(u); const x = await getText(u); if (!x.html) continue;
    const L = [...x.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
    if (/<sitemapindex/i.test(x.html)) { for (const s2 of L) if (maps.length < 8) maps.push(s2); } else locs.push(...L); }
  out.sitemapCount = locs.length;
  const want = (u) => { let d = u; try { d = decodeURIComponent(u); } catch (e) {} return /contact|צור[-_ ]?קשר|branch|snif|סניפ|ירושלים|jerusalem|מוקד|call[-_ ]?cent/i.test(d); };
  for (const u of [...new Set(links.concat(locs.filter(want)))].slice(0, 6)) { const p = await getText(u); out.pages.push({ url: p.url, status: p.status, error: p.error, html: p.html }); }
  return out;
}
// Hebrew Wikipedia's article on the kupah: its picture (the logo) and its opening lines
const WIKI = { meuhedet: 'מאוחדת קופת חולים', clalit: 'כללית שירותי בריאות', maccabi: 'מכבי שירותי בריאות', leumit: 'לאומית שירותי בריאות' };
const WIKI_EN = { meuhedet: 'Meuhedet', clalit: 'Clalit Health Services', maccabi: 'Maccabi Healthcare Services', leumit: 'Leumit Health Services' };
async function wikipedia(key, out) { await wiki1('he', WIKI[key], out); await wiki1('en', WIKI_EN[key], out); }
async function wiki1(lang, q, out) {
  try {
    const u = 'https://' + lang + '.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=1&gsrsearch=' + encodeURIComponent(q) + '&prop=pageimages|extracts|info&inprop=url&piprop=thumbnail|name&pithumbsize=160&exintro=1&explaintext=1';
    const r = await fetch(u, { headers: { 'User-Agent': 'chutznik-bridge (info@chutznik.org)' }, signal: AbortSignal.timeout(30000) }); if (!r.ok) return;
    const j = await r.json(); const pg = j && j.query && j.query.pages && Object.values(j.query.pages)[0]; if (!pg) return;
    out.pages.push({ url: pg.fullurl || ('wikipedia:' + pg.title), status: 200, html: 'TITLE: ' + pg.title + '\nIMAGE: ' + (pg.pageimage || '') + '\n\n' + String(pg.extract || '').slice(0, 6000) });
    if (pg.thumbnail && pg.thumbnail.source) { const im = await getImage(pg.thumbnail.source); if (im) out.logos.push(Object.assign({ how: 'wikipedia', sizes: lang, file: pg.pageimage || '' }, im)); }
  } catch (e) {}
}

async function post(body) {
  const r = await fetch(SITE + '/api/live-data?type=buildings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  return r.status;
}
let _running = false, _retry = null;
async function run() {
  if (_running) return; _running = true;
  try {
    const P = await places(); const f = P.f;
    const logos = {}; const web = {};
    for (const k of Object.keys(KUPOT)) { const w = await website(k); web[k] = w; if (w.logos.length) logos[k] = w.logos.map((l) => ({ how: l.how, sizes: l.sizes, type: l.type, size: l.size, url: l.url, file: l.file, data: l.data })); }
    // the logos are handed over even when OpenStreetMap is busy; the site keeps the places it had
    const st = await post({ special: { at: Date.now(), f: f || [], logos } }); const by = {}; for (const x of f || []) by[x.k] = (by[x.k] || 0) + 1;
    LOG('⭐ special places: ' + (f ? f.length : 0) + ' (' + Object.entries(by).map(([k, n]) => k + ' ' + n).join(', ') + '), logos for ' + (Object.keys(logos).join(', ') || 'none') + (P.missing.length ? ' — OpenStreetMap did not answer for ' + P.missing.join(', ') + ', asked again in an hour' : '') + (st === 200 ? '' : ' — the site answered ' + st));
    clearTimeout(_retry); if (P.missing.length) _retry = setTimeout(() => run().catch(() => {}), 60 * 60 * 1000);
    for (const k of Object.keys(web)) { const st2 = await post({ kupahweb: { key: k, at: Date.now(), home: web[k].home, pages: web[k].pages } }).catch(() => 0);
      LOG('⭐ ' + k + ' website: ' + (web[k].home.status || web[k].home.error) + ', ' + web[k].pages.length + ' page(s) (' + (web[k].sitemapCount || 0) + ' in its sitemap), ' + web[k].logos.length + ' logo(s)' + (st2 === 200 ? '' : ' — the site answered ' + st2)); }
  } catch (e) { LOG('⭐ special places: ' + (e && e.message)); } finally { _running = false; }
}
function start(log) { if (log) LOG = log; setTimeout(() => run().catch(() => {}), 2 * 60 * 1000); setInterval(() => run().catch(() => {}), 24 * 3600 * 1000); }
module.exports = { start, run, places, parse, website, kupahOf };
