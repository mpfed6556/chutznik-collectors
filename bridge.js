// ─────────────────────────────────────────────────────────────────────────────
// CHUTZNIK WHATSAPP BRIDGE v3 — Baileys engine (no browser)
// Talks WhatsApp's protocol directly. Receives live group messages AND the
// recent history on pairing (your last 48h). Everything else (clustering,
// OCR, categories, contact info, review queue) is unchanged.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
try {
  const envP = path.join(__dirname, '.env'), exP = path.join(__dirname, '.env.example');
  if (!fs.existsSync(envP) && fs.existsSync(exP)) { fs.copyFileSync(exP, envP); console.log('created .env from .env.example ✓'); }
} catch (e) {}
require('dotenv').config();
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default || baileys.makeWASocket;
const { useMultiFileAuthState, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion } = baileys;
const { classify, categoriesFor, topicTitle, clusterWindow, fingerprint, phonesIn } = require('./lib/classify');

const INGEST_URL = process.env.INGEST_URL || 'https://chutznik.org/api/ingest-whatsapp';
const INGEST_KEY = process.env.INGEST_KEY || '';
const SITE = INGEST_URL.replace(/\/api\/.*/, '');
const FLUSH_MINUTES = Number(process.env.FLUSH_MINUTES || 1);
const OCR = String(process.env.OCR || 'on') !== 'off';
const EXCLUDE = (process.env.EXCLUDE_CHATS || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
const HOURS = Number(process.env.HISTORY_HOURS || 48);

const SEEN_FILE = path.join(__dirname, 'seen.json');
let SEEN = new Set();
try { SEEN = new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))); } catch (e) {}
const saveSeen = () => { try { fs.writeFileSync(SEEN_FILE, JSON.stringify([...SEEN].slice(-30000))); } catch (e) {} };
const log = (s) => console.log(new Date().toLocaleTimeString() + '  ' + s);
log('engine: Baileys (direct protocol, no browser) · v' + require('@whiskeysockets/baileys/package.json').version);
log('config: site=' + SITE + ' · key=' + (INGEST_KEY ? INGEST_KEY.slice(0,6) + '… (' + INGEST_KEY.length + ' chars)' : '❗ MISSING — check .env') + ' · send every ' + FLUSH_MINUTES + ' min · history ' + HOURS + 'h');

// ── OCR (lazy-loaded; heavy) ─────────────────────────────────────────────────
let ocrWorkerP = null;
async function ocrImage(base64) {
  if (!OCR) return '';
  try {
    if (!ocrWorkerP) {
      const { createWorker } = require('tesseract.js');
      ocrWorkerP = createWorker(['eng', 'heb']);
    }
    const worker = await ocrWorkerP;
    const { data } = await worker.recognize(Buffer.from(base64, 'base64'));
    const text = (data.text || '').replace(/\s+/g, ' ').trim();
    return text.length > 8 ? text.substring(0, 500) : '';
  } catch (e) { log('   OCR skipped: ' + (e && e.message)); return ''; }
}

// ── Upload one image to Chutznik, get back a hosted URL ──────────────────────
async function uploadImage(base64, mime, tag, index) {
  try {
    const r = await fetch(SITE + '/api/save-attachment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: 'wa_' + tag, index, mime: mime || 'image/jpeg', base64 }),
    });
    const j = await r.json().catch(() => ({}));
    return (j && j.url) || '';
  } catch (e) { return ''; }
}

// ── Send one finished post into the admin review queue ───────────────────────
async function sendToQueue(item) {
  try {
    const r = await fetch(INGEST_URL + '?file=updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-key': INGEST_KEY },
      body: JSON.stringify({ file: 'updates', items: [item] }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.added) { log('   → queued for review: "' + item.title.slice(0, 60) + '"'); return true; }
    if (r.ok) { log('   → duplicate, site skipped it'); return true; }
    log('   ✗ ingest error ' + r.status + ' ' + (j.error || '') + (r.status === 401 ? '  (check INGEST_KEY!)' : ''));
    return false;
  } catch (e) { log('   ✗ could not reach Chutznik: ' + (e && e.message)); return false; }
}


