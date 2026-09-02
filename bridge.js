// ─────────────────────────────────────────────────────────────────────────────
// CHUTZNIK WHATSAPP BRIDGE v2 — "the smart one"
// Watches EVERY group on this WhatsApp account. Understands conversations:
//  • rentals & business ads  → forwarded ALWAYS, with photos + contact info
//  • question + its answers  → ONE combined post (all the numbers together)
//  • useful standalone info  → forwarded
//  • chit-chat / thank-yous  → skipped
// Photos: downloaded, uploaded to Chutznik, AND read with OCR — the text found
// inside images is summarized into the post body.
// Everything lands in the ADMIN REVIEW QUEUE (amber rows) — nothing goes
// public until Miriam presses ✓ Publish. Same flow as the 58 organizations.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
// First run convenience: if there's no .env yet, create it from the example
try {
  const envP = path.join(__dirname, '.env'), exP = path.join(__dirname, '.env.example');
  if (!fs.existsSync(envP) && fs.existsSync(exP)) { fs.copyFileSync(exP, envP); console.log('created .env from .env.example ✓'); }
} catch (e) {}
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { classify, categoriesFor, topicTitle, clusterWindow, fingerprint, phonesIn } = require('./lib/classify');

const INGEST_URL = process.env.INGEST_URL || 'https://chutznik.org/api/ingest-whatsapp';
const INGEST_KEY = process.env.INGEST_KEY || '';
const SITE = INGEST_URL.replace(/\/api\/.*/, '');
const FLUSH_MINUTES = Number(process.env.FLUSH_MINUTES || 10);
const OCR = String(process.env.OCR || 'on') !== 'off';
const EXCLUDE = (process.env.EXCLUDE_CHATS || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);

const SEEN_FILE = path.join(__dirname, 'seen.json');
let SEEN = new Set();
try { SEEN = new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))); } catch (e) {}
const saveSeen = () => { try { fs.writeFileSync(SEEN_FILE, JSON.stringify([...SEEN].slice(-20000))); } catch (e) {} };

const log = (s) => console.log(new Date().toLocaleTimeString() + '  ' + s);
log('config: site=' + SITE + ' · key=' + (INGEST_KEY ? INGEST_KEY.slice(0,6) + '… (' + INGEST_KEY.length + ' chars)' : '❗ MISSING — nothing can be sent! Check the .env file') + ' · flush every ' + FLUSH_MINUTES + ' min');

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

// ── Message intake: normalize a WhatsApp msg into our shape ──────────────────
async function intake(msg, chatName) {
  let sender = 'Member', phone = '';
  try {
    const c = await msg.getContact();
    sender = c.pushname || c.name || c.number || 'Member';
    phone = c.number ? ('+' + String(c.number).replace(/^\+/, '')) : '';
  } catch (e) {}
  let body = (msg.body || '').trim();
  let media = null;
  if (msg.hasMedia) {
    try {
      const m = await msg.downloadMedia();
      if (m && /^image\//.test(m.mimetype || '') && (m.data || '').length < 4_000_000) {
        media = { base64: m.data, mime: m.mimetype };
      }
    } catch (e) {}
  }
  return {
    id: msg.id ? msg.id._serialized : String(Date.now() + Math.random()),
    ts: (msg.timestamp || Math.floor(Date.now() / 1000)) * 1000,
    chat: chatName, sender, phone, body, media,
    kind: classify(body, !!media),
  };
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
  if (!waiting) { log('… cycle: nothing new to send'); return; }
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

// ── WhatsApp client ──────────────────────────────────────────────────────────
// Preflight: the "catch-up failed: r" error is a KNOWN bug in old library
// versions (fixed in 1.34.7). Check what's actually installed and say so.
try {
  const v = require('whatsapp-web.js/package.json').version;
  const [a,b,cv] = v.split('.').map(Number);
  if (a < 1 || (a===1 && b < 34) || (a===1 && b===34 && cv < 7)) {
    console.log('\n❗❗ Your whatsapp-web.js is v' + v + ' — TOO OLD, this causes the "r" catch-up error.');
    console.log('   Close this window and run, in this folder:  npm install whatsapp-web.js@latest');
    console.log('   Then start again. (Everything else is already set up.)\n');
  } else {
    console.log('library check: whatsapp-web.js v' + v + ' ✓');
  }
} catch (e) {}

// Find a browser: puppeteer's own download if it happened, otherwise the
// Google Chrome already installed on this computer (npm 12 sometimes blocks
// puppeteer's downloader — this makes the bridge work either way).
function findBrowser() {
  try {
    const pp = require('puppeteer');
    const ep = pp.executablePath();
    if (ep && fs.existsSync(ep)) return null; // bundled browser present → default is fine
  } catch (e) {}
  const cands = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const c2 of cands) { try { if (fs.existsSync(c2)) return c2; } catch (e) {} }
  return undefined;
}
const _chromePath = findBrowser();
if (_chromePath) log('using installed Google Chrome as the engine ✓');
else if (_chromePath === undefined) log("❗ No browser found. Run `npm install` again (the new package.json pre-approves puppeteer's download), or install Google Chrome.");

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'], ...(_chromePath ? { executablePath: _chromePath } : {}) },
  // Optional: pin a specific WhatsApp Web version via .env (WEB_VERSION=2.xxxx.xx)
  // — only needed if WhatsApp breaks the library again someday.
  ...(process.env.WEB_VERSION ? { webVersionCache: { type: 'remote', remotePath:
    'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/' + process.env.WEB_VERSION + '.html' } } : {}),
});

