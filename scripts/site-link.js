// ── The bridge's link to the site's small ledgers (Miriam, 22–23 Oct 2026) ────────────────────────
//   contacted  — every number or address the site ever wrote to; never twice.
//                contactedHas(key) / contactedAdd(key, via, postId)
//   outbox     — WhatsApp notes the admin queued (Tell poster, I posted it): the bridge sends them from
//                her number, a few seconds apart, and tells the site which went.
//   memory     — every group message and jerusaguide post goes to Chutznik memory in bundles every
//                three hours (memoryPush), never one by one, so the droplet and the site stay light.
//   leads      — questions from jerusaguide for the admin's 40-minute window (leadsPush).
// Nothing here throws into the bridge: every call is wrapped, every failure is a log line and a retry
// on the next round.
'use strict';
const fs = require('fs');
const path = require('path');

let CFG = { site: 'https://chutznik.org', key: '', log: (s) => console.log(s), sock: () => null, optedOut: () => false, keep: () => {} };
function init(cfg) { CFG = Object.assign(CFG, cfg || {}); }
const hdrs = () => ({ 'Content-Type': 'application/json', 'x-ingest-key': CFG.key, 'User-Agent': 'chutznik-bridge' });
const norm = (v) => { const x = String(v || '').trim().toLowerCase(); if (/@/.test(x)) return x; const d = x.replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };

// ── contacted ────────────────────────────────────────────────────────────────────────────────────
let _keys = null, _keysAt = 0;
async function contactedKeys(force) {
  if (!force && _keys && Date.now() - _keysAt < 5 * 60 * 1000) return _keys;
  try {
    const r = await fetch(CFG.site + '/api/live-data?type=contacted&t=' + Date.now(), { headers: hdrs(), signal: AbortSignal.timeout(20000) });
    if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.keys)) { _keys = new Set(j.keys.map(String)); _keysAt = Date.now(); } }
  } catch (e) {}
  return _keys || new Set();
}
async function contactedHas(key) { const k = norm(key); if (!k) return false; return (await contactedKeys()).has(k); }
async function contactedAdd(key, via, postId) {
  const k = norm(key); if (!k) return;
  if (_keys) _keys.add(k);
  try { await fetch(CFG.site + '/api/live-data?type=contacted', { method: 'POST', headers: hdrs(), body: JSON.stringify({ key: k, via: String(via || 'bridge'), postId: String(postId || '') }), signal: AbortSignal.timeout(20000) }); } catch (e) {}
}

