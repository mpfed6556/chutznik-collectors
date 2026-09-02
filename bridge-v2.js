// ─────────────────────────────────────────────────────────────────────────────
// CHUTZNIK WHATSAPP BRIDGE v2.1 — whatsapp-web.js engine
// Same engine and pairing as before (no QR re-scan), with the Sep 2026
// clean-up: real phone numbers only, no added emojis/decorations, contact
// details in their own fields, summarised long messages, honest titles,
// cross-group duplicate detection, and rentals auto-published.
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
  // Same text already came through another group in the last few hours? Skip.
  if (item._contentKey && isRecentDuplicate(item._contentKey, item.created || Date.now())) {
    log('   ⊘ duplicate of a post from another group — skipped');
    return true;
  }
  delete item._contentKey; delete item._kind;
  try {
    const r = await fetch(INGEST_URL + '?file=updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-key': INGEST_KEY },
      body: JSON.stringify({ file: 'updates', items: [item] }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.added) {
      log('   → ' + (item.status === 'public' ? 'PUBLISHED (rental)' : 'queued for review') + ': "' + item.title.slice(0, 60) + '"');
      return true;
    }
    if (r.ok) { log('   → duplicate, site skipped it'); return true; }
    log('   ✗ ingest error ' + r.status + ' ' + (j.error || '') + (r.status === 401 ? '  (check INGEST_KEY!)' : ''));
    return false;
  } catch (e) { log('   ✗ could not reach Chutznik: ' + (e && e.message)); return false; }
}

// ═════════════════════════════════════════════════════════════════════════════
// CONTACT / TEXT HYGIENE  (added Sep 2026)
//
// WhatsApp now hands us a privacy "LID" instead of a real number for most
// senders — a 14-15 digit id like 96456979558409. The old code wrote that
// straight into contactPhone, which is where the bogus "+201…" numbers on the
// site came from. Rule now: a number is only used if it validates as a real
// phone, and real numbers are pulled out of the message TEXT.
// ═════════════════════════════════════════════════════════════════════════════

function normalizePhone(raw) {
  if (!raw) return '';
  const hadPlus = String(raw).trim().startsWith('+');
  const d = String(raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.length > 13) return '';                       // LID, not a phone
  if (d.startsWith('972')) {
    const r = d.slice(3);
    if (!/^(?:5\d|[23489])\d{7}$/.test(r)) return '';
    return r.length === 9
      ? '+972-' + r.replace(/^(\d{2})(\d{3})(\d{4})$/, '$1-$2-$3')
      : '';
  }
  if (d.startsWith('0')) {
    if (/^05\d{8}$/.test(d))     return d.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
    if (/^0[23489]\d{7}$/.test(d)) return d.replace(/^(\d{2})(\d{3})(\d{4})$/, '$1-$2-$3');
    return '';
  }
  if (hadPlus && d.length >= 10 && d.length <= 13) return '+' + d;
  return '';
}

