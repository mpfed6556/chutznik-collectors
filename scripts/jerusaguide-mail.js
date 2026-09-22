// ── Jerusaguide → "there's more on Chutznik" (Miriam, 15 Sep 2026) ───────────
// Watches the Gmail inbox for posts from the jerusaguide Google Group. When
// someone posts a rental, or asks for one — or posts a job, or asks for one —
// they get one short email from a Chutznik address pointing them to the site.
//
//   subject:  rental info   (jobs: job info)
//   body:     hi! I saw you just posted a rental on jerusaguide. there are
//             people looking to rent here 👉 chutznik.org  hatzlachah!
//             (or: I saw you're looking for a rental … there are tons listed here …)
//
// Nobody ever hears from us twice: every address written to is kept in
// jg-told.json for good, whatever they post later.
//
// .env:  JG_MODE=off|dry|live   (off = built but not running — the default)
//        JG_GROUP=jerusaguide@googlegroups.com
//        JG_FROM="Chutznik <info@chutznik.org>"   JG_REPLY_TO=info@chutznik.org   (from and replies: info@)
//        RESEND_API_KEY=…  (the same key the site uses; else Gmail SMTP through nodemailer)
//        JG_HOURS=48 (how far back to look)   JG_DAILY=25 (at most, per day)
'use strict';
const fs = require('fs');
const path = require('path');

const MODE = String(process.env.JG_MODE || 'off').toLowerCase();
const GROUP = String(process.env.JG_GROUP || 'jerusaguide@googlegroups.com').toLowerCase();
const GROUP_KEY = GROUP.split('@')[0];                       // "jerusaguide"
const FROM = process.env.JG_FROM || 'Chutznik <info@chutznik.org>';
const REPLY_TO = process.env.JG_REPLY_TO || 'info@chutznik.org';
const HOURS = Number(process.env.JG_HOURS || 48);
const DAILY = Number(process.env.JG_DAILY || 25);
const SITE = (process.env.JG_SITE || 'https://chutznik.org').replace(/\/$/, '');
const TOLD_FILE = path.join(__dirname, '..', 'jg-told.json');
const SEEN_FILE = path.join(__dirname, '..', 'jg-seen.json');

let TOLD = {}; try { TOLD = JSON.parse(fs.readFileSync(TOLD_FILE, 'utf8')) || {}; } catch (e) {}
let SEEN = new Set(); try { SEEN = new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))); } catch (e) {}
const saveTold = () => { try { fs.writeFileSync(TOLD_FILE, JSON.stringify(TOLD, null, 1)); } catch (e) {} };
const saveSeen = () => { try { fs.writeFileSync(SEEN_FILE, JSON.stringify([...SEEN].slice(-5000))); } catch (e) {} };

