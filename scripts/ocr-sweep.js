// ── The free picture reader (Miriam, 25 Oct 2026: "there's got to be a free unlimited tool to convert pic to text") ──
// Tesseract runs here on the droplet, free and without limits, and reads the printed words off every public post's
// picture that the site's AI reader has not reached (the AI's free quota lasts a few hours a day). What it reads goes
// to the post as picText, so the site searches it and shows it; a post that said nothing but its picture ("Item")
// gets its title from the first good line. The AI, when it has quota, still does the dress check, and reads these
// pictures properly once nothing unread waits (the site marks them picVia "ocr").
// Tesseract is loose on flyers: design elements come back as stray letters. So only the lines it is sure of are kept
// (word confidence 55+, words that look like words), and a picture with fewer than two such lines — a photo of a
// room, a sofa, a menu in fancy lettering — is left for the AI, never written.
'use strict';
const fs = require('fs');
const path = require('path');

let CFG = { site: 'https://chutznik.org', key: '', log: (s) => console.log(s), items: () => ({}) };
function init(cfg) { CFG = Object.assign(CFG, cfg || {}); }

const DONE_FILE = path.join(__dirname, '..', 'ocr-done.json');   // pictures looked at here (words or none), never twice
let DONE = {}; try { DONE = JSON.parse(fs.readFileSync(DONE_FILE, 'utf8')) || {}; } catch (e) {}
function saveDone() { try { fs.writeFileSync(DONE_FILE, JSON.stringify(DONE)); } catch (e) {} }

// the worker lives while there is a backlog and is let go when a round finds nothing to read (it holds ~150 MB)
let workerP = null;
async function worker() {
  if (!workerP) {
    const { createWorker } = require('tesseract.js');
    workerP = (async () => { const w = await createWorker(['eng', 'heb'], 1, { logger: () => {} }); await w.setParameters({ tessedit_pageseg_mode: '11' }); return w; })();   // 11: sparse text, the way flyers are laid out
  }
  return workerP;
}
async function release() { const p = workerP; workerP = null; if (p) { try { (await p).terminate(); } catch (e) {} } }

