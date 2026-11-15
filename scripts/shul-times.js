// ── A shul's times for the week (Miriam, 15 Nov 2026: "find such info and add to shuls posts each week — make connections").
//    In a shuls chat ("Jerusalem Shuls") a gabbai posts the week's davening times, often with the shul's name in the next
//    line ("Khal chasidim 👆") or the line before. This only listens: a notice of times is handed to the site with the name
//    lines around it, and the site ties it to that shul's post (by the name, or by the sender once he has been tied to a
//    shul) and shows it there until Shabbos is out. Nothing here changes what the bridge posts, and nothing is ever sent.
'use strict';
const SITE = (process.env.INGEST_URL || 'https://chutznik.org/api/ingest-whatsapp').replace(/\/api\/.*/, '');
const KEY = process.env.INGEST_KEY || '';
let LOG = (s) => console.log(s);

const CHAT_RE = /shuls?\b|synagog|minyan|בתי כנסת|בית כנסת|מניינים|מנינים/i;
const TIME_RE = /(?:^|[^\d])([01]?\d|2[0-3])[:.][0-5]\d(?!\d)/g;
const WORDS = [/שחרית/, /מנחה/, /מעריב|ערבית/, /הדל(?:קת|"נ|״נ|'נ)|הדה"נ/, /קבלת שבת/, /קידוש/, /מוצ(?:"ש|״ש|ש"ק|אי|ש״ק)/, /ערש"ק|ערש״ק|ערב שבת/,
  /\bshach?[ae]ri[st]h?\b/i, /\bmin[ck]ha\b/i, /\bma'?ariv\b|\barvit\b/i, /\bcandle/i, /\bkabb?all?as? shabb?[ao][st]\b/i, /\bkiddush\b/i, /\bmotz[ae]+i\b/i, /\bhavdal/i];
function looksLikeTimes(text) {
  const t = String(text || ''); if (t.length < 20 || t.length > 1800) return false;
  if ((t.match(TIME_RE) || []).length < 2) return false;
  return WORDS.filter((re) => re.test(t)).length >= 2;
}

const WAIT = 4 * 60 * 1000;          // the name often comes in the next message
const HELD = new Map();              // sender → the notice waiting for its name
const LAST = new Map();              // sender → her last short line (a name written before the notice)
const senderKey = (it) => String((it && (it.phone || it.jid || it.sender)) || '').replace(/[^\w֐-׿]/g, '').slice(-20);

async function send(key) {
  const h = HELD.get(key); if (!h) return; HELD.delete(key);
  try {
    const r = await fetch(SITE + '/api/live-data?type=shultimes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' },
      body: JSON.stringify({ text: h.text, label: h.label || '', before: h.before || '', sender: h.sender, senderKey: key, group: h.group, at: h.ts, msgId: h.id }), signal: AbortSignal.timeout(30000) });
    const j = r.ok ? await r.json().catch(() => ({})) : {};
    LOG('🕍 shul times from ' + h.group + ' · ' + (h.sender || '?') + (r.ok ? (j.post ? ' → on its shul post' : j.pending ? ' → waiting for the admin to say which shul' : ' → not kept' + (j.why ? ' (' + j.why + ')' : '')) : ' — the site answered ' + r.status));
  } catch (e) { LOG('🕍 shul times: ' + (e && e.message)); }
}

// every group message passes through here; only a shuls chat is looked at
function note(group, it, ts) {
  try {
    if (!CHAT_RE.test(String(group || '')) || !it) return;
    const key = senderKey(it); if (!key) return;
    const text = [it.body, it.docText].filter(Boolean).join('\n').trim(); if (!text) return;
    const at = Number(ts) || Date.now();
    if (looksLikeTimes(text)) {
      const prev = LAST.get(key);
      HELD.set(key, { text: text.slice(0, 1800), ts: at, id: String(it.id || at), sender: String(it.sender || '').slice(0, 60), group: String(group).slice(0, 80), before: (prev && at - prev.ts < 3 * 60 * 1000 && at >= prev.ts) ? prev.text : '' });
      setTimeout(() => send(key).catch(() => {}), WAIT);
      return;
    }
    if (text.length <= 80 && !/https?:\/\//i.test(text)) {
      const h = HELD.get(key);
      if (h && !h.label && at - h.ts < 5 * 60 * 1000 && at >= h.ts) h.label = text; else LAST.set(key, { text, ts: at });
      if (LAST.size > 400) LAST.clear();
    }
  } catch (e) {}
}
function start(log) { if (log) LOG = log; }
module.exports = { start, note, looksLikeTimes };