client.on('qr', (qr) => { console.log('\n📱 Scan with WhatsApp → Settings → Linked devices → Link a device:\n'); qrcode.generate(qr, { small: true }); });
client.on('authenticated', () => log('🔓 Authenticated — session saved (no need to scan next time).'));
client.on('auth_failure', (m) => log('❌ Auth failed: ' + m + ' — delete the .wwebjs_auth folder and run again.'));
client.on('disconnected', (r) => { log('🔌 Disconnected: ' + r + ' — restarting in 15s…'); setTimeout(() => process.exit(1), 15000); });

async function catchUp(attempt) {
  const cutoff = Date.now() - 48 * 3600 * 1000;
  const chats = await client.getChats(); // this is the call WhatsApp sometimes breaks
  const groups = chats.filter(c => c.isGroup && !EXCLUDE.includes((c.name || '').toLowerCase()));
  log('⏳ Catch-up (try ' + attempt + '): scanning the last 48h across ' + groups.length + ' group(s)…');
  let total = 0;
  for (const chat of groups) {
    let history = null;
    try { history = await chat.fetchMessages({ limit: 60 }); }
    catch (e1) {
      try { history = await chat.fetchMessages({ limit: 15 }); } // smaller ask often succeeds
      catch (e2) { log('   ' + (chat.name || '?') + ': could not read history (' + ((e2 && e2.message) || e2) + ')'); continue; }
    }
    let n = 0;
    for (const msg of history || []) {
      const ts = (msg.timestamp || 0) * 1000;
      if (ts < cutoff || msg.fromMe) continue;
      if (SEEN.has('m_' + msg.id._serialized)) continue;
      SEEN.add('m_' + msg.id._serialized);
      const it = await intake(msg, chat.name || 'Group');
      if (!buffers.has(chat.name)) buffers.set(chat.name, []);
      buffers.get(chat.name).push(it); n++; total++;
    }
    if (n) log('   ' + chat.name + ': ' + n + ' message(s) collected');
  }
  saveSeen();
  log('⏳ Catch-up done — ' + total + ' message(s) collected. First cluster+send within ' + FLUSH_MINUTES + ' minutes.');
}

client.on('ready', async () => {
  log('✅ Connected. Watching ALL group chats on this account (read-only).');
  log('   Every ' + FLUSH_MINUTES + ' min: conversations are clustered into posts → your review queue.');
  // WhatsApp needs a moment after "ready" before chats are actually readable —
  // rushing this is a classic cause of the cryptic "Evaluation failed: r".
  log('   warming up for 15 seconds before reading history…');
  let done = false;
  for (let attempt = 1; attempt <= 4 && !done; attempt++) {
    await new Promise(r => setTimeout(r, attempt === 1 ? 15000 : 45000));
    try { await catchUp(attempt); done = true; }
    catch (e) {
      const m = (e && e.message) || String(e);
      log('   catch-up try ' + attempt + ' failed: ' + m + (attempt < 4 ? ' — retrying in 45s…' : ''));
      if (attempt === 4) {
        log('❗ Catch-up could not run. Live listening still works (new messages ARE captured).');
        log('   Fixes to try, in order: 1) in this folder run: npm install whatsapp-web.js@latest');
        log('   2) make sure the disk has free space  3) delete the .wwebjs_cache folder and restart.');
      }
    }
  }
  log('👀 Now listening live… (keep this window open — or install autostart, see README)');
});

// Plan B catch-up: WhatsApp sometimes breaks the "list all chats" call (the
// famous "r" error) but the per-chat path keeps working. So: the first time a
// group sends ANY live message, we back-fill that group's last 48h right then.
const _backfilled = new Set([...SEEN].filter(k => k.startsWith('cu_')));
async function lazyBackfill(chat) {
  const key = 'cu_' + (chat.id ? chat.id._serialized : chat.name);
  if (_backfilled.has(key)) return;
  _backfilled.add(key); SEEN.add(key); saveSeen();
  let history = null;
  try { history = await chat.fetchMessages({ limit: 60 }); }
  catch (e1) { try { history = await chat.fetchMessages({ limit: 15 }); } catch (e2) { log('   (could not back-fill ' + chat.name + ' — live messages still flow)'); return; } }
  const cutoff = Date.now() - 48 * 3600 * 1000;
  let n = 0;
  for (const m of history || []) {
    const ts = (m.timestamp || 0) * 1000;
    if (ts < cutoff || m.fromMe) continue;
    if (SEEN.has('m_' + m.id._serialized)) continue;
    SEEN.add('m_' + m.id._serialized);
    const it = await intake(m, chat.name || 'Group');
    if (!buffers.has(chat.name)) buffers.set(chat.name, []);
    buffers.get(chat.name).push(it); n++;
  }
  saveSeen();
  if (n) log('⤴ back-filled ' + n + ' message(s) from the last 48h of "' + chat.name + '"');
}

client.on('message', async (msg) => {
  try {
    const chat = await msg.getChat();
    if (!chat.isGroup) return;
    if (EXCLUDE.includes((chat.name || '').toLowerCase())) return;
    lazyBackfill(chat); // fire-and-forget; runs once per group
    if (SEEN.has('m_' + msg.id._serialized)) return;
    SEEN.add('m_' + msg.id._serialized);
    const it = await intake(msg, chat.name || 'Group');
    if (!buffers.has(chat.name)) buffers.set(chat.name, []);
    buffers.get(chat.name).push(it);
    log('💬 ' + chat.name + ' · ' + it.sender + ' · ' + it.kind + (it.media ? ' 📷' : ''));
    // first-ever message: don't make her wait 10 minutes to see proof of life
    if (!global._fastFlushed) { global._fastFlushed = true; setTimeout(() => { log('⚡ quick first send…'); flush(); }, 60000); }
  } catch (e) {}
});

process.on('SIGINT', async () => { log('flushing before exit…'); await flush(); process.exit(0); });
client.initialize();
