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
  // For @lid participants WhatsApp gives a privacy id (14-15 digits), not a
  // phone. Only keep it if it actually validates -- this is where the bogus
  // "+201..." numbers on the site were coming from.
  const rawId = participant ? participant.split('@')[0].split(':')[0] : '';
  const phone = /@lid$/i.test(participant) ? '' : normalizePhone('+' + rawId);
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
    // Rentals get Miriam's structured title; everything else keeps its own words.
    title = first.kind === 'rental'
      ? rentalTitle(first.body + ' ' + cleaned)
      : smartTitle(cleaned || first.body, first.kind, chatName);
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