// ── what kind of post is it? ────────────────────────────────────────────────
const RENTAL_RE = /\b(apartment|apt|flat|dira|dirah|rental|rent|sublet|sub-?let|to let|for let|lease|bdrm|bedroom|bedrooms|\d\s*br\b|studio|penthouse|furnished|short.?term|long.?term|tenant|landlord|roommate|room ?mate|housing|accommodation)\b/i;
const JOB_RE = /\b(job|jobs|position|hiring|hire|employment|vacancy|opening|openings|full.?time|part.?time|salary|resume|cv\b|work from home|remote work|freelance|babysitter|babysitting|nanny|cleaner|cleaning lady|housekeeper|caregiver|tutor|secretary|receptionist|bookkeeper|assistant|looking to hire|seeking (?:a|an) (?:\w+ )?(?:worker|employee|teacher|nanny|babysitter|cleaner|tutor|driver))\b/i;
// asking for one, rather than offering one
const SEEK_RE = /\b(looking for|seeking|searching for|in search of|iso\b|wanted|need(?:s|ed)? (?:a|an|to find)|anyone (?:know|have|renting)|does anyone|is there|any(?:body|one) (?:looking|renting|hiring)|want(?:s|ed)? to rent|wtb|looking to rent|need (?:an? )?(?:apartment|apt|place|job|work)|am looking|we are looking|i am looking|i'm looking|we're looking|looking to (?:rent|find|work|hire))\b/i;
const OFFER_RE = /\b(available|avail\b|for rent|to rent out|renting out|now hiring|we are hiring|we're hiring|hiring\b|is hiring|position (?:available|open)|job (?:opening|offer|opportunity)|opportunity|sublet available|for sublet|for sale)\b/i;

function classify(subject, text) {
  const s = String(subject || '') + '\n' + String(text || '');
  const isRental = RENTAL_RE.test(s);
  const isJob = JOB_RE.test(s) && !/\b(apartment|apt|bedroom|bdrm|rental)\b/i.test(subject || '');
  let kind = isRental ? 'rental' : (isJob ? 'job' : '');
  if (!kind) return null;
  // "looking for a job" beats "job available" when both appear: the subject decides, then the first line
  const head = String(subject || '') + '\n' + String(text || '').split('\n').slice(0, 3).join('\n');
  let seek = SEEK_RE.test(head) && !OFFER_RE.test(String(subject || ''));
  if (!SEEK_RE.test(head) && !OFFER_RE.test(head)) seek = SEEK_RE.test(s) && !OFFER_RE.test(s);
  return { kind, seek };
}

// ── the note ────────────────────────────────────────────────────────────────
function noteFor(c, matchText) {
  const rental = c.kind === 'rental';
  const subject = rental ? 'rental info' : 'job info';
  let text;
  if (rental && matchText) text = matchText;   // her matches, in Miriam's words (rental-match.js)
  else if (rental && !c.seek) text = 'hi! I saw you just posted a rental on jerusaguide. there are people looking to rent here 👉 ' + SITE + '\nhatzlachah!';
  else if (rental && c.seek) text = 'hi! I saw you\'re looking for a rental on jerusaguide. there are tons listed here 👉 ' + SITE + '/israel/rental\nhatzlachah!';
  else if (!rental && !c.seek) text = 'hi! I saw you just posted a job on jerusaguide. there are people looking for work here 👉 ' + SITE + '\nhatzlachah!';
  else text = 'hi! I saw you\'re looking for work on jerusaguide. there are tons of jobs listed here 👉 ' + SITE + '/israel/jobs\nhatzlachah!';
  const html = '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.55;color:#3a2f27">'
    + text.split('\n').map(l => l.replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#a8483f">$1</a>')).join('<br>')
    + '</div>';
  return { subject, text, html };
}

// ── sending: Resend (the site's own way) or Gmail SMTP as a fallback ────────
async function sendMail(to, note, log) {
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject: note.subject, text: note.text, html: note.html }),
    });
    if (!r.ok) throw new Error('resend ' + r.status + ' ' + (await r.text()).slice(0, 120));
    return 'resend';
  }
  let nodemailer; try { nodemailer = require('nodemailer'); } catch (e) { throw new Error('no RESEND_API_KEY in .env and nodemailer is not installed (npm i nodemailer)'); }
  const user = process.env.GMAIL_USER, pass = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) throw new Error('no Gmail login for SMTP');
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  await t.sendMail({ from: FROM, to, replyTo: REPLY_TO, subject: note.subject, text: note.text, html: note.html });
  return 'gmail';
}