// ── outbox ───────────────────────────────────────────────────────────────────────────────────────
let _outBusy = false;
async function outboxRound() {
  if (_outBusy) return;
  try { if (require('./shabbos.js').isShabbos()) { if (!global._shOutSaid) { global._shOutSaid = true; CFG.log('🕯️ Shabbos — the WhatsApp outbox waits until after Shabbos (New York time)'); } return; } global._shOutSaid = false; } catch (e) {}
  _outBusy = true;
  try {
    const sock = CFG.sock(); if (!sock) return;
    const r = await fetch(CFG.site + '/api/live-data?type=wa-outbox&t=' + Date.now(), { headers: hdrs(), signal: AbortSignal.timeout(20000) });
    if (!r.ok) return;
    const j = await r.json(); const list = (j && Array.isArray(j.pending)) ? j.pending : [];
    if (!list.length) return;
    const done = [];
    for (const m of list.slice(0, 20)) {
      const id = String(m.id || ''); let d = String(m.to || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '972' + d.slice(1);
      const text = String(m.text || '').trim();
      if (!id) continue;
      if (d.length < 11 || d.length > 13 || !text) { CFG.log('📤 outbox: ' + id + ' has no usable number — dropped'); done.push(id); continue; }
      if (CFG.optedOut(d)) { CFG.log('📤 outbox: ' + d + ' asked not to be messaged — dropped'); done.push(id); continue; }
      try {
        await sock.sendMessage(d + '@s.whatsapp.net', { text });
        CFG.log('📤 outbox → ' + d + ': "' + text.slice(0, 60).replace(/\n/g, ' ') + '"');
        done.push(id); await contactedAdd(d, 'outbox', m.postId || '');
      } catch (e) { CFG.log('📤 outbox failed → ' + d + ': ' + (e && e.message)); }
      await new Promise((res) => setTimeout(res, 4000 + Math.floor(Math.random() * 5000)));
    }
    if (done.length) { try { await fetch(CFG.site + '/api/live-data?type=wa-outbox', { method: 'POST', headers: hdrs(), body: JSON.stringify({ done }), signal: AbortSignal.timeout(20000) }); } catch (e) {} }
  } catch (e) { CFG.log('📤 outbox: ' + (e && e.message)); }
  finally { _outBusy = false; }
}

// ── memory ───────────────────────────────────────────────────────────────────────────────────────
const MEM_FILE = path.join(__dirname, '..', 'memory-buffer.jsonl');
const MEM_EVERY = Number(process.env.MEMORY_EVERY_MIN || 180) * 60 * 1000;   // three hours
const MEM_MAX_LINES = 3000;                                                   // or sooner, when a lot came in
let _memLines = 0, _memBusy = false, _memLast = 0;
try { _memLines = fs.existsSync(MEM_FILE) ? fs.readFileSync(MEM_FILE, 'utf8').split('\n').filter(Boolean).length : 0; } catch (e) {}
function memoryPush(rec) {
  try {
    const text = String(rec && rec.text || '').trim(); if (text.length < 3) return;
    const line = JSON.stringify({ src: String(rec.src || 'whatsapp').slice(0, 30), group: String(rec.group || '').slice(0, 80), ts: Number(rec.ts) || Date.now(), author: String(rec.author || '').slice(0, 80), title: String(rec.title || '').slice(0, 200), text: text.slice(0, 4000) });
    fs.appendFileSync(MEM_FILE, line + '\n'); _memLines++;
    if (_memLines >= MEM_MAX_LINES && !_memBusy) setTimeout(memoryFlush, 2000);
  } catch (e) {}
}
async function memoryFlush() {
  if (_memBusy) return; _memBusy = true;
  try {
    if (!fs.existsSync(MEM_FILE)) return;
    const raw = fs.readFileSync(MEM_FILE, 'utf8'); const lines = raw.split('\n').filter(Boolean);
    if (!lines.length) return;
    const items = []; for (const l of lines) { try { items.push(JSON.parse(l)); } catch (e) {} }
    let sent = 0, added = 0;
    for (let i = 0; i < items.length; i += 500) {
      const chunk = items.slice(i, i + 500);
      const r = await fetch(CFG.site + '/api/memory?action=batch', { method: 'POST', headers: hdrs(), body: JSON.stringify({ items: chunk }), signal: AbortSignal.timeout(55000) });
      if (!r.ok) { CFG.log('🧠 memory: the site answered ' + r.status + ' — ' + (items.length - sent) + ' kept for next time'); break; }
      const j = await r.json().catch(() => ({})); sent += chunk.length; added += Number(j && j.added) || 0;
    }
    // what went is gone from the buffer; what came in meanwhile, and what failed, stays
    const rest = fs.readFileSync(MEM_FILE, 'utf8').split('\n').filter(Boolean).slice(sent);
    fs.writeFileSync(MEM_FILE, rest.length ? rest.join('\n') + '\n' : ''); _memLines = rest.length; _memLast = Date.now();
    if (sent) CFG.log('🧠 memory: ' + sent + ' message(s) sent in ' + Math.ceil(sent / 500) + ' bundle(s), ' + added + ' new');
  } catch (e) { CFG.log('🧠 memory: ' + (e && e.message)); }
  finally { _memBusy = false; }
}

// ── leads ────────────────────────────────────────────────────────────────────────────────────────
async function leadsPush(items) {
  const list = (Array.isArray(items) ? items : []).filter((l) => l && l.text).slice(0, 100);
  if (!list.length) return 0;
  try {
    const r = await fetch(CFG.site + '/api/ingest-whatsapp', { method: 'POST', headers: hdrs(), body: JSON.stringify({ action: 'leads', items: list }), signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { CFG.log('📨 leads: the site answered ' + r.status); return 0; }
    if (Number(j && j.added)) CFG.log('📨 leads: ' + j.added + ' new question(s) for the 40-minute window');
    return Number(j && j.added) || 0;
  } catch (e) { CFG.log('📨 leads: ' + (e && e.message)); return 0; }
}

// ── the clocks ───────────────────────────────────────────────────────────────────────────────────
let _started = false;
function start() {
  if (_started) return; _started = true;
  setInterval(outboxRound, 60 * 1000); setTimeout(outboxRound, 45 * 1000);
  setInterval(() => { if (Date.now() - _memLast >= MEM_EVERY) memoryFlush(); }, 5 * 60 * 1000);
  setTimeout(memoryFlush, 4 * 60 * 1000);   // whatever waited through a restart goes soon after it
  CFG.log('🔗 site link: outbox every minute · memory bundles every ' + Math.round(MEM_EVERY / 60000) + ' min (' + _memLines + ' waiting) · contacted ledger on');
}
function report() { return { memoryWaiting: _memLines, memoryLastSent: _memLast ? new Date(_memLast).toISOString() : null, contactedKnown: _keys ? _keys.size : null }; }

module.exports = { init, start, contactedHas, contactedAdd, contactedKeys, outboxRound, memoryPush, memoryFlush, leadsPush, report, norm };
