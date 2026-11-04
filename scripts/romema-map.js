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
  if (mark.sentAt && Date.now() - mark.sentAt < 30 * 864e5) return;
  const j = await fetchOsm(); if (!j) return;
  const osm = shape(j);
  if (!osm.streets.length) { LOG('🗺️ romema map: no streets came back'); return; }
  try {
    const r = await fetch(SITE + '/api/live-data?type=buildings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' }, body: JSON.stringify({ osm }), signal: AbortSignal.timeout(30000) });
    const txt = await r.text().catch(() => '');
    if (!r.ok) { LOG('🗺️ romema map: the site answered ' + r.status + ' ' + txt.slice(0, 120)); return; }
    fs.writeFileSync(MARK, JSON.stringify({ sentAt: Date.now(), streets: osm.streets.length, places: osm.places.length }));
    LOG('🗺️ romema map: ' + osm.streets.length + ' street segments and ' + osm.places.length + ' named places sent to the site');
  } catch (e) { LOG('🗺️ romema map: could not hand it to the site — ' + (e && e.message)); }
}
function start(log) { if (log) LOG = log; setTimeout(() => run().catch((e) => LOG('🗺️ romema map: ' + (e && e.message))), 3 * 60 * 1000); setInterval(() => run().catch(() => {}), 30 * 60 * 1000); }   // every half hour until it has been sent once; then once a month (the mark file)
module.exports = { start, run, fetchOsm, shape };
