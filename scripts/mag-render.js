// ── The Romema Door 2 Door issue, drawn here instead of in her browser (Miriam, 8 Nov 2026: "the upload shouldn't need me to
//    keep the browser open — one upload should be enough"). The browser hands the PDF to the site in parts; every two minutes
//    this looks for an issue waiting in the site's inbox, downloads it, draws each page, finds the advert boxes the way the
//    browser did, has each half-page read by the site's reader (its AI keys live there) and parks the half on the site with its
//    adverts — the site's 15-minute run crops the pictures and posts. Nothing here needs her phone after the upload.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const SITE = (process.env.INGEST_URL || 'https://chutznik.org/api/ingest-whatsapp').replace(/\/api\/.*/, '');
const KEY = process.env.INGEST_KEY || '';
let LOG = (s) => console.log(s);
const H = { 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' };

async function getJson(u) { try { const r = await fetch(SITE + u, { headers: H, signal: AbortSignal.timeout(60000) }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
async function getBytes(u) { for (let a = 0; a < 3; a++) { try { const r = await fetch(SITE + u, { headers: H, signal: AbortSignal.timeout(120000) }); if (r.ok) return Buffer.from(await r.arrayBuffer()); if (r.status === 404) return null; } catch (e) {} await new Promise((ok) => setTimeout(ok, 3000)); } return null; }
async function postJson(u, body, ms) {
  let last = null;
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(SITE + u, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify(body), signal: AbortSignal.timeout(ms || 120000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
      if (r.ok && j) return j; last = j || { error: r.status + ' ' + t.slice(0, 120) }; if (r.status === 401 || r.status === 400) return last; }
    catch (e) { last = { error: String(e && e.message) }; }
    await new Promise((ok) => setTimeout(ok, 2500 * (a + 1)));
  }
  return last;
}

// ── the advert boxes on a page, from the ink on a 900-pixel copy (the browser's magSegment, line for line)
function segment(img) {
  const W = img.bitmap.width, H = img.bitmap.height, d = img.bitmap.data, m = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) { const r = d[p], g = d[p + 1], b = d[p + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); m[i] = (mx < 225 || (mx - mn) > 28) ? 1 : 0; }
  const rowInk = (x0, x1, y) => { let s = 0; const o = y * W; for (let x = x0; x < x1; x++) s += m[o + x]; return s; };
  const colInk = (y0, y1, x) => { let s = 0; for (let y = y0; y < y1; y++) s += m[y * W + x]; return s; };
  function bands(prof, minlen) { const out = []; let i = 0; const n = prof.length; while (i < n) { if (!prof[i]) { let j = i; while (j < n && !prof[j]) j++; if (j - i >= minlen) out.push([i, j]); i = j; } else i++; } return out; }
  const out = [];
  function split(x0, y0, x1, y1, depth) {
    let h = y1 - y0, w = x1 - x0; if (h < 8 || w < 8) return;
    const rows = [], cols = [];
    for (let y = y0; y < y1; y++) rows.push(rowInk(x0, x1, y) / w > 0.01);
    for (let x = x0; x < x1; x++) cols.push(colInk(y0, y1, x) / h > 0.01);
    const ry0 = rows.indexOf(true), cx0 = cols.indexOf(true); if (ry0 < 0 || cx0 < 0) return;
    const ty0 = y0 + ry0, ty1 = y0 + rows.lastIndexOf(true) + 1, tx0 = x0 + cx0, tx1 = x0 + cols.lastIndexOf(true) + 1; h = ty1 - ty0; w = tx1 - tx0;
    if (depth > 6) { out.push([tx0, ty0, tx1, ty1]); return; }
    for (const axis of [0, 1]) {
      const L = axis === 0 ? h : w, prof = [];
      if (axis === 0) { for (let y = ty0; y < ty1; y++) prof.push(rowInk(tx0, tx1, y) / w > 0.012); } else { for (let x = tx0; x < tx1; x++) prof.push(colInk(ty0, ty1, x) / h > 0.012); }
      const gl = Math.max(4, Math.floor(L * 0.006));
      const gs = bands(prof, gl).filter((g) => g[0] > L * 0.06 && g[1] < L * 0.94);
      if (gs.length) { const cuts = [0].concat(gs.map((g) => (g[0] + g[1]) >> 1), [L]); for (let i = 0; i < cuts.length - 1; i++) { const a = cuts[i], b = cuts[i + 1]; if (axis === 0) split(tx0, ty0 + a, tx1, ty0 + b, depth + 1); else split(tx0 + a, ty0, tx0 + b, ty1, depth + 1); } return; }
    }
    out.push([tx0, ty0, tx1, ty1]);
  }
  split(0, 0, W, H, 0);
  const boxes = out.filter((b) => (b[2] - b[0]) > W * 0.12 && (b[3] - b[1]) > H * 0.05);
  boxes.sort((a, b) => { const ka = Math.round(a[1] / (H * 0.08)), kb = Math.round(b[1] / (H * 0.08)); return (ka - kb) || (b[0] - a[0]); });
  return boxes.map((b) => [b[0] / W, b[1] / H, b[2] / W, b[3] / H]);
}
const scaled = (img, maxSide) => { const k = Math.min(1, maxSide / Math.max(img.bitmap.width, img.bitmap.height)); return k < 1 ? img.clone().resize({ w: Math.max(1, Math.round(img.bitmap.width * k)), h: Math.max(1, Math.round(img.bitmap.height * k)) }) : img.clone(); };
// the numbered red boxes the reader is asked about (the browser's magOverlay)
async function overlay(img, boxes, J) {
  const c = scaled(img, 1400); const W = c.bitmap.width, Hh = c.bitmap.height, fs = Math.round(W / 40), lw = Math.max(3, Math.round(W / 350));
  const red = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= Hh) return; const i = (y * W + x) * 4; c.bitmap.data[i] = 255; c.bitmap.data[i + 1] = 0; c.bitmap.data[i + 2] = 0; c.bitmap.data[i + 3] = 255; };
  const font = await J.loadFont(J.FONT);
  boxes.forEach((b, i) => {
    const x = Math.round(b[0] * W), y = Math.round(b[1] * Hh), w = Math.round((b[2] - b[0]) * W), h = Math.round((b[3] - b[1]) * Hh);
    for (let t = 0; t < lw; t++) { for (let xx = x; xx < x + w; xx++) { red(xx, y + t); red(xx, y + h - 1 - t); } for (let yy = y; yy < y + h; yy++) { red(x + t, yy); red(x + w - 1 - t, yy); } }
    const bw = Math.round(fs * 1.6), bh = Math.round(fs * 1.25);
    for (let yy = y + 3; yy < y + 3 + bh; yy++) for (let xx = x + 3; xx < x + 3 + bw; xx++) red(xx, yy);
    try { c.print({ font, x: x + 3 + Math.round(fs * 0.25), y: y + 3 + Math.round((bh - 32) / 2), text: String(i + 1) }); } catch (e) {}
  });
  return c.getBuffer('image/jpeg', { quality: 85 });
}

// the pages of this issue the site already has as posts or parked halves: done before, not again
async function donePages(issue) {
  const done = new Set();
  try { const j = await getJson('/api/read-mag'); for (const p of ((j && j.pages) || [])) if (String(p.issue) === String(issue)) done.add(String(p.page).padStart(3, '0') + '_' + p.side); } catch (e) {}
  try { const ups = await getJson('/api/live-data?type=updates&t=' + Date.now()); const re = new RegExp('^mag_g' + issue + '_(\\d{3})_(r|l|full)\\d*$');
    for (const u of (Array.isArray(ups) ? ups : [])) { const m = re.exec(String(u && u.id || '')); if (m) done.add(m[1] + '_' + m[2]); } } catch (e) {}
  return done;
}

async function renderIssue(rec) {
  const issue = String(rec.issue); const tag = '📰 issue ' + issue + ': ';
  const status = (st, page, of, note) => postJson('/api/read-mag', { action: 'inbox-status', issue, status: st, page, of, note }, 60000).catch(() => null);
  await status('rendering', 0, 0, 'downloading');
  const parts = [];
  for (let i = 0; i < (Number(rec.parts) || 0); i++) { const b = await getBytes('/api/read-mag?inboxpart=g' + issue + '/part-' + String(i).padStart(2, '0')); if (!b) throw new Error('part ' + (i + 1) + ' of ' + rec.parts + ' is missing on the site'); parts.push(b); }
  const pdfBuf = Buffer.concat(parts); LOG(tag + 'PDF downloaded, ' + Math.round(pdfBuf.length / 1048576 * 10) / 10 + ' MB in ' + parts.length + ' part(s)');
  const { PDFParse } = require('pdf-parse'); const { Jimp, loadFont } = require('jimp'); const fonts = require('@jimp/plugin-print/fonts'); const J = { loadFont, FONT: fonts.SANS_32_WHITE };
  const pdf = new PDFParse({ data: new Uint8Array(pdfBuf) });
  let N = 0; try { const info = await pdf.getInfo(); N = Number(info.total) || 0; } catch (e) { throw new Error('the PDF could not be opened: ' + (e && e.message)); }
  if (!N) throw new Error('the PDF has no pages');
  const done = await donePages(issue); let parked = 0, read = 0, skipped = 0, empty = 0, fails = 0;
  LOG(tag + N + ' pages' + (done.size ? ', ' + done.size + ' half-page(s) done before' : ''));
  for (let i = 1; i <= N; i++) {
    await status('rendering', i, N, '');
    let shot; try { shot = await pdf.getScreenshot({ partial: [i], scale: 0.25, imageBuffer: false }); } catch (e) { fails++; LOG(tag + 'page ' + i + ' did not draw: ' + (e && e.message)); continue; }
    const pg0 = shot && shot.pages && shot.pages[0]; if (!pg0) { fails++; continue; }
    const sc = 0.25 * 3000 / Math.max(pg0.width, pg0.height);
    let full; try { const s2 = await pdf.getScreenshot({ partial: [i], scale: sc, imageBuffer: true }); full = await Jimp.read(Buffer.from(s2.pages[0].data)); } catch (e) { fails++; LOG(tag + 'page ' + i + ' did not draw: ' + (e && e.message)); continue; }
    const spread = full.bitmap.width > full.bitmap.height * 1.15; const sides = spread ? ['r', 'l'] : ['full']; const page3 = String(i).padStart(3, '0');
    for (const side of sides) {
      if (done.has(page3 + '_' + side)) { skipped++; continue; }
      let src = full;
      if (side !== 'full') { const half = Math.round(full.bitmap.width / 2); src = full.clone().crop({ x: side === 'l' ? 0 : full.bitmap.width - half, y: 0, w: half, h: full.bitmap.height }); }
      const small = scaled(src, 900); const boxes = segment(small);
      const ov = await overlay(src, boxes, J); const clean = await scaled(src, 1600).getBuffer('image/jpeg', { quality: 80 });
      const sideName = side === 'full' ? '' : (side === 'r' ? 'right' : 'left');
      // the reader first (the site's AI); the page is parked either way — with its adverts, or for the run to read
      let ads = null, why = '';
      const rd = await postJson('/api/live-data?type=magazine', { image: ov.toString('base64'), mime: 'image/jpeg', page: i, side: sideName, issue, boxCount: boxes.length, dateNote: rec.dateNote || '' }, 180000);
      if (rd && rd.ok && Array.isArray(rd.ads)) { ads = rd.ads; read++; } else why = String((rd && rd.error) || 'no answer').slice(0, 120);
      if (ads && !ads.length) { empty++; continue; }   // a page with nothing to post (the magazine's own bits): nothing to park
      const key = 'magpage-g' + issue + '-' + page3 + '-' + side;
      const u1 = await postJson('/api/save-attachment', { postId: key, index: 0, mime: 'image/jpeg', base64: ov.toString('base64'), name: 'overlay.jpg' }, 120000);
      const u2 = await postJson('/api/save-attachment', { postId: key, index: 1, mime: 'image/jpeg', base64: clean.toString('base64'), name: 'page.jpg' }, 120000);
      if (!u1 || !u1.url || !u2 || !u2.url) { fails++; LOG(tag + 'page ' + i + (sideName ? ' (' + sideName + ')' : '') + ': the page pictures did not upload (' + String((u1 && u1.error) || (u2 && u2.error) || '').slice(0, 80) + ')'); continue; }
      const pk = await postJson('/api/read-mag', Object.assign({ action: 'park', issue, page: i, side, overlay: u1.url, clean: u2.url, boxes, boxCount: boxes.length, dateNote: rec.dateNote || '', hours: Number(rec.hours) || 0 }, ads ? { ads } : {}), 60000);
      if (!pk || !pk.ok) { fails++; LOG(tag + 'page ' + i + ': could not park (' + String((pk && pk.error) || '').slice(0, 80) + ')'); continue; }
      parked++; if (!ads) LOG(tag + 'page ' + i + (sideName ? ' (' + sideName + ')' : '') + ' parked unread — ' + why);
    }
    if (i === 1 || i % 10 === 0) LOG(tag + 'page ' + i + ' of ' + N + ' — ' + parked + ' half-page(s) parked, ' + read + ' read');
  }
  try { await pdf.destroy(); } catch (e) {}
  const note = parked + ' half-page(s) parked (' + read + ' read here, ' + empty + ' empty, ' + skipped + ' done before' + (fails ? ', ' + fails + ' failed' : '') + ')';
  await status(fails && !parked ? 'failed' : 'done', N, N, note);
  LOG(tag + 'finished — ' + note + '. The site posts the adverts on its 15-minute runs.');
}

let _running = false;
async function run() {
  if (_running) return; _running = true;
  try {
    const j = await getJson('/api/read-mag?inbox=1'); const issues = (j && j.issues) || [];
    for (const rec of issues) {
      const stale = rec.status === 'rendering' && Date.now() - (Number(rec.statusAt) || Number(rec.at) || 0) > 30 * 60 * 1000;   // a run that died half way
      if (rec.status !== 'uploaded' && !stale) continue;
      try { await renderIssue(rec); }
      catch (e) { LOG('📰 issue ' + rec.issue + ': ' + (e && e.message)); try { await postJson('/api/read-mag', { action: 'inbox-status', issue: rec.issue, status: 'failed', note: String(e && e.message).slice(0, 180) }, 60000); } catch (e2) {} }
    }
  } catch (e) { LOG('📰 magazine: ' + (e && e.message)); } finally { _running = false; }
}
function start(log) { if (log) LOG = log; setTimeout(() => run().catch(() => {}), 90 * 1000); setInterval(() => run().catch(() => {}), 2 * 60 * 1000); }
module.exports = { start, run, segment, renderIssue };
