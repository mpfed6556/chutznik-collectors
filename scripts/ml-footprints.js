// ── the buildings OpenStreetMap does not have (Miriam, 9 Nov 2026: "fill in all missing buildings"): whole streets of Geula,
//    Mea Shearim and Kerem Avraham have no outlines in OpenStreetMap. Microsoft's open "Global ML Building Footprints"
//    (ODbL, drawn by a model from satellite pictures) cover Israel; the squares around Jerusalem are fetched once, kept here,
//    and each map square takes from them every footprint that does not already stand under an OpenStreetMap building.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');
const CACHE = path.join(__dirname, '..', 'ml-footprints.json');
const INDEX = 'https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv';
const CITY_BBOX = [31.70, 35.13, 31.86, 35.27];
const GRID = 0.01;
const UA = 'chutznik-bridge map (info@chutznik.org)';
let LOG = (m) => console.log(m);
let _data = null;   // { at, n, tiles: { 'r_c': [ [ [lat,lon], ... ], ... ] } }

function quadkey(lat, lon, z) {
  const n = Math.pow(2, z); const x = Math.floor((lon + 180) / 360 * n);
  const r = lat * Math.PI / 180; const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  let q = ''; for (let i = z; i > 0; i--) { let d = 0; const m = 1 << (i - 1); if (x & m) d += 1; if (y & m) d += 2; q += d; } return q;
}
function cityQuadkeys() {
  const ks = new Set(); const [s, w, n, e] = CITY_BBOX;
  for (let la = s; la <= n + 1e-9; la += (n - s) / 4) for (let lo = w; lo <= e + 1e-9; lo += (e - w) / 4) ks.add(quadkey(la, lo, 9));
  return [...ks];
}
function tileOf(lat, lon) { return Math.floor((lat - CITY_BBOX[0]) / GRID) + '_' + Math.floor((lon - CITY_BBOX[1]) / GRID); }

async function download() {
  const r = await fetch(INDEX, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error('index ' + r.status);
  const csv = await r.text(); const want = new Set(cityQuadkeys());
  const rows = csv.split('\n').map((l) => l.split(',')).filter((c) => c.length >= 3 && /^israel$/i.test(c[0].trim()) && want.has(c[1].trim()));
  if (!rows.length) throw new Error('no Israel squares for ' + [...want].join(' '));
  const tiles = {}; let n = 0, seen = 0;
  for (const c of rows) {
    const url = c[2].trim(); LOG('🏘️ footprints: reading ' + c[1].trim() + ' (' + (c[3] || '').trim() + ')');
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20 * 60 * 1000) });
    if (!res.ok || !res.body) throw new Error('square ' + c[1] + ' ' + res.status);
    const rl = readline.createInterface({ input: Readable.fromWeb(res.body).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    for await (const line of rl) {
      seen++; if (!line || line[0] !== '{') continue;
      let g; try { g = JSON.parse(line); } catch (e) { continue; }
      const ring = g && g.geometry && g.geometry.type === 'Polygon' && g.geometry.coordinates && g.geometry.coordinates[0]; if (!ring || ring.length < 4) continue;
      let cy = 0, cx = 0; for (const p of ring) { cy += p[1]; cx += p[0]; } cy /= ring.length; cx /= ring.length;
      if (cy < CITY_BBOX[0] || cy >= CITY_BBOX[2] || cx < CITY_BBOX[1] || cx >= CITY_BBOX[3]) continue;
      const pts = ring.map((p) => [Number(p[1].toFixed(6)), Number(p[0].toFixed(6))]);
      if (Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-9 && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-9) pts.pop();
      if (pts.length < 3) continue;
      const k = tileOf(cy, cx); (tiles[k] = tiles[k] || []).push(pts); n++;
    }
  }
  _data = { at: Date.now(), n, seen, tiles };
  fs.writeFileSync(CACHE, JSON.stringify(_data));
  LOG('🏘️ footprints: ' + n + ' buildings around Jerusalem kept, out of ' + seen + ' lines');
  return _data;
}
let _loading = null;
// the footprints, from the file when it is here and fresh (two months), otherwise fetched once; null while they are not here
async function ensure() {
  if (_data) return _data;
  try { const d = JSON.parse(fs.readFileSync(CACHE, 'utf8')); if (d && d.tiles && d.at && Date.now() - d.at < 60 * 864e5) { _data = d; return d; } } catch (e) {}
  if (!_loading) _loading = download().catch((e) => { LOG('🏘️ footprints: could not fetch — ' + (e && e.message)); _loading = null; return null; });
  return _loading;
}
function forTile(r, c) { return (_data && _data.tiles && _data.tiles[r + '_' + c]) || []; }
function start(log) { if (log) LOG = log; }
module.exports = { ensure, forTile, start, quadkey, cityQuadkeys, tileOf };
