// ── The real streets of Romema for the site's Buildings map (Miriam, 4 Nov 2026: "the map is terrible, totally not accurate").
//    The site cannot reach OpenStreetMap from where it runs; the droplet can. Once a month (and on the first start after this
//    file arrives) the named streets and named buildings in the Romema box are fetched from Overpass and handed to the site,
//    which draws its map from them. Nothing else changes on the droplet.
'use strict';
const fs = require('fs');
const path = require('path');
const MARK = path.join(__dirname, '..', 'romema-map.json');
const SITE = (process.env.INGEST_URL || 'https://chutznik.org/api/ingest-whatsapp').replace(/\/api\/.*/, '');
const KEY = process.env.INGEST_KEY || '';
// south, west, north, east — Romema with Kiryat Belz, Schneller and the bus station around it
const BBOX = [31.7885, 35.2005, 31.8035, 35.2225];
const ROADS = /^(primary|secondary|tertiary|residential|living_street|pedestrian|unclassified|primary_link|secondary_link|tertiary_link)$/;
let LOG = (s) => console.log(s);

async function fetchOsm() {
  const q = '[out:json][timeout:60];(way["highway"]["name"](' + BBOX.join(',') + ');way["building"]["name"](' + BBOX.join(',') + ');node["place"]["name"](' + BBOX.join(',') + '););out geom;';
  for (const host of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try {
      const r = await fetch(host, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'chutznik-bridge map (info@chutznik.org)' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(90000) });
      if (!r.ok) { LOG('🗺️ romema map: ' + host + ' answered ' + r.status); continue; }
      return await r.json();
    } catch (e) { LOG('🗺️ romema map: ' + host + ' — ' + (e && e.message)); }
  }
  return null;
}
function shape(j) {
  const els = Array.isArray(j && j.elements) ? j.elements : [];
  const streets = [], places = [];
  for (const el of els) {
    const t = el.tags || {}; const name = t['name:en'] || t['int_name'] || t.name || ''; const he = t['name:he'] || (/[א-ת]/.test(t.name || '') ? t.name : '');
    if (!name) continue;
    if (el.type === 'way' && t.highway && ROADS.test(t.highway) && Array.isArray(el.geometry) && el.geometry.length > 1) {
      streets.push({ name, he, kind: t.highway, pts: el.geometry.map((p) => [Number(p.lat.toFixed(6)), Number(p.lon.toFixed(6))]) });
    } else if (el.type === 'way' && t.building && Array.isArray(el.geometry) && el.geometry.length) {
      const lat = el.geometry.reduce((a, p) => a + p.lat, 0) / el.geometry.length, lon = el.geometry.reduce((a, p) => a + p.lon, 0) / el.geometry.length;
      places.push({ name, he, lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)), kind: 'building' });
    } else if (el.type === 'node' && t.place) {
      places.push({ name, he, lat: el.lat, lon: el.lon, kind: 'place' });
    }
  }
  return { bbox: BBOX, fetchedAt: Date.now(), streets, places };
}
async function run() {
  let mark = {}; try { mark = JSON.parse(fs.readFileSync(MARK, 'utf8')); } catch (e) {}
  if (mark.sentAt && Date.now() - mark.sentAt < 30 * 864e5) { await runCity(); return; }
  const j = await fetchOsm(); if (!j) return;
  const osm = shape(j);
  if (!osm.streets.length) { LOG('🗺️ romema map: no streets came back'); return; }
  try {
    const r = await fetch(SITE + '/api/live-data?type=buildings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' }, body: JSON.stringify({ osm }), signal: AbortSignal.timeout(30000) });
    const txt = await r.text().catch(() => '');
    if (!r.ok) { LOG('🗺️ romema map: the site answered ' + r.status + ' ' + txt.slice(0, 120)); return; }
    fs.writeFileSync(MARK, JSON.stringify(Object.assign(mark, { sentAt: Date.now(), streets: osm.streets.length, places: osm.places.length })));
    LOG('🗺️ romema map: ' + osm.streets.length + ' street segments and ' + osm.places.length + ' named places sent to the site');
  } catch (e) { LOG('🗺️ romema map: could not hand it to the site — ' + (e && e.message)); }
}
// ── the whole of Jerusalem (Miriam, 5 Nov 2026: "make it zoomable to show the whole Jerusalem") ──
// the main roads everywhere and every named street, simplified to a few metres and packed small, plus the neighbourhood names
const CITY_BBOX = [31.70, 35.13, 31.86, 35.27];
const KINDS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'pedestrian', 'unclassified'];
function simplify(pts, tol) {   // Douglas–Peucker on [lat, lon] in degrees
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const stack = [[0, pts.length - 1]];
  while (stack.length) { const [a, b] = stack.pop(); let best = -1, bi = -1; const [y1, x1] = pts[a], [y2, x2] = pts[b]; const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * (pts[i][1] - x1) - dx * (pts[i][0] - y1)) / L; if (d > best) { best = d; bi = i; } }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); } }
  return pts.filter((_, i) => keep[i]);
}
async function overpass(q) {
  for (const host of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try { const r = await fetch(host, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'chutznik-bridge map (info@chutznik.org)' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(240000) });
      if (r.ok) return await r.json(); LOG('🗺️ city map: ' + host + ' answered ' + r.status); } catch (e) { LOG('🗺️ city map: ' + host + ' — ' + (e && e.message)); }
  }
  return null;
}
async function runCity() {
  let mark = {}; try { mark = JSON.parse(fs.readFileSync(MARK, 'utf8')); } catch (e) {}
  if (mark.citySentAt && Date.now() - mark.citySentAt < 30 * 864e5) return;
  const bb = CITY_BBOX.join(',');
  const q = '[out:json][timeout:200];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"](' + bb + ');way["highway"~"^(residential|living_street|pedestrian|unclassified)$"]["name"](' + bb + ');node["place"~"^(suburb|neighbourhood|quarter)$"]["name"](' + bb + '););out geom;';
  const j = await overpass(q); if (!j || !Array.isArray(j.elements)) return;
  const LAT0 = CITY_BBOX[0], LON0 = CITY_BBOX[1], SC = 1e5; const names = [], nameIx = new Map(), roads = [], places = [];
  const nameOf = (en, he) => { const k = en + '|' + he; if (!nameIx.has(k)) { nameIx.set(k, names.length); names.push([en, he]); } return nameIx.get(k); };
  for (const el of j.elements) {
    const t = el.tags || {}; const he = t['name:he'] || (/[\u05d0-\u05ea]/.test(t.name || '') ? t.name : ''); const en = t['name:en'] || t['int_name'] || (he ? '' : (t.name || ''));
    if (el.type === 'way' && t.highway && Array.isArray(el.geometry) && el.geometry.length > 1) {
      const kind = KINDS.indexOf(String(t.highway).replace(/_link$/, '')); if (kind < 0) continue;
      const pts = simplify(el.geometry.map((p) => [p.lat, p.lon]), 0.00004);
      const flat = []; for (const [la, lo] of pts) flat.push(Math.round((la - LAT0) * SC), Math.round((lo - LON0) * SC));
      roads.push([(en || he) ? nameOf(en, he) : -1, kind].concat(flat));
    } else if (el.type === 'node' && t.place) places.push([en || t.name || '', he, Number(el.lat.toFixed(5)), Number(el.lon.toFixed(5)), t.place]);
  }
  const city = { v: 1, bbox: CITY_BBOX, o: [LAT0, LON0], sc: SC, kinds: KINDS, names, roads, places, fetchedAt: Date.now() };
  const body = JSON.stringify({ city });
  LOG('🗺️ city map: ' + roads.length + ' roads, ' + places.length + ' neighbourhoods, ' + Math.round(body.length / 1024) + ' KB');
  try {
    const r = await fetch(SITE + '/api/live-data?type=buildings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' }, body, signal: AbortSignal.timeout(60000) });
    const txt = await r.text().catch(() => '');
    if (!r.ok) { LOG('🗺️ city map: the site answered ' + r.status + ' ' + txt.slice(0, 160)); return; }
    mark.citySentAt = Date.now(); mark.cityRoads = roads.length; fs.writeFileSync(MARK, JSON.stringify(mark));
    LOG('🗺️ city map: sent to the site');
  } catch (e) { LOG('🗺️ city map: could not hand it to the site — ' + (e && e.message)); }
}
// ── every building in Jerusalem (Miriam, 5 Nov 2026: "every street should have outlines of buildings to select a building to
//    start a thread — every single building that exists today; the known ones shaded, like a store or the tachana merkazit or
//    the Kosel"). The city is cut into squares of 0.01° (about a kilometre); each square's buildings are fetched from Overpass
//    and handed to the site as a small file of its own, Romema's squares first. Shops, offices and shuls inside a building
//    give it its name when the building has none. Once a square has been sent it is fetched again after two months.
const GRID = 0.01, ROWS = Math.round((CITY_BBOX[2] - CITY_BBOX[0]) / GRID), COLS = Math.round((CITY_BBOX[3] - CITY_BBOX[1]) / GRID);
const NOT_OURS = /^(christian|muslim|islam|druze|bahai|buddhist|hindu)$/i;
function inPoly(lat, lon, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [yi, xi] = poly[i], [yj, xj] = poly[j]; if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) c = !c; } return c; }
function nameOfTags(t) { const he = t['name:he'] || (/[א-ת]/.test(t.name || '') ? t.name : ''); return String(t['name:en'] || t['int_name'] || (he ? '' : t.name) || he || '').slice(0, 60); }
function landmark(t) {
  if (t.historic || t.railway === 'station' || t.public_transport === 'station' || t.amenity === 'bus_station') return true;
  if (/^(train_station|transportation|hospital|university|government|museum|stadium)$/.test(t.building || '')) return true;
  if (/^(hospital|university|college|townhall|library|courthouse|theatre|place_of_worship)$/.test(t.amenity || '')) return true;
  if (/^(museum|attraction)$/.test(t.tourism || '')) return true;
  return false;
}
async function fetchTile(r, c) {
  const s = CITY_BBOX[0] + r * GRID, w = CITY_BBOX[1] + c * GRID, n = s + GRID, e = w + GRID, P = 0.0015;
  const bb = [s, w, n, e].map((v) => v.toFixed(4)).join(','), pb = [s - P, w - P, n + P, e + P].map((v) => v.toFixed(4)).join(',');
  const q = '[out:json][timeout:120];(way["building"](' + bb + ');way["name"]["historic"](' + bb + ');way["name"]["tourism"="attraction"](' + bb + '););out geom tags;'
    + '(node["name"]["shop"](' + pb + ');node["name"]["amenity"](' + pb + ');node["name"]["office"](' + pb + ');node["name"]["craft"](' + pb + ');node["name"]["healthcare"](' + pb + ');node["name"]["tourism"](' + pb + '););out tags;';
  const j = await overpass(q); if (!j || !Array.isArray(j.elements)) return null;
  const ways = [], pois = [];
  for (const el of j.elements) {
    if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) ways.push(el);
    else if (el.type === 'node' && el.tags && isFinite(el.lat)) pois.push(el);
  }
  const out = [];
  for (const el of ways) {
    const t = el.tags || {}; let pts = el.geometry.map((p) => [p.lat, p.lon]);
    const closed = pts.length > 3 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-9 && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-9;
    if (closed) pts = pts.slice(0, -1);
    // a named landmark that is not a building (the Kotel is a wall, a line; a plaza an area) — but not a whole district
    if (!t.building) { let y0 = 90, y1 = -90, x0 = 180, x1 = -180; for (const p of pts) { y0 = Math.min(y0, p[0]); y1 = Math.max(y1, p[0]); x0 = Math.min(x0, p[1]); x1 = Math.max(x1, p[1]); } if ((y1 - y0) > 0.004 || (x1 - x0) > 0.004) continue; }
    const cy = pts.reduce((a, p) => a + p[0], 0) / pts.length, cx = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    if (cy < s || cy >= n || cx < w || cx >= e) continue;   // each building belongs to the square its middle is in
    const notOurs = NOT_OURS.test(t.religion || '');
    let name = notOurs ? '' : nameOfTags(t); if (notOurs && !t.building) continue; let kind = !t.building ? (closed ? 2 : 4) : (!notOurs && landmark(t)) ? 2 : name ? 1 : 0;   // 0 a building, 1 known (a name, a shop inside), 2 a landmark, 4 a landmark drawn as a line
    // the shops and offices inside it
    const inside = []; if (t.building && closed) for (const p of pois) { if (NOT_OURS.test((p.tags || {}).religion || '')) continue; if (inPoly(p.lat, p.lon, pts)) inside.push(p); }
    if (inside.length) { if (!kind) kind = 1; if (!name) { name = nameOfTags(inside[0].tags); if (inside.length > 1) name += ' +' + (inside.length - 1); } if (inside.some((p) => landmark(p.tags))) kind = Math.max(kind, 2); }
    const addr = t['addr:street'] ? String(t['addr:street']).slice(0, 40) + (t['addr:housenumber'] ? '|' + String(t['addr:housenumber']).slice(0, 8) : '') : '';
    const flat = []; let py = 0, px = 0; pts.forEach((p, i) => { const y = Math.round((p[0] - s) * 1e5), x = Math.round((p[1] - w) * 1e5); if (i && y === py && x === px) return; flat.push(i ? y - py : y, i ? x - px : x); py = y; px = x; });
    if (flat.length < (kind === 4 ? 4 : 6)) continue;
    out.push([el.id, kind, name, addr].concat(flat));
  }
  return { v: 1, t: r + '_' + c, o: [Number(s.toFixed(4)), Number(w.toFixed(4))], sc: 1e5, b: out, fetchedAt: Date.now() };
}
let _bRunning = false;
async function runBuildings() {
  if (_bRunning) return; _bRunning = true;
  try {
    let mark = {}; try { mark = JSON.parse(fs.readFileSync(MARK, 'utf8')); } catch (e) {}
    mark.btiles = mark.btiles || {};
    // Romema's square first, then outwards
    const r0 = Math.floor((31.7935 - CITY_BBOX[0]) / GRID), c0 = Math.floor((35.2095 - CITY_BBOX[1]) / GRID);
    const order = []; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) order.push([r, c]);
    order.sort((a, b) => Math.hypot(a[0] - r0, a[1] - c0) - Math.hypot(b[0] - r0, b[1] - c0));
    let sent = 0, total = 0;
    for (const [r, c] of order) {
      const key = r + '_' + c; if (mark.btiles[key] && Date.now() - mark.btiles[key] < 60 * 864e5) continue;
      const tile = await fetchTile(r, c);
      if (!tile) { LOG('🏘️ buildings: square ' + key + ' did not come back — trying again later'); await new Promise((ok) => setTimeout(ok, 90 * 1000)); break; }
      try {
        const rr = await fetch(SITE + '/api/live-data?type=buildings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' }, body: JSON.stringify({ btile: tile }), signal: AbortSignal.timeout(60000) });
        const txt = await rr.text().catch(() => '');
        if (!rr.ok) { LOG('🏘️ buildings: the site answered ' + rr.status + ' for ' + key + ' ' + txt.slice(0, 120)); break; }
      } catch (e) { LOG('🏘️ buildings: could not hand ' + key + ' to the site — ' + (e && e.message)); break; }
      mark.btiles[key] = Date.now(); fs.writeFileSync(MARK, JSON.stringify(mark)); sent++; total += tile.b.length;
      if (sent === 1 || sent % 10 === 0) LOG('🏘️ buildings: ' + sent + ' square(s) sent this round (' + total + ' buildings), ' + Object.keys(mark.btiles).length + ' of ' + ROWS * COLS + ' done');
      await new Promise((ok) => setTimeout(ok, 12 * 1000));   // gentle on the free Overpass servers
    }
    if (sent) LOG('🏘️ buildings: round over — ' + sent + ' square(s), ' + total + ' buildings');
  } finally { _bRunning = false; }
}
function start(log) { if (log) LOG = log; setTimeout(() => run().catch((e) => LOG('🗺️ romema map: ' + (e && e.message))), 3 * 60 * 1000); setInterval(() => run().catch(() => {}), 30 * 60 * 1000); setTimeout(() => runBuildings().catch((e) => LOG('🏘️ buildings: ' + (e && e.message))), 5 * 60 * 1000); setInterval(() => runBuildings().catch(() => {}), 60 * 60 * 1000); }   // every half hour until it has been sent once; then once a month (the mark file)
module.exports = { start, run, runCity, runBuildings, fetchTile, fetchOsm, shape, simplify };