const TOK = /^[\p{L}\p{N}][\p{L}\p{N}'’.,:;/%₪$€!?()-]*$/u;
const goodWord = (w) => w.c >= 55 && TOK.test(w.t) && (/\p{N}/u.test(w.t) || ((w.t.match(/\p{L}/gu) || []).length >= Math.min(2, w.t.length) && w.t.length >= 2));
// the lines Tesseract is sure of, in reading order
function keepLines(data) {
  let lines = data && data.lines;
  if (!lines && data && data.blocks) { lines = []; for (const b of data.blocks) for (const p of (b.paragraphs || [])) for (const l of (p.lines || [])) lines.push(l); }
  const out = [];
  for (const l of (lines || [])) {
    const ws = (l.words || []).map((w) => ({ t: String(w.text || '').trim(), c: Number(w.confidence) || 0 })).filter((w) => w.t);
    if (!ws.length) continue;
    const good = ws.filter(goodWord);
    const letters = good.reduce((n, w) => n + (w.t.match(/[\p{L}\p{N}]/gu) || []).length, 0), chars = good.reduce((n, w) => n + w.t.length, 0);
    if (good.length >= 2 && good.length >= ws.length * 0.6 && letters >= chars * 0.7) out.push(good.map((w) => w.t).join(' '));
  }
  return out;
}
// the words off one picture (a Buffer): '' when Tesseract found fewer than two sure lines
async function ocrBuffer(buf) {
  const w = await worker();
  const { data } = await w.recognize(buf, {}, { blocks: true, text: true });
  const lines = keepLines(data);
  if (lines.length < 2 || lines.join(' ').length < 20) return '';
  return lines.join('\n').slice(0, 1500);
}
const GENERIC = /^(?:item|items|photo|pic|pics|picture|image|img|flyer|ad|advert|fyi|see (?:attached|below|pic|flyer)|attached|untitled|post|new|check this out|look|from a local business|apartment available|a question for the community|from .{0,40})\s*[.!:]*$/i;
// the first line that reads like a heading, for a post whose title says nothing
function titleFrom(text) {
  for (const l of String(text || '').split('\n')) {
    const s = l.trim(); const words = s.split(/\s+/).filter((x) => /\p{L}{2,}/u.test(x));
    if (s.length >= 8 && s.length <= 70 && words.length >= 2) return s.replace(/[.,:;!-]+$/, '');
  }
  return '';
}
const pathOf = (a) => { const s0 = String((a && (a.url || a.path)) || a || ''); const m = s0.match(/[?&]path=([^&]+)/); if (m) return decodeURIComponent(m[1]); const m2 = s0.match(/^\/?(attachments\/[^?#]+)/); return m2 ? m2[1] : ''; };
const isPic = (p) => /\.(jpe?g|png|webp)$/i.test(p);

async function fetchImage(p) {
  const r = await fetch(CFG.site + '/api/live-data?type=file&path=' + encodeURIComponent(p), { headers: { 'x-ingest-key': CFG.key, 'User-Agent': 'chutznik-bridge' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) return null; const buf = Buffer.from(await r.arrayBuffer());
  return buf.length > 1000 && buf.length < 8 * 1024 * 1024 ? buf : null;
}
async function patch(id, fields) {
  const r = await fetch(CFG.site + '/api/ingest-whatsapp', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-ingest-key': CFG.key, 'User-Agent': 'chutznik-bridge' }, body: JSON.stringify({ file: 'updates', id, patch: fields }), signal: AbortSignal.timeout(30000) });
  return r.ok;
}

let busy = false, stats = { read: 0, blank: 0, failed: 0, lastRun: 0, lastRead: 0, waiting: 0, liveWaiting: 0 }; const FAILS = {};
const failed = (id) => { stats.failed++; FAILS[id] = (FAILS[id] || 0) + 1; if (FAILS[id] >= 3) DONE[id] = Date.now(); };   // three strikes: left for the AI
async function round(max) {
  if (busy) return; busy = true;
  try {
    const items = Object.values(CFG.items() || {});
    // live posts first, newest first; whatever room is left in the round goes to the posts not on the site (the queue,
    // Chutznik memory's material) — Miriam, 25 Oct 2026: "always go to the live things first … if there's more, give to memory"
    const when = (u) => Number(u.created) || Date.parse(u.created) || 0;
    const want = (u) => u && !u.picText && !u.deletedAt && !DONE[String(u.id)] && (u.attachments || []).some((a) => isPic(pathOf(a)));
    const live = items.filter((u) => want(u) && u.status === 'public').sort((a, b) => when(b) - when(a));
    const rest = items.filter((u) => want(u) && u.status !== 'public' && Date.now() - when(u) > 2 * 3600 * 1000).sort((a, b) => when(b) - when(a));
    const all = live.concat(rest);
    stats.lastRun = Date.now(); stats.waiting = all.length; stats.liveWaiting = live.length;
    const todo = all.slice(0, max || 6);
    if (!todo.length) { await release(); return; }
    for (const u of todo) {
      const id = String(u.id); const paths = (u.attachments || []).map(pathOf).filter(isPic).slice(0, 3);
      let text = '', err = false;
      for (const p of paths) {
        try { const buf = await fetchImage(p); if (!buf) continue; const t = await ocrBuffer(buf); if (t) text += (text ? '\n\n' : '') + t; }
        catch (e) { err = true; CFG.log('🔤 OCR failed on ' + id + ': ' + String(e && e.message).slice(0, 80)); }
      }
      if (err && !text) { failed(id); continue; }   // the picture did not come or Tesseract choked: next round again
      if (text) {
        const fields = { picText: text.slice(0, 1500), picTried: Date.now(), picTries: (Number(u.picTries) || 0) + 1, picVia: 'ocr' };
        const t = String(u.title || '').trim();
        if (GENERIC.test(t) || t.split(/\s+/).length <= 1) { const tt = titleFrom(text); if (tt) fields.title = tt; }
        const ok = await patch(id, fields).catch(() => false);
        if (!ok) { failed(id); continue; }
        Object.assign(u, fields); stats.read++; stats.lastRead = Date.now();
        CFG.log('🔤 OCR read ' + text.length + ' chars off "' + t.slice(0, 40) + '"' + (fields.title ? ' → titled "' + fields.title.slice(0, 40) + '"' : ''));
      } else { stats.blank++; }
      DONE[id] = Date.now();
    }
    saveDone();
  } catch (e) { CFG.log('🔤 OCR: ' + (e && e.message)); }
  finally { busy = false; }
}
let started = false;
function start() {
  if (started) return; started = true;
  setInterval(() => round(8), 4 * 60 * 1000); setTimeout(() => round(8), 2 * 60 * 1000);
  CFG.log('🔤 free picture reader (Tesseract) on: eight pictures every four minutes, live posts first, then the queue (' + Object.keys(DONE).length + ' looked at so far)');
}
function report() { return Object.assign({}, stats, { done: Object.keys(DONE).length, lastRun: stats.lastRun ? new Date(stats.lastRun).toISOString() : null, lastRead: stats.lastRead ? new Date(stats.lastRead).toISOString() : null }); }
module.exports = { init, start, round, report, ocrBuffer, keepLines, titleFrom, release };
