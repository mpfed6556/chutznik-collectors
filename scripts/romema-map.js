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
function start(log) { if (log) LOG = log; setTimeout(() => run().catch((e) => LOG('🗺️ romema map: ' + (e && e.message))), 3 * 60 * 1000); setInterval(() => run().catch(() => {}), 30 * 60 * 1000); }   // every half hour until it has been sent once; then once a month (the mark file)
module.exports = { start, run, runCity, fetchOsm, shape, simplify };