// ── Group names (cached) ─────────────────────────────────────────────────────
const groupNames = new Map();
async function groupName(sock, jid) {
  if (groupNames.has(jid)) return groupNames.get(jid);
  try { const md = await sock.groupMetadata(jid); groupNames.set(jid, md.subject || jid); }
  catch (e) { groupNames.set(jid, jid.split('@')[0]); }
  return groupNames.get(jid);
}

// ── Message intake: Baileys message → our shape ──────────────────────────────
function textOf(m) {
  const msg = m.message || {};
  const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg;
  return inner.conversation || inner.extendedTextMessage?.text || inner.imageMessage?.caption || inner.videoMessage?.caption || inner.documentMessage?.caption || '';
}
function imageOf(m) {
  const msg = m.message || {};
  const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg;
  return inner.imageMessage || null;
}
async function intake(sock, m, chatName) {
  const key = m.key || {};
  const participant = key.participant || key.remoteJid || '';
  const phone = participant ? '+' + participant.split('@')[0].split(':')[0] : '';
  const sender = m.pushName || (phone || 'Member');
  const body = (textOf(m) || '').trim();
  let media = null;
  const img = imageOf(m);
  if (img) {
    try {
      const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
      if (buf && buf.length < 4_000_000) media = { base64: buf.toString('base64'), mime: img.mimetype || 'image/jpeg' };
    } catch (e) {}
  }
  const ts = Number(m.messageTimestamp || 0) * 1000;
  return { id: key.id || String(Date.now()+Math.random()), ts, chat: chatName, sender, phone, body, media, kind: classify(body, !!media) };
}

// ── Build the final Chutznik post from a cluster ─────────────────────────────
async function buildPost(cluster, chatName) {
  const msgs = cluster.kind === 'combined' ? [cluster.q, ...cluster.answers] : cluster.msgs;
  const first = msgs[0];
  const tag = first.id.replace(/[^a-zA-Z0-9]/g, '').slice(-16);

  // images: upload + OCR
  const attachments = []; const ocrTexts = [];
  let idx = 0;
  for (const m of msgs) {
    if (!m.media) continue;
    const url = await uploadImage(m.media.base64, m.media.mime, tag, idx++);
    if (url) attachments.push({ url, name: 'photo' + idx + '.jpg' });
    const t = await ocrImage(m.media.base64);
    if (t) ocrTexts.push(t);
    if (idx >= 6) break;
  }

  // body text with contact info ALWAYS included
  const contact = (m) => m.phone ? ` (${m.phone})` : '';
  let title, memo;
  if (cluster.kind === 'combined') {
    title = topicTitle(cluster.q.body);
    memo = '❓ ' + cluster.q.sender + contact(cluster.q) + ' asked:\n"' + cluster.q.body.substring(0, 400) + '"\n';
    if (cluster.answers.length) {
      memo += '\n💬 The community answered:\n' + cluster.answers.map(a =>
        '• ' + a.body.substring(0, 250) + '  — ' + a.sender + contact(a)).join('\n');
    }
  } else {
    const m = first;
    const firstLine = m.body.split('\n')[0].substring(0, 90);
    title = (m.kind === 'rental' ? '🏠 ' : m.kind === 'ad' ? '🛍 ' : '') + (firstLine || (m.kind === 'rental' ? 'Rental offer' : 'From the community'));
    memo = m.body.substring(0, 2500) + '\n\n— Posted by ' + m.sender + contact(m) + ' in "' + chatName + '"';
  }
  const extraPhones = [...new Set(msgs.flatMap(m => phonesIn(m.body)))];
  if (extraPhones.length) memo += '\n\n📞 Numbers mentioned: ' + extraPhones.join(' · ');
  if (ocrTexts.length) memo += '\n\n📷 From the attached image' + (ocrTexts.length > 1 ? 's' : '') + ': ' + ocrTexts.join(' ▪ ').substring(0, 700);

  const allText = msgs.map(m => m.body).join(' ') + ' ' + ocrTexts.join(' ');
  const kinds = msgs.map(m => m.kind);
  const kind = kinds.includes('rental') ? 'rental' : kinds.includes('ad') ? 'ad' : cluster.kind === 'combined' ? 'question' : 'info';
  return {
    id: 'wa_' + tag,
    source: 'whatsapp',
    group: chatName,
    title: title.substring(0, 150),
    memo,
    types: categoriesFor(allText, kind),
    author: '💬 ' + chatName,
    contactPhone: first.phone || extraPhones[0] || '',
    attachments,
    created: first.ts,
    dedupeKey: 'wa_' + fingerprint(title + ' ' + allText),
  };
}