// ── the poster's own address, out of a Google Groups message ────────────────
function posterAddress(parsed) {
  const pick = (v) => { const a = v && v.value && v.value[0] && v.value[0].address; return a ? String(a).toLowerCase() : ''; };
  const own = (a) => a && !/googlegroups\.com$/i.test(a) && !/^(noreply|no-reply|mailer-daemon|postmaster)@/i.test(a);
  let a = '';
  try { a = String(parsed.headers.get('x-original-sender') || '').toLowerCase().replace(/[<>\s]/g, ''); } catch (e) {}
  if (own(a)) return a;
  a = pick(parsed.from); if (own(a)) return a;
  a = pick(parsed.replyTo); if (own(a)) return a;
  return '';
}
function fromTheGroup(parsed) {
  try {
    const h = (k) => String(parsed.headers.get(k) || '').toLowerCase();
    const all = [h('list-id'), h('list-post'), h('to'), h('cc'), h('from'), h('x-original-sender'), h('mailing-list'), h('x-google-group-id')].join(' ');
    const tos = ['to', 'cc'].map((k) => (parsed[k] && parsed[k].value || []).map((x) => String(x.address || '').toLowerCase()).join(' ')).join(' ');
    return all.indexOf(GROUP_KEY) > -1 || tos.indexOf(GROUP) > -1 || String(parsed.from && parsed.from.text || '').toLowerCase().indexOf(GROUP) > -1;
  } catch (e) { return false; }
}
function cleanText(t) {
  let x = String(t || '').replace(/\r/g, '');
  x = x.replace(/--\s*\n[\s\S]*?(You received this message because|To unsubscribe|Visit this group|To view this discussion)[\s\S]*$/i, '');
  x = x.replace(/\n(?:You received this message because|To unsubscribe from this group|To view this discussion|Visit this group at)[\s\S]*$/i, '');
  x = x.replace(/\n>.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return x;
}

let busy = false, sentToday = 0, dayKey = '';
async function run(log) {
  log = log || ((s) => console.log(s));
  if (MODE === 'off') return;
  if (busy) return; busy = true;
  const today = new Date().toISOString().slice(0, 10); if (today !== dayKey) { dayKey = today; sentToday = 0; }
  const user = process.env.GMAIL_USER, pass = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) { busy = false; return; }
  let ImapFlow, simpleParser;
  try { ({ ImapFlow } = require('imapflow')); ({ simpleParser } = require('mailparser')); } catch (e) { log('📬 jerusaguide: run  npm i imapflow mailparser'); busy = false; return; }
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  const ours = new Set([user.toLowerCase(), REPLY_TO.toLowerCase(), (FROM.match(/<([^>]+)>/) || [])[1] || ''].filter(Boolean));
  let sent = 0, skipped = 0, recent = null;   // recent: the site's rentals of the last three days, for the matches
  try {
    await client.connect();
    let box = '[Gmail]/All Mail';
    try { await client.mailboxOpen(box); } catch (e) { box = 'INBOX'; await client.mailboxOpen(box); }
    const since = new Date(Date.now() - HOURS * 3600 * 1000);
    let uids = [];
    for (const q of [{ from: GROUP, since }, { to: GROUP, since }, { cc: GROUP, since }, { header: { 'List-ID': GROUP_KEY }, since }]) {
      let found = []; try { found = await client.search(q, { uid: true }) || []; } catch (e) {}
      for (const u of found) if (!uids.includes(u)) uids.push(u);
    }
    for (const uid of uids) {
      if (sentToday >= DAILY) { log('📬 jerusaguide: daily cap of ' + DAILY + ' reached'); break; }
      let parsed;
      try { const msg = await client.fetchOne(uid, { source: true }, { uid: true }); if (!msg || !msg.source) continue; parsed = await simpleParser(msg.source); } catch (e) { continue; }
      const mid = 'jg_' + String(parsed.messageId || uid).replace(/[<>\s]/g, '').slice(0, 80);
      if (SEEN.has(mid)) continue;
      SEEN.add(mid);
      if (!fromTheGroup(parsed)) continue;
      const who = posterAddress(parsed);
      if (!who || ours.has(who)) { skipped++; continue; }
      if (TOLD[who]) { skipped++; continue; }                         // never twice — whatever they post
      const subject = String(parsed.subject || '').replace(/^\s*(?:(?:re|fw|fwd)\s*:\s*)+/i, '').replace(/\[[^\]]*\]\s*/g, '').trim();
      if (/^\s*re\s*:/i.test(parsed.subject || '')) { skipped++; continue; }   // a reply in a thread is not a posting
      const text = cleanText(parsed.text || (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, ' ') : ''));
      const c = classify(subject, text);
      if (!c) { skipped++; continue; }
      // a rental poster hears about her matches on the site instead of the plain note (Miriam, 22 Sep 2026)
      let matchText = '';
      if (c.kind === 'rental') {
        try { const RM = require('./rental-match.js'); const it = RM.itemFromText(subject, text); if (!recent) recent = await RM.fetchRecent(SITE); const m = RM.findMatches(it, recent); if (m.length) matchText = RM.message(it, m, SITE); } catch (e) { log('🤝 matches: ' + (e && e.message)); }
      }
      const note = noteFor(c, matchText);
      if (MODE === 'dry') { log('📬 jerusaguide (dry): would email ' + who + ' — ' + note.subject + ' — ' + (c.seek ? 'asking' : 'posting') + ' · "' + subject.slice(0, 60) + '"'); TOLD[who] = { ts: Date.now(), kind: c.kind, seek: c.seek, dry: true, subject: subject.slice(0, 80) }; sent++; sentToday++; continue; }
      try {
        const via = await sendMail(who, note, log);
        TOLD[who] = { ts: Date.now(), kind: c.kind, seek: c.seek, via, subject: subject.slice(0, 80) };
        sent++; sentToday++;
        log('📬 jerusaguide: emailed ' + who + ' — ' + note.subject + ' (' + (c.seek ? 'asking' : 'posting') + ')');
        await new Promise((r) => setTimeout(r, 4000));
      } catch (e) { log('📬 jerusaguide: ' + who + ' failed: ' + (e && e.message)); }
    }
    saveSeen(); saveTold();
  } catch (e) { log('📬 jerusaguide: ' + (e && e.message ? e.message.slice(0, 160) : e)); }
  finally { try { await client.logout(); } catch (e) {} busy = false; }
  if (sent || skipped) log('📬 jerusaguide: ' + sent + ' note(s) ' + (MODE === 'dry' ? 'rehearsed' : 'sent') + ', ' + skipped + ' left alone');
}

module.exports = { run, classify, noteFor, posterAddress, MODE };

if (require.main === module) {
  // a quick look at the classifier: node scripts/jerusaguide-mail.js
  const tests = [
    ['2 bedroom apartment available in Rechavia for Sukkos', 'Furnished, 3rd floor, call 052…'],
    ['Looking for a 3 bdrm apt in Ramat Eshkol', 'Family of 5, from November, long term'],
    ['Hiring: office assistant, part time', 'English speaking office in Givat Shaul…'],
    ['Looking for work — bookkeeper', 'I have 5 years experience, available mornings'],
    ['Dentist recommendation?', 'Anyone know a good dentist in Har Nof'],
  ];
  for (const [s, t] of tests) { const c = classify(s, t); console.log(JSON.stringify(c), '←', s, c ? '→ ' + noteFor(c).subject : ''); }
}
