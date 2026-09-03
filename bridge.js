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
  // Same text already came through another group in the last few hours? Skip.
  if (item._contentKey && isRecentDuplicate(item._contentKey, item.created || Date.now())) {
    log('   ⊘ duplicate of a post from another group — skipped');
    return true;
  }
  delete item._contentKey; delete item._kind; delete item._msgIds;
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


// ── Group names (cached) ─────────────────────────────────────────────────────
const groupNames = new Map();
async function groupName(sock, jid) {
  if (groupNames.has(jid)) return groupNames.get(jid);
  try { const md = await sock.groupMetadata(jid); groupNames.set(jid, md.subject || jid); }
  catch (e) { groupNames.set(jid, jid.split('@')[0]); }
  return groupNames.get(jid);
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


// ═════════════════════════════════════════════════════════════════════════════
// RENTAL TITLES  (Sep 2026)
// Miriam's format, written as plain English:
//   "2 bdrm short term avail in Ramat Eshkol for Sukkos for 110/night"
// Order: bedrooms · short/long term · location · holiday (if any) · price.
// Requests ("looking for…") are prefixed "Wanted:" rather than "avail", so an
// ask is never dressed up as an offer.
// ═════════════════════════════════════════════════════════════════════════════
const HOOD_ABBR = { RE:'Ramat Eshkol', SM:'Sanhedria', RS:'Ramat Shlomo', RBS:'Ramat Bet Shemesh' };
const HOLIDAY_ABBR = { RH:'Rosh Hashana', YK:'Yom Kippur', SKS:'Sukkos' };
const HOODS = [
  'City Center (Jerusalem)',
  'Old City Bet Shemesh',
  'Ramat Bet Shemesh A',
  'Ramat Bet Shemesh B',
  'Ramat Bet Shemesh C',
  'Ramat Bet Shemesh D',
  'Sanhedria Murchevet',
  'Ramat Beit Shemesh',
  'Ramat Bet Shemesh',
  'Givat Hamivtar',
  'Kiryat Malachi',
  'Zichron Yaakov',
  'Givat Sharett',
  'Migdal HaEmek',
  'Rishon LeZion',
  'Shikun Chabad',
  'Shmuel Hanavi',
  'Zichron Moshe',
  'Arzei Habira',
  'Arzei HaBira',
  'Beit Hakerem',
  'Beit Shemesh',
  'Beit Yisrael',
  'Hod HaSharon',
  'Kiryat Moshe',
  'Kiryat Yovel',
  'Maalot Dafna',
  'Mekor Baruch',
  'Pardes Hanna',
  'Ramat Eshkol',
  'Ramat Shlomo',
  'Yerushalayim',
  'Bayit Vegan',
  'Bet Shemesh',
  'Ezras Torah',
  'French Hill',
  'Givat Shaul',
  'Gush Etzion',
  'Kiryat Belz',
  'Mattersdorf',
  'Neve Yaakov',
  'Nof HaGalil',
  'Petah Tikva',
  'Rosh HaAyin',
  'Kiryat Gat',
  'Kiryat Ono',
  'Ness Ziona',
  'Nofei Aviv',
  'Pisgat Zev',
  'Telz Stone',
  'Bnei Brak',
  'Givat Zev',
  'Givatayim',
  'Jerusalem',
  'Kfar Saba',
  'Or Yehuda',
  'Ramat Gan',
  'Sanhedria',
  'Sorotzkin',
  'Ashkelon',
  'Caesarea',
  'Har Homa',
  'Herzliya',
  'Nachalot',
  'Nachlaot',
  'Nahariya',
  'Old City',
  'Rachavia',
  'Rechavia',
  'Tel Arza',
  'Tel Aviv',
  'Tiberias',
  'Bat Yam',
  'Har Nof',
  'Karmiel',
  'Katamon',
  'Netanya',
  'Netivot',
  'Rehovot',
  'Talpiot',
  'Unsdorf',
  'Arnona',
  'Ashdod',
  'Dimona',
  'Geulah',
  'Hadera',
  'Mamila',
  'Ofakim',
  'Romema',
  'Sderot',
  'Afula',
  'Efrat',
  'Eilat',
  'Geula',
  'Haifa',
  'Holon',
  'Ramla',
  'Ramot',
  'Tzfas',
  'Yehud',
  'Akko',
  'Arad',
  'Baka',
  'Elad',
  'Gilo',
  'Yafo',
  'Lod'
];
const HOLIDAYS = [
  ['sukkos|sukkot|succos|succot|sukkah','Sukkos'], ['pesach|passover','Pesach'],
  ['rosh hashan(?:a|ah)','Rosh Hashana'], ['yom kippur','Yom Kippur'],
  ['chanuk(?:a|ah)|hanukkah','Chanuka'], ['purim','Purim'],
  ['shavuos|shavuot','Shavuos'], ['bein hazmanim','Bein Hazmanim'],
  ['chol hamoed','Chol Hamoed'], ['yom tov','Yom Tov'],
  ['summer','the summer'], ['winter','the winter']];


// Building complexes people name instead of a street. Miriam's list -- add more
// here as they come up; they're matched before the neighbourhood so a title can
// read "in Tenuva, Ramat Eshkol".
const COMPLEXES = ['Tenuva','Kaduri','Shefa','Shefa Mall','Merkaz Shefa','Grand Court','Kiryat Belz'];

// One short, specific thing that makes a listing stand out. First match wins,
// so the list is ordered from most distinctive to most generic.
const RENTAL_FEATURES = [
  [/\bpent\s?house\b/i,                         'penthouse'],
  [/\bduplex\b/i,                               'duplex'],
  [/\b(?:luxur\w*|high[- ]end|upscale)\b/i,     'luxury'],
  [/\b(?:stunning|amazing|breathtaking|gorgeous|beautiful)\s+views?\b|\bview of the (?:old city|kotel|city)\b/i, 'stunning views'],
  [/\bviews?\b/i,                               'nice views'],
  [/\b(?:s[uo]k+[ao]?h?|succ?[ao]h?)\s*(?:porch|balcony|mirpeset|deck)\b/i, 'sukkah balcony'],
  [/\b(?:newly|just|fully|recently)\s+renovated\b|\brenovated\b|\bbrand[- ]new\b/i, 'newly renovated'],
  [/\b(?:huge|big|large|spacious)\s+(?:balcon\w+|mirpeset|porch)\b/i, 'big balcony'],
  [/\b(?:top|high)\s+floor\b/i,                 'high floor'],
  [/\bground\s+floor\b/i,                       'ground floor'],
  [/\b(?:private\s+)?(?:garden|yard|gina)\b/i,  'private garden'],
  [/\b(?:huge|spacious|large|roomy)\b/i,        'spacious'],
  [/\bfully\s+furnished\b|\bfurnished\b/i,      'fully furnished'],
  [/\b(?:private\s+)?parking\b|\bchanaya\b/i,   'parking included'],
  [/\belevator\b|\bmaalit\b/i,                  'elevator'],
  [/\b(?:cheap|bargain|great\s+price|price\s+drop|reduced|must\s+go)\b/i, 'great price'],
  [/\b(?:great|prime|central|amazing|perfect)\s+location\b|\bvery\s+central\b/i, 'great location'],
  [/\b(?:steps|walking\s+distance|next\s+door)\s+(?:to|from)\b|\bnear\s+(?:shul|kotel|shops)\b/i, 'walk to shul'],
  [/\bquiet\b|\bpeaceful\b/i,                   'quiet street'],
  [/\bwasher\b.*\bdryer\b|\bdryer\b/i,          'washer & dryer'],
  [/\bmachsan\b|\bstorage\b/i,                  'storage room'],
  [/\bmirpeset\b|\bbalcon\w+\b|\bporch\b/i,     'balcony'],
];
function rentalFeature(text) {
  const t = String(text || '');
  for (const [re, label] of RENTAL_FEATURES) if (re.test(t)) return label;
  return '';
}

function rentalTitle(text) {
  const t = String(text || '');
  const low = t.toLowerCase();

  const NUMWORDS = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  const NUMW = '(?:one|two|three|four|five|six|seven|eight|nine|ten)';
  let beds = '';
  let m = low.match(/(\d+)\s*(?:or|to|-|,|\/)\s*(\d+)\s*(?:bdrm|bedroom|bed\b|br\b|room)/);
  if (m) beds = m[1] + '-' + m[2] + ' bdrm';
  else if ((m = low.match(/(\d+)\s*\+?\s*(?:bdrm|bedrooms?|beds?\b|br\b)/))) beds = m[1] + ' bdrm';
  else if (/\bstudio\b/.test(low)) beds = 'studio';
  else if ((m = low.match(new RegExp('\\b' + NUMW + '\\s*(?:or|to|-)\\s*' + NUMW + '\\s*(?:bdrm|bedrooms?|beds?|br\\b|room)'))))
    { const w = m[0].match(new RegExp(NUMW,'g')); beds = NUMWORDS[w[0]] + '-' + NUMWORDS[w[1]] + ' bdrm'; }
  else if ((m = low.match(new RegExp('\\b(' + NUMW + ')\\s*(?:bdrm|bedrooms?|beds?\\b|br\\b|room)'))))
    beds = NUMWORDS[m[1]] + ' bdrm';
  else if (/\b(?:single|private)\s+room\b|\broom available\b/.test(low)) beds = 'room';

  let term = '';
  const explicitShort = /\bshort[-\s]?term\b|\bnightly\b|per night|a night|\/\s*night|\bweekend\b|\bvacation\b/.test(low);
  const explicitLong  = /\blong[-\s]?term\b|\byearly\b|\bannual\b|per month|a month|\/\s*month|\bmonthly\b|year lease/.test(low);
  if (explicitShort) term = 'short term';
  else if (explicitLong) term = 'long term';

  let loc = '', locAt = Infinity;
  for (const h of HOODS) {
    const i = low.indexOf(h.toLowerCase());
    // earliest mention wins; on a tie the longer, more specific name wins
    // (so "Sanhedria Murchevet" beats "Sanhedria" at the same position)
    if (i > -1 && (i < locAt || (i === locAt && h.length > loc.length))) { locAt = i; loc = h; }
  }
  let complex = '';
  for (const c of COMPLEXES) {
    if (new RegExp('\\b' + c.replace(/\s+/g, '\\s+') + '\\b', 'i').test(t)) { complex = c; break; }
  }
  const place = complex && loc ? (complex + ', ' + loc) : (complex || loc);
  if (!loc) for (const k in HOOD_ABBR) { if (new RegExp('\\b' + k + '\\b').test(t)) { loc = HOOD_ABBR[k]; break; } }

  let hol = '';
  for (const [pat, name] of HOLIDAYS) { if (new RegExp('\\b(?:' + pat + ')\\b').test(low)) { hol = name; break; } }
  if (!hol) for (const k in HOLIDAY_ABBR) { if (new RegExp('\\b' + k + '\\b').test(t)) { hol = HOLIDAY_ABBR[k]; break; } }

  let price = '';
  const pm = t.match(/(?:₪|\$|nis\s*)?\s*(\d[\d,]{1,6})\s*(?:₪|nis|shekels?|\$)?\s*(?:\/|\s+per\s+|\s+a\s+)\s*(night|nite|month|mo\b|week)/i);
  if (pm) {
    const n = Number(pm[1].replace(/,/g, ''));
    if (n >= 20 && n <= 200000) {
      const unit = /night|nite/i.test(pm[2]) ? 'night' : /week/i.test(pm[2]) ? 'week' : 'month';
      price = (/\$/.test(pm[0]) ? '$' : '₪') + n + '/' + unit;
    }
  }

  // A monthly price means long term, a nightly one short term -- unless she
  // actually wrote "short term" / "long term", which always wins.
  if (price && !explicitShort && !explicitLong) term = /\/month$/.test(price) ? 'long term' : 'short term';
  else if (price && /\/month$/.test(price) && explicitShort && !/\bshort[-\s]?term\b/.test(low)) term = 'long term';

  // "Looking to rent" contains the words "to rent", so an offer test alone
  // read requests as offers. A request phrase now always wins.
  const wants = /\b(?:looking (?:for|to rent)|want(?:ed|ing)? to rent|in search of|seeking\b|wanted\b|iso\b|anyone (?:know|have|got)|need(?:ed|ing)?\s+(?:a|an|to|small|big|\d))/.test(low);

  const head = [beds, term].filter(Boolean).join(' ');
  let out = wants
    ? 'Wanted: ' + (head || 'apartment')
    : (head || 'Apartment') + ' avail';
  if (place) out += ' in ' + place;
  if (hol)   out += ' for ' + hol;
  if (price) out += ' for ' + price;
  const feat = rentalFeature(t);
  if (feat) out += ' — ' + feat;
  return out.charAt(0).toUpperCase() + out.slice(1);
}


// ── Rental facts: bedrooms, term, price, per night/month ─────────────────────
// Read out of the text so a WhatsApp rental carries the same structured fields
// as one posted through the site's form — which is what makes the site's
// rental filters (bedrooms, short/long, price) work on it. The site runs the
// same rules for anything that arrived before this existed.
const _NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
function rentalFacts(text) {
  const low = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  const out = {};
  let m;
  if (/\bstudio\b/.test(low)) out.beds = 0;
  else if ((m = low.match(/(\d+(?:\.5)?)\s*\+?\s*(?:bdrm|bdrms|bedrooms?|beds?\b|br\b|rooms?\b)/))) out.beds = Math.round(parseFloat(m[1]));
  else if ((m = low.match(/\b(one|two|three|four|five|six|seven|eight)\s*(?:bdrm|bedrooms?|beds?\b|br\b|rooms?\b)/))) out.beds = _NUMW[m[1]];
  const isLong = /\blong[- ]?term\b|\byearly\b|\bannual\b|\blease\b|\bunfurnished\b|\bfor the year\b/.test(low);
  const isShort = /\bshort[- ]?term\b|\bsukk?o[st]\b|\bsucc?o[st]\b|\bpesach\b|\bpassover\b|\byom kippur\b|\byk\b|\brosh hashan?ah?\b|\brh\b|\bchagim\b|\bchag\b|\btishrei\b|\bholiday\b|\bvacation\b|\bweekend\b|\bshabbo?s\b|\bshabbat\b|\bper night\b|\/night|\ba night\b|\bnightly\b|\bbein hazmanim\b|\bsummer\b|\bshort[- ]?let\b/.test(low);
  if (isLong && !isShort) out.term = 'long';
  else if (isShort && !isLong) out.term = 'short';
  else if (isLong) out.term = 'long';
  const P = [
    /(?:₪|nis|shekels?|\$|usd)\s*(\d{1,3}(?:,\d{3})+|\d{3,6})\b(?:\s*(?:\/|per|a|for the)\s*(night|nite|month|mo\b|week))?/,
    /(\d{1,3}(?:,\d{3})+|\d{3,6})\s*(?:₪|nis|shekels?|sh\b|\$|usd)(?:\s*(?:\/|per|a)\s*(night|nite|month|mo\b|week))?/,
    /(\d{1,3}(?:,\d{3})+|\d{3,6})\s*(?:\/|per|a)\s*(night|nite|month|mo\b|week)/,
    /(\d{1,2})k\b(?:\s*(?:\/|per|a)\s*(night|nite|month|mo\b))?/,
  ];
  for (const re of P) {
    const mm = low.match(re);
    if (!mm) continue;
    let n = parseInt(mm[1].replace(/,/g, ''), 10);
    if (re === P[3]) n *= 1000;
    if (n < 100 || n > 200000) continue;
    out.price = String(n);
    const unit = mm[2] || '';
    if (/night|nite/.test(unit)) out.priceMode = 'night';
    else if (/month|mo/.test(unit)) out.priceMode = 'month';
    else if (/week/.test(unit)) out.priceMode = 'night';
    break;
  }
  if (out.price && !out.priceMode) {
    if (/\b(per night|\/night|a night|nightly|\/n\b)\b/.test(low)) out.priceMode = 'night';
    else if (/\b(per month|\/month|a month|monthly|\/m\b)\b/.test(low)) out.priceMode = 'month';
    else out.priceMode = out.term === 'short' ? 'night' : 'month';
  }
  if (!out.priceMode && out.term) out.priceMode = out.term === 'short' ? 'night' : 'month';
  return out;
}

// ── Message intake: Baileys message → our shape ──────────────────────────────
function innerOf(m) {
  const msg = m.message || {};
  return msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message || msg;
}
function textOf(m) {
  const inner = innerOf(m);
  return inner.conversation || inner.extendedTextMessage?.text || inner.imageMessage?.caption || inner.videoMessage?.caption || inner.documentMessage?.caption || '';
}
// The contextInfo (quoted message, @mentions) lives inside whichever message
// type this happens to be.
function ctxOf(m) {
  const inner = innerOf(m);
  for (const k of Object.keys(inner)) {
    const v = inner[k];
    if (v && typeof v === 'object' && v.contextInfo) return v.contextInfo;
  }
  return null;
}
// A shared contact (vCard) → { name, phones[] }
function parseVcard(vc, fallbackName) {
  const name = (String(vc || '').match(/^FN:(.+)$/m) || [])[1] || fallbackName || '';
  const phones = [];
  for (const line of String(vc || '').split(/\r?\n/)) {
    if (!/^(?:item\d+\.)?TEL/i.test(line)) continue;
    const waid = (line.match(/waid=(\d+)/) || [])[1];
    const raw = line.split(':').slice(1).join(':').trim();
    const p = normalizePhone(waid ? '+' + waid : raw) || normalizePhone(raw);
    if (p && !phones.includes(p)) phones.push(p);
  }
  return { name: stripEmoji(name).trim(), phones };
}
function cardsOf(m) {
  const inner = innerOf(m);
  const out = [];
  if (inner.contactMessage) out.push(parseVcard(inner.contactMessage.vcard, inner.contactMessage.displayName));
  if (inner.contactsArrayMessage && Array.isArray(inner.contactsArrayMessage.contacts))
    for (const c of inner.contactsArrayMessage.contacts) out.push(parseVcard(c.vcard, c.displayName));
  return out.filter(c => c.name || c.phones.length);
}
// A link with WhatsApp's own preview (title / description)
function linkOf(m) {
  const e = innerOf(m).extendedTextMessage;
  if (!e) return null;
  const url = e.canonicalUrl || e.matchedText || (urlsInText(e.text || '')[0]);
  if (!url) return null;
  return { url, title: stripEmoji(e.title || '').trim(), description: stripEmoji(e.description || '').trim().slice(0, 200) };
}
// Names we have seen people use, by phone/id -- so "@Sara" can become a real
// name and number in a comment.
const NAMES_FILE = path.join(__dirname, 'names.json');
let NAMES = new Map();
try { NAMES = new Map(JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8'))); } catch (e) {}
const saveNames = () => { try { fs.writeFileSync(NAMES_FILE, JSON.stringify([...NAMES].slice(-20000))); } catch (e) {} };
function imageOf(m) {
  const msg = m.message || {};
  const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg;
  return inner.imageMessage || null;
}
async function intake(sock, m, chatName) {
  const key = m.key || {};
  const participant = key.participant || key.remoteJid || '';
  // For @lid participants WhatsApp gives a privacy id (14-15 digits), not a
  // phone. Only keep it if it actually validates -- this is where the bogus
  // "+201..." numbers on the site were coming from.
  const rawId = participant ? participant.split('@')[0].split(':')[0] : '';
  // Newer WhatsApp groups identify people by a privacy id (@lid), not their
  // number. Baileys usually supplies the real number alongside it
  // (participantAlt); failing that, ask its lid→number mapping. This is what
  // lets "pls pm me" posts carry the poster's own number.
  let pnJid = key.participantAlt || key.remoteJidAlt || '';
  if (!pnJid && /@lid$/i.test(participant)) {
    try {
      const map = sock && sock.signalRepository && sock.signalRepository.lidMapping;
      if (map && typeof map.getPNForLID === 'function') { const r = await map.getPNForLID(participant); if (r) pnJid = String(r); }
    } catch (e) {}
  }
  const pnDigits = pnJid ? String(pnJid).split('@')[0].split(':')[0] : '';
  const phone = pnDigits ? normalizePhone('+' + pnDigits) : (/@lid$/i.test(participant) ? '' : normalizePhone('+' + rawId));
  if (pnDigits && m.pushName) NAMES.set(pnDigits, m.pushName);
  const sender = m.pushName || 'Member';
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
  if (rawId && m.pushName) { NAMES.set(rawId, m.pushName); }
  const ctx = ctxOf(m) || {};
  const quotedId = ctx.stanzaId || '';
  const mentions = (ctx.mentionedJid || []).map(j => String(j).split('@')[0].split(':')[0]).filter(Boolean);
  const cards = cardsOf(m);
  const link = linkOf(m);
  // A contact card or a link with no words is still a real answer.
  let kind = classify(body, !!media);
  if ((cards.length || link) && (kind === 'chatter' || kind === 'info')) kind = 'answer';
  return { id: key.id || String(Date.now()+Math.random()), ts, chat: chatName, sender, phone, body, media, kind,
           quotedId, mentions, cards, link };
}


// ── Threads ─────────────────────────────────────────────────────────────────
// Every WhatsApp message we turn into (or fold into) a post is remembered by
// its message id, so a reply that quotes it -- an hour or a day later -- lands
// as a comment on that post instead of becoming a choppy post of its own.
const THREADS_FILE = path.join(__dirname, 'threads.json');
let THREADS = new Map();   // messageId → { post, dedupeKey, ts }
try { THREADS = new Map(JSON.parse(fs.readFileSync(THREADS_FILE, 'utf8'))); } catch (e) {}
const saveThreads = () => { try { fs.writeFileSync(THREADS_FILE, JSON.stringify([...THREADS].slice(-20000))); } catch (e) {} };
function rememberThread(msgIds, post) {
  for (const id of msgIds) if (id) THREADS.set(id, { post: post.id, dedupeKey: post.dedupeKey, ts: Date.now() });
  saveThreads();
}
// The last open question per chat: an answer that quotes nothing but arrives
// within a few hours still belongs to it.
const LAST_Q = new Map();   // chatName → { id, post, ts }
const ANSWER_WINDOW_MS = 3 * 3600 * 1000;

// How a reply reads as a comment: its words, then any contact card, link or
// @mention spelled out with a name and number.
function nameFor(digits) { return NAMES.get(digits) || ''; }
function commentTextOf(m) {
  const parts = [];
  let text = stripEmoji(m.body || '').trim();
  // "@~Sara" / "@972…" → the person, spelled out below with a number
  if ((m.mentions || []).length) {
    text = text.replace(/@~?[\w.\-]+/g, (all) => {
      const d = all.replace(/\D/g, '');
      const nm = d ? nameFor(d) : '';
      return nm ? nm : '';
    }).replace(/\s{2,}/g, ' ').trim();
  }
  if (m.link && text && text.replace(m.link.url, '').trim().length < 3) text = '';
  if (text) parts.push(text);
  for (const c of (m.cards || [])) {
    const line = [c.name, c.phones.join(', ')].filter(Boolean).join(' — ');
    if (line) parts.push(line);
  }
  if (m.link) parts.push([m.link.title, m.link.url].filter(Boolean).join(' — '));
  for (const d of (m.mentions || [])) {
    const nm = nameFor(d); const ph = /^\d{9,13}$/.test(d) ? normalizePhone('+' + d) : '';
    if (nm || ph) {
      const line = [nm || 'Contact', ph].filter(Boolean).join(' — ');
      if (!parts.some(p => p.includes(line))) parts.push(line);
    }
  }
  return parts.join('\n').trim();
}
function phonesOfMsg(m) {
  const out = new Set(phonesInText(m.body || ''));
  for (const c of (m.cards || [])) c.phones.forEach(p => out.add(p));
  for (const d of (m.mentions || [])) { const p = /^\d{9,13}$/.test(d) ? normalizePhone('+' + d) : ''; if (p) out.add(p); }
  return [...out];
}

// A question, as a title: the topic, not the whole sentence.
function questionTitle(text) {
  let t = stripEmoji(String(text || '')).replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:hi|hello|hey|good (?:morning|evening|afternoon))[,!. ]*/i, '');
  t = t.replace(/^(?:or|and|also|so|ok|okay)[,\s]+/i, '');
  t = t.replace(/\?.*$/, '').replace(/[.!]+$/, '').trim();
  const FILL = '(?:(?:a|an|the|of|any|some|good|great|reliable|nice|decent|number|numbers|contact|contacts|info|details|name|names|leads?|recs?|recommendations?)\\s+(?:for\\s+|of\\s+)?)*';
  const seek = new RegExp('^(?:does |do )?(?:anyone|anybody|someone|any1|ne1|any one)\\s+(?:here\\s+)?(?:have|has|hv|got|know(?:s)?(?: of)?|recommend(?:s)?|use(?:s|d)?)\\s+' + FILL, 'i');
  const seek2 = /^(?:any (?:leads?|recs?|recommendations?|suggestions?|ideas?|info)\s+(?:for|on|of|about)\s+|looking for\s+(?:a |an |the |some )?|(?:i |we )?need\s+(?:a |an |the |some )?(?:recommendation for |rec for |good )?|who (?:has|knows|does|is doing|is giving|gives|makes|sells|can recommend)\s+(?:a |an |the )?|where can (?:i|we|one) (?:find|get|buy)\s+(?:a |an |the |some )?|is there (?:a |an |any |anyone who )?|can (?:anyone|someone) recommend\s+(?:a |an |the )?|(?:any|anyone) recs? for\s+)/i;
  let core = t, seeking = false;
  if (seek.test(t)) { core = t.replace(seek, ''); seeking = true; }
  else if (seek2.test(t)) { core = t.replace(seek2, ''); seeking = true; }
  else if (/^(?:does |do )?(?:anyone|anybody|someone)\s+/i.test(t)) { core = t.replace(/^(?:does |do )?(?:anyone|anybody|someone)\s+/i, ''); }
  core = core.replace(/\s+(?:that|who|which)\s+(?:talks?|speaks?|is|are|can|does|do|will|would|has|have)\b.*$/i, '')
             .replace(/\s+(?:please|pls|plz|tia|thanks|thank you|urgent(?:ly)?)\b.*$/i, '')
             .replace(/\s+(?:to recommend|recommendation)$/i, '')
             .trim();
  const words = core.split(' ').filter(Boolean);
  if (words.length > 9) core = words.slice(0, 9).join(' ');
  if (!core) return '';
  const acronym = /^[A-Z]{2,}/.test(core);       // "IV hydration" stays "IV"
  core = core.charAt(0).toUpperCase() + core.slice(1);
  if (!seeking) return core;
  return 'Seeking ' + (acronym ? core : core.charAt(0).toLowerCase() + core.slice(1));
}

// Who a reply belongs to: the post of the message it quotes, or of the last
// open question in that chat if it looks like an answer.
const FOLLOWUP_MS = 15 * 60 * 1000;
const LAST_ACT = new Map();   // chatName → { ts, post, cluster, people:Set }
function noteActivity(chat, m, ref) {
  const cur = LAST_ACT.get(chat) || { people: new Set() };
  cur.ts = m.ts; if (ref.cluster) { cur.cluster = ref.cluster; cur.post = null; } else { cur.post = ref.sent; cur.cluster = null; }
  cur.people.add(m.sender); LAST_ACT.set(chat, cur);
}
function resolveParent(m, batchIndex) {
  const viaBatch = (id) => {
    const e = batchIndex.get(id);
    if (!e) return null;
    return e.kind === 'sent' ? { sent: e.target } : { cluster: e };
  };
  if (m.quotedId) {
    const b = viaBatch(m.quotedId); if (b) return b;
    const t = THREADS.get(m.quotedId);
    if (t) return { sent: t };
  }
  const isAnswerish = m.kind === 'answer' || (m.cards && m.cards.length) || m.link;
  if (isAnswerish) {
    const lq = LAST_Q.get(m.chat);
    if (lq && m.ts - lq.ts < ANSWER_WINDOW_MS) {
      const b = viaBatch(lq.id); if (b) return b;
      if (lq.post) return { sent: lq.post };
    }
  }
  // A short follow-up right after a thread was active -- "Where is she
  // located?" / "Mem gimmel" -- belongs to that thread when it's a question
  // or comes from someone already in the conversation.
  const la = LAST_ACT.get(m.chat);
  if (la && m.ts - la.ts < FOLLOWUP_MS && m.kind !== 'question' && m.kind !== 'rental' && m.kind !== 'ad') {
    const short = stripEmoji(m.body || '').length <= 80;
    const asks = /\?/.test(m.body || '');
    if ((asks || la.people.has(m.sender)) && short && !m.media) {
      if (la.cluster) return { cluster: la.cluster };
      if (la.post) return { sent: la.post };
    }
  }
  return null;
}

// Group a flush window into posts and comments.
//  {kind:'combined', q, answers[]}  a question with its replies
//  {kind:'single', msgs:[m]}         a rental, an ad, a recommendation on its own
//  {kind:'comment', target, msg}     a reply to a post we already sent
function clusterThreads(msgs) {
  const out = [];
  const batchIndex = new Map();   // messageId → cluster in this batch
  for (const m of msgs) {
    const hasStuff = (m.cards && m.cards.length) || m.link || m.media;
    const parent = resolveParent(m, batchIndex);
    if (m.kind === 'chatter' && !hasStuff && !parent) continue;
    if (parent && parent.cluster) {
      const c = parent.cluster;
      if (c.kind === 'combined') c.answers.push(m); else { c.kind = 'combined'; c.q = c.msgs[0]; c.answers = [m]; }
      batchIndex.set(m.id, c);
      noteActivity(m.chat, m, { cluster: c });
      continue;
    }
    if (parent && parent.sent) {
      if (m.kind === 'chatter' && !hasStuff && stripEmoji(m.body || '').length < 4) continue;
      out.push({ kind: 'comment', target: parent.sent, msg: m });
      batchIndex.set(m.id, { kind: 'sent', target: parent.sent });   // so a reply to THIS reply follows too
      noteActivity(m.chat, m, { sent: parent.sent });
      continue;
    }
    if (m.kind === 'rental' || m.kind === 'ad') { const c = { kind: 'single', msgs: [m] }; out.push(c); batchIndex.set(m.id, c); continue; }
    if (m.kind === 'question') {
      const c = { kind: 'combined', q: m, answers: [] };
      out.push(c); batchIndex.set(m.id, c);
      LAST_Q.set(m.chat, { id: m.id, ts: m.ts, post: null });
      LAST_ACT.set(m.chat, { ts: m.ts, cluster: c, post: null, people: new Set([m.sender]) });
      continue;
    }
    if (m.kind === 'chatter') continue;
    const c = { kind: 'single', msgs: [m] }; out.push(c); batchIndex.set(m.id, c);
  }
  return out;
}

// A comment on a post the site already has.
async function sendComment(target, m) {
  const content = commentTextOf(m);
  if (!content) return false;
  const post = typeof target === 'string' ? { post: target } : target;
  try {
    const r = await fetch(INGEST_URL + '?file=updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-key': INGEST_KEY },
      body: JSON.stringify({ file: 'updates', action: 'comment',
        target: { id: post.post, dedupeKey: post.dedupeKey || '' },
        comment: { author: m.sender || 'Member', content: content.slice(0, 2000), timestamp: m.ts || Date.now() } }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) { log('   ↳ comment added to "' + (j.title || post.post) + '": ' + content.slice(0, 50).replace(/\n/g, ' ')); THREADS.set(m.id, { post: post.post, dedupeKey: post.dedupeKey, ts: Date.now() }); saveThreads(); return true; }
    log('   ↳ comment not added (' + r.status + ' ' + (j.error || '') + ')');
    return false;
  } catch (e) { log('   ↳ comment failed: ' + (e && e.message)); return false; }
}

// ── Build the final Chutznik post from a cluster ─────────────────────────────
async function buildPost(cluster, chatName) {
  const msgs = cluster.kind === 'combined' ? [cluster.q, ...cluster.answers] : cluster.msgs;
  const first = msgs[0];
  const tag = first.id.replace(/[^a-zA-Z0-9]/g, '').slice(-16);

  // images: upload + OCR
  const attachments = []; const ocrTexts = []; const ocrByMsg = new Map();
  let idx = 0;
  for (const m of msgs) {
    if (!m.media) continue;
    const url = await uploadImage(m.media.base64, m.media.mime, tag, idx++);
    if (url) attachments.push({ url, name: 'photo' + idx + '.jpg' });
    const t = await ocrImage(m.media.base64);
    if (t) { ocrTexts.push(t); ocrByMsg.set(m.id, t); }
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
  const comments = [];
  if (cluster.kind === 'combined') {
    // The question is the post -- short title, the ask itself as the body --
    // and every reply is a comment, in the replier's name, with any contact
    // card, link or @mention written out as a name and number.
    const q = cleanBody(cluster.q.body, contacts);
    title = questionTitle(cluster.q.body) || smartTitle(q, 'question', chatName);
    memo  = summarize(q, 700);
    for (const a of cluster.answers) {
      let content = commentTextOf(a);
      const flyer = ocrByMsg.get(a.id);
      if (flyer) content = (content ? content + '\n' : '') + 'From the flyer: ' + summarize(cleanBody(flyer, contacts), 300);
      if (!content || content.length < 2) continue;
      const last = comments[comments.length - 1];
      if (last && last.author === (a.sender || 'Member') && Math.abs((a.ts || 0) - last.timestamp) < 2 * 60 * 1000) {
        last.content = (last.content + '\n' + content).slice(0, 2000);
        continue;
      }
      comments.push({ author: a.sender || 'Member', content: content.slice(0, 2000), timestamp: a.ts || first.ts });
    }
  } else if (first.cards && first.cards.length && first.kind !== 'rental' && first.kind !== 'ad') {
    // A shared contact with a word of praise: the contact is the post.
    const card = first.cards[0];
    title = card.name || smartTitle(cleanBody(first.body, contacts), first.kind, chatName);
    const praise = stripEmoji(first.body || '').trim();
    memo = [praise, ...first.cards.map(c => [c.name, c.phones.join(', ')].filter(Boolean).join(' — '))].filter(Boolean).join('\n');
  } else if (first.link && first.link.title && !first.kind.match(/rental|ad/)) {
    title = first.link.title.slice(0, 90);
    memo = [stripEmoji(first.body || '').replace(first.link.url, '').trim(), first.link.description, first.link.url].filter(Boolean).join('\n');
  } else {
    const cleaned = cleanBody(first.body, contacts);
    // Rentals get Miriam's structured title; everything else keeps its own words.
    title = first.kind === 'rental'
      ? rentalTitle(first.body + ' ' + cleaned)
      : smartTitle(cleaned || first.body, first.kind, chatName);
    memo  = summarize(cleaned, 900);
  }
  if (ocrTexts.length && cluster.kind !== 'combined') {
    const fromImg = summarize(cleanBody(ocrTexts.join(' '), contacts), 400);
    if (fromImg) memo += '\n\nFrom the attached image: ' + fromImg;
  }
  if (!memo || memo.length < 3) memo = summarize(cleanBody(first.body, contacts), 900) || title;

  const allText = msgs.map(m => m.body).join(' ') + ' ' + ocrTexts.join(' ')
    + ' ' + msgs.flatMap(m => (m.cards || []).map(c => c.name)).join(' ')
    + ' ' + msgs.map(m => m.link ? (m.link.title + ' ' + m.link.description) : '').join(' ');
  // numbers from cards and @mentions count as the post's contact too -- and
  // for a question, the answers' numbers come first; the asker's own number
  // is not the recommendation.
  if (cluster.kind === 'combined') {
    const fromAnswers = [];
    for (const a of cluster.answers) for (const p of phonesOfMsg(a)) if (!fromAnswers.includes(p)) fromAnswers.push(p);
    const askerOwn = cluster.q.phone ? [cluster.q.phone] : [];
    contacts.phones = fromAnswers.concat(contacts.phones.filter(p => !fromAnswers.includes(p) && !askerOwn.includes(p)));
    // A question nobody has answered yet: the asker's own WhatsApp number is
    // the way to reply to her, so it goes on the post.
    if (!contacts.phones.length && cluster.q.phone) contacts.phones.push(cluster.q.phone);
  } else {
    for (const m of msgs) for (const p of phonesOfMsg(m)) if (!contacts.phones.includes(p)) contacts.phones.push(p);
    // "pls pm me" / "dm me" / "message me" with no number in the text: the
    // sender's own number is the contact.
    const pm = /\b(?:pm|dm|message|msg|whatsapp|text|contact|call)\s+(?:me|us)\b|\bpm\b|\bp\.m\.?\b|\bprivate(?:ly)?\b|\bpls\s+pm\b/i.test(allText);
    if ((pm || first.kind === 'question') && first.phone && !contacts.phones.includes(first.phone)) contacts.phones.unshift(first.phone);
  }
  const kinds = msgs.map(m => m.kind);
  const kind = kinds.includes('rental') ? 'rental' : kinds.includes('ad') ? 'ad' : cluster.kind === 'combined' ? 'question' : 'info';
  // A rental is a Rental. The generic classifier was tagging plenty of them
  // "Items / Questions", which is why apartments showed up under questions.
  let types = categoriesFor(allText, kind);
  if (kind === 'rental') types = ['Rental'];
  if (!Array.isArray(types) || !types.length) types = ['Community'];

  // Structured rental fields, so the site's filters treat this like a form post.
  const facts = kind === 'rental' ? rentalFacts(title + '\n' + memo + '\n' + allText) : {};

  return {
    id: 'wa_' + tag,
    source: 'whatsapp',
    group: chatName,
    ...facts,
    title: stripEmoji(title).substring(0, 150),
    memo,
    types,
    // A question-and-answers post is Chutznik's own digest; a plain forward
    // still says which group it came from.
    author: cluster.kind === 'combined' ? 'Chutznik' : chatName,
    comments,
    lastCommentTime: comments.length ? Math.max(...comments.map(c => c.timestamp)) : undefined,
    _msgIds: msgs.map(m => m.id),
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
  if (!waiting) return;
  for (const [chatName, msgs] of buffers) {
    if (!msgs.length) continue;
    buffers.set(chatName, []);
    msgs.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const clusters = clusterThreads(msgs);
    const nPosts = clusters.filter(c => c.kind !== 'comment').length, nCmts = clusters.length - nPosts;
    log('📦 ' + chatName + ': ' + msgs.length + ' msg(s) → ' + nPosts + ' post(s)' + (nCmts ? ' + ' + nCmts + ' comment(s) on earlier posts' : ''));
    for (const cl of clusters) {
      try {
        if (cl.kind === 'comment') { await sendComment(cl.target, cl.msg); continue; }
        const post = await buildPost(cl, chatName);
        const msgIds = post._msgIds || []; delete post._msgIds;
        if (SEEN.has(post.dedupeKey)) {
          // the same question already went out (another group, or a re-send):
          // the replies still belong to it
          const prior = [...THREADS.values()].find(t => t.dedupeKey === post.dedupeKey);
          if (prior && cl.kind === 'combined') for (const a of cl.answers) await sendComment(prior, a);
          log('   ≈ similar post already sent — skipped'); continue;
        }
        const ok = await sendToQueue(post);
        if (ok) {
          SEEN.add(post.dedupeKey); saveSeen();
          rememberThread(msgIds, post);
          if (cl.kind === 'combined') {
            const ref = { post: post.id, dedupeKey: post.dedupeKey };
            LAST_Q.set(chatName, { id: cl.q.id, ts: cl.q.ts, post: ref });
            const la = LAST_ACT.get(chatName); if (la && la.cluster === cl) { la.cluster = null; la.post = ref; }
          }
        }
      } catch (e) { log('   post build failed: ' + (e && e.message)); }
    }
  }
}
setInterval(flush, FLUSH_MINUTES * 60 * 1000);

// ── Chutznik reply drafts → Miriam's inbox ──────────────────────────────────
// The drafter writes suggested replies into drafts.json; the site emails each
// one to Miriam exactly once. This machine is always on and can reach the
// site, so it gives the site a nudge every few minutes. Cheap and idempotent.
async function nudgeDraftEmails() {
  try {
    const r = await fetch(SITE + '/api/send-email?drafts=1', { signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    if (j && j.sent) log('✉️  draft emails sent: ' + j.sent + (j.failed ? ' (failed ' + j.failed + ')' : ''));
  } catch (e) { /* the next nudge will get it */ }
}
setInterval(nudgeDraftEmails, 3 * 60 * 1000);
setTimeout(nudgeDraftEmails, 20 * 1000);


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
  saveSeen(); saveNames();
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