// ── Buffering: collect per-chat, flush every FLUSH_MINUTES ───────────────────
const buffers = new Map(); // chatName → msgs[]
async function flush() {
  const waiting = [...buffers.values()].reduce((n, a) => n + a.length, 0);
  if (!waiting) return;
  for (const [chatName, msgs] of buffers) {
    if (!msgs.length) continue;
    buffers.set(chatName, []);
    const clusters = clusterWindow(msgs);
    log('📦 ' + chatName + ': ' + msgs.length + ' msg(s) → ' + clusters.length + ' post(s) after clustering');
    for (const cl of clusters) {
      try {
        const post = await buildPost(cl, chatName);
        if (SEEN.has(post.dedupeKey)) { log('   ≈ similar post already sent — skipped'); continue; }
        const ok = await sendToQueue(post);
        if (ok) { SEEN.add(post.dedupeKey); saveSeen(); }
      } catch (e) { log('   post build failed: ' + (e && e.message)); }
    }
  }
}
setInterval(flush, FLUSH_MINUTES * 60 * 1000);


// ── Connection ───────────────────────────────────────────────────────────────
const buffersPush = (name, it) => { if (!buffers.has(name)) buffers.set(name, []); buffers.get(name).push(it); };

async function handleMessages(sock, messages, label) {
  const cutoff = Date.now() - HOURS * 3600 * 1000;
  let n = 0;
  for (const m of messages) {
    try {
      const jid = m.key?.remoteJid || '';
      if (!jid.endsWith('@g.us')) continue;               // groups only
      if (!m.message) continue;                             // protocol/empty
      const ts = Number(m.messageTimestamp || 0) * 1000;
      if (ts && ts < cutoff) continue;                      // older than the window
      const mid = 'm_' + (m.key.id || '');
      if (SEEN.has(mid)) continue;
      SEEN.add(mid);
      const name = await groupName(sock, jid);
      if (EXCLUDE.includes(name.toLowerCase())) continue;
      const it = await intake(sock, m, name);
      if (!it.body && !it.media) continue;
      buffersPush(name, it); n++;
      if (label === 'live') {
        log('💬 ' + name + ' · ' + it.sender + ' · ' + it.kind + (m.key.fromMe ? ' (you)' : '') + (it.media ? ' 📷' : ''));
        if (!global._fast) { global._fast = true; setTimeout(() => { log('⚡ sending…'); flush(); }, 10000); }
      }
    } catch (e) {}
  }
  if (n && label !== 'live') { log('⤴ history: collected ' + n + ' group message(s) from the last ' + HOURS + 'h'); }
  saveSeen();
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'baileys_auth'));
  let version; try { ({ version } = await fetchLatestBaileysVersion()); } catch (e) {}
  const sock = makeWASocket({
    version, auth: state, logger: pino({ level: 'silent' }),
    syncFullHistory: false, markOnlineOnConnect: false,
    browser: ['Chutznik Bridge', 'Chrome', '3.0'],
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    if (u.qr) { console.log('\n📱 Scan with WhatsApp → Settings → Linked devices → Link a device:\n'); qrcode.generate(u.qr, { small: true }); }
    if (u.connection === 'open') log('✅ Connected. Watching ALL groups. History for the last ' + HOURS + 'h arrives on its own; live messages are sent within ~' + FLUSH_MINUTES + ' min.');
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log('❌ Logged out by WhatsApp. Delete the baileys_auth folder and run again to re-pair.');
        process.exit(1);
      }
      log('🔌 Connection dropped (' + code + ') — reconnecting in 5s…');
      setTimeout(start, 5000);
    }
  });
  sock.ev.on('messaging-history.set', ({ messages }) => { handleMessages(sock, messages || [], 'history'); });
  sock.ev.on('messages.upsert', ({ messages, type }) => { handleMessages(sock, messages || [], type === 'notify' ? 'live' : 'history'); });
}
process.on('SIGINT', async () => { log('flushing before exit…'); await flush(); process.exit(0); });
start();