// Israeli numbers inside free text. Digit boundaries stop it matching a slice
// of a long LID (e.g. "0841152" sitting inside 257208411529315).
const PHONE_RE = /(?:(?<!\d)\+972[-.\s]?|(?<!\d)0)(?:5\d|[23489])[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/g;
function phonesInText(t) {
  const out = [];
  for (const m of String(t || '').matchAll(PHONE_RE)) {
    const p = normalizePhone(m[0]);
    if (p) out.push(p);
  }
  return [...new Set(out)];
}
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g;
const URL_RE   = /\bhttps?:\/\/\S+|\bwww\.[\w-]+\.[\w.\/-]+/gi;
function emailsInText(t){ return [...new Set(String(t||'').match(EMAIL_RE) || [])]; }
function urlsInText(t){
  return [...new Set((String(t||'').match(URL_RE) || []).filter(u => !/wa\.me|whatsapp\.com|chat\.whatsapp/i.test(u)))];
}

// Emoji / pictograph stripper — used on titles so the feed stays clean.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;
function stripEmoji(t){ return String(t||'').replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim(); }

// Body cleanup: drop contact details we've lifted into their own fields, and
// tidy the runaway blank lines that WhatsApp posts are full of.
function cleanBody(text, contacts) {
  let t = String(text || '');
  (contacts.phones || []).forEach(p => {
    const digits = p.replace(/\D/g, '').slice(-9);
    if (digits.length === 9) t = t.replace(new RegExp('(?:\\\\+?972[-.\\\\s]?|0)[-.\\\\s\\\\d]{0,4}' + digits.split('').join('[-.\\\\s]?') + '(?!\\\\d)', 'g'), '');
  });
  (contacts.emails || []).forEach(e => { t = t.split(e).join(''); });
  (contacts.urls   || []).forEach(u => { t = t.split(u).join(''); });
  return t
    // legacy decorations this bridge used to add (and any (+123456789012) ids)
    .replace(/\((?:\+)?\d{9,}\)/g, '')
    .replace(/^\s*[❓]\s*/gm, '')
    .replace(/^.*?\basked:\s*$/gim, '')
    .replace(/^\s*(?:💬\s*)?The community answered:\s*$/gim, '')
    .replace(/^\s*[—–-]\s*Posted by .*$/gim, '')
    .replace(/^\s*📞\s*Numbers mentioned:.*$/gim, '')
    .replace(/^\s*📷\s*From the attached image[s]?:.*$/gim, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/^[ \t]*[-–—:•]+[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
    .replace(/(?:call|whatsapp|contact|tel|phone)\s*[:\-]?\s*$/gim, '')
    .trim();
}

// Long or airy messages get condensed. Cuts on a sentence/line boundary.
function summarize(text, limit) {
  limit = limit || 700;
  const t = String(text || '').trim();
  const dense = t.replace(/\s+/g, ' ');
  const airy = t.length > 0 && (t.length - dense.length) / t.length > 0.25;
  if (dense.length <= limit && !airy) return t;
  const src = airy ? dense : t;
  if (src.length <= limit) return src;
  let cut = src.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (stop > limit * 0.55) cut = cut.slice(0, stop + 1);
  return cut.trim() + ' …';
}

// A title that actually describes the post.
function smartTitle(body, kind, chatName) {
  const lines = String(body || '').split('\n').map(l => stripEmoji(l).trim()).filter(Boolean);
  const junk = l => !l || l.length < 6
    || EMAIL_RE.test(l) && l.replace(EMAIL_RE, '').trim().length < 3
    || /^https?:\/\//i.test(l)
    || normalizePhone(l) !== ''
    || /^\d[\d\s.\-]*$/.test(l)
    // attribution / boilerplate, never a real title
    || /\basked:\s*$/i.test(l)
    || /^[—–-]\s*Posted by\b/i.test(l)
    || /^The community answered/i.test(l)
    || /^(?:Numbers mentioned|From the attached image)/i.test(l)
    || /^(?:hi|hello|hey|thanks|thank you|todah|shkoyach|b\"h|bh)\b[\s!.,]*$/i.test(l);
  EMAIL_RE.lastIndex = 0;
  let first = lines.find(l => !junk(l)) || '';
  // WhatsApp shouting -> sentence case, so the feed doesn't scream
  if (first && first.length > 12 && first === first.toUpperCase() && /[A-Z]{4}/.test(first)) {
    first = first.charAt(0) + first.slice(1).toLowerCase();
  }
  first = first.replace(/\((?:\+)?\d{9,}\)/g, '')
               .replace(/^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g, '')
               .replace(/\s{2,}/g, ' ').replace(/[*_~`]/g, '').trim();
  if (first.length > 90) {
    let cut = first.slice(0, 90);
    const sp = cut.lastIndexOf(' ');
    first = (sp > 45 ? cut.slice(0, sp) : cut) + '…';
  }
  if (first) return first;
  if (kind === 'rental') return 'Apartment available';
  if (kind === 'ad') return 'From a local business';
  if (kind === 'question') return 'A question for the community';
  return 'From ' + (chatName || 'the community');
}

// Cross-group duplicate detection: the same ad pasted into several groups.
// Keyed on the message text alone (group and sender deliberately excluded).
function contentKey(text) {
  const norm = stripEmoji(String(text || ''))
    .toLowerCase().replace(/[^a-z0-9֐-׿ ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter(w => w.length > 2).slice(0, 40).join(' ');
  return fingerprint(norm || String(text || '').slice(0, 200));
}
const DEDUPE_HOURS = Number(process.env.DEDUPE_HOURS || 6);
const DEDUPE_FILE = path.join(__dirname, 'recent-content.json');
let RECENT = new Map();
try { RECENT = new Map(JSON.parse(fs.readFileSync(DEDUPE_FILE, 'utf8'))); } catch (e) {}
function saveRecent() {
  try {
    const cutoff = Date.now() - DEDUPE_HOURS * 3600 * 1000 * 4;
    const keep = [...RECENT].filter(([, ts]) => ts > cutoff).slice(-5000);
    RECENT = new Map(keep);
    fs.writeFileSync(DEDUPE_FILE, JSON.stringify(keep));
  } catch (e) {}
}
function isRecentDuplicate(key, ts) {
  const prev = RECENT.get(key);
  if (prev && Math.abs(ts - prev) < DEDUPE_HOURS * 3600 * 1000) return true;
  RECENT.set(key, ts); saveRecent();
  return false;
}

// ── Message intake: normalize a WhatsApp msg into our shape ──────────────────
async function intake(msg, chatName) {
  let sender = 'Member', phone = '';
  try {
    const c = await msg.getContact();
    sender = c.pushname || c.name || 'Member';
    // c.number is a privacy LID (14-15 digits) for most senders now, not a
    // phone. Only keep it if it actually validates as a real number.
    phone = normalizePhone(c.number || '');
    if (/^\+?\d{6,}$/.test(String(sender))) sender = 'Member';
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

  // Contact details are lifted OUT of the text and into their own fields, so
  // the message body reads cleanly and the site can render them properly.
  const rawAll = msgs.map(m => m.body).join('\n') + (ocrTexts.length ? '\n' + ocrTexts.join('\n') : '');
  const contacts = {
    phones: [...new Set([...phonesInText(rawAll), ...msgs.map(m => m.phone).filter(Boolean)])],
    emails: emailsInText(rawAll),
    urls:   urlsInText(rawAll),
  };

  let title, memo;
  if (cluster.kind === 'combined') {
    const q = cleanBody(cluster.q.body, contacts);
    title = smartTitle(q, 'question', chatName);
    memo  = summarize(q, 700);
    if (cluster.answers.length) {
      const ans = cluster.answers
        .map(a => '• ' + summarize(cleanBody(a.body, contacts), 220))
        .filter(l => l.length > 4);
      if (ans.length) memo += '\n\nReplies from the group:\n' + ans.join('\n');
    }
  } else {
    const cleaned = cleanBody(first.body, contacts);
    title = smartTitle(cleaned || first.body, first.kind, chatName);
    memo  = summarize(cleaned, 900);
  }
  if (ocrTexts.length) {
    const fromImg = summarize(cleanBody(ocrTexts.join(' '), contacts), 400);
    if (fromImg) memo += '\n\nFrom the attached image: ' + fromImg;
  }
  if (!memo || memo.length < 3) memo = summarize(cleanBody(first.body, contacts), 900) || title;

  const allText = msgs.map(m => m.body).join(' ') + ' ' + ocrTexts.join(' ');
  const kinds = msgs.map(m => m.kind);
  const kind = kinds.includes('rental') ? 'rental' : kinds.includes('ad') ? 'ad' : cluster.kind === 'combined' ? 'question' : 'info';
  // A rental is a Rental. The generic classifier was tagging plenty of them
  // "Items / Questions", which is why apartments showed up under questions.
  let types = categoriesFor(allText, kind);
  if (kind === 'rental') types = ['Rental'];
  if (!Array.isArray(types) || !types.length) types = ['Community'];

  return {
    id: 'wa_' + tag,
    source: 'whatsapp',
    group: chatName,
    title: stripEmoji(title).substring(0, 150),
    memo,
    types,
    author: chatName,
    contactPhone: contacts.phones[0] || '',
    contactWebsite: contacts.urls[0] || '',
    // Rentals go live immediately; everything else still waits for Miriam.
    status: kind === 'rental' ? 'public' : 'pending',
    attachments,
    created: first.ts,
    // Content-only key so the same ad posted into several groups collapses
    // into one item instead of three.
    dedupeKey: 'wa_' + contentKey(allText),
    _contentKey: contentKey(allText),
    _kind: kind,
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
  // The bulk "list every chat" call is broken by WhatsApp for many accounts
  // (the infamous "r"). We now back-fill each group's last 48h individually,
  // the moment it sends any live message — so the bulk sweep is OFF by default.
  if (String(process.env.BULK_CATCHUP || 'off') !== 'on') {
    log('⏳ History mode: each group back-fills its last 48h on its next live message (⤴ lines).');
    log('👀 Now listening live…');
    return;
  }
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
