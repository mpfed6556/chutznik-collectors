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
// .env:  JG_MODE=off|dry|suggest|live   (off = built but not running — the default)
//        JG_GROUP=jerusaguide@googlegroups.com
//        JG_FROM="Chutznik <info@chutznik.org>"   JG_REPLY_TO=info@chutznik.org   (from and replies: info@)
//        RESEND_API_KEY=…  (the same key the site uses; else Gmail SMTP through nodemailer)
//        JG_HOURS=48 (how far back to look)   JG_DAILY=25 (at most, per day)
'use strict';
const fs = require('fs');
const path = require('path');

// off | dry | suggest | live.  suggest (Miriam, 13 Oct 2026: "start sending suggestions of
// what to send ppl"): nothing goes to the poster; Miriam gets one email per round with
// each poster's address, what they wrote and the ready note, with a one-click compose link.
// JG_MODE in bridge-settings.json on the site overrides the .env (global._jgMode).
const modeNow = () => String(global._jgMode || process.env.JG_MODE || 'off').toLowerCase();
let MODE = modeNow();
const SUGGEST_DEFAULT_TO = ['mpfederman@gmail.com'];
const GROUP = String(process.env.JG_GROUP || 'jerusaguide@googlegroups.com').toLowerCase();
const GROUP_KEY = GROUP.split('@')[0];                       // "jerusaguide"
const FROM = process.env.JG_FROM || 'Chutznik <info@chutznik.org>';
const REPLY_TO = process.env.JG_REPLY_TO || 'info@chutznik.org';
const HOURS = Number(process.env.JG_HOURS || 48);
const DAILY = Number(process.env.JG_DAILY || 25);
const SITE = (process.env.JG_SITE || 'https://chutznik.org').replace(/\/$/, '');
const TOLD_FILE = path.join(__dirname, '..', 'jg-told.json');
const PENDING_FILE = path.join(__dirname, '..', 'jg-pending.json');   // suggested notes waiting for Miriam's one-tap "Send it from Chutznik"
const SEEN_FILE = path.join(__dirname, '..', 'jg-seen.json');

let TOLD = {}; try { TOLD = JSON.parse(fs.readFileSync(TOLD_FILE, 'utf8')) || {}; } catch (e) {}
let PENDING = {}; try { PENDING = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')) || {}; } catch (e) {}
const savePending = () => { try { const cut = Date.now() - 14 * 86400000; for (const k of Object.keys(PENDING)) if ((PENDING[k].at || 0) < cut) delete PENDING[k]; fs.writeFileSync(PENDING_FILE, JSON.stringify(PENDING, null, 1)); } catch (e) {} };
let SEEN = new Set(); try { SEEN = new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))); } catch (e) {}
const saveTold = () => { try { fs.writeFileSync(TOLD_FILE, JSON.stringify(TOLD, null, 1)); } catch (e) {} };
const saveSeen = () => { try { fs.writeFileSync(SEEN_FILE, JSON.stringify([...SEEN].slice(-5000))); } catch (e) {} };

// ── what kind of post is it? ────────────────────────────────────────────────
const RENTAL_RE = /\b(apartment|apt|flat|dira|dirah|rental|rent|sublet|sub-?let|to let|for let|lease|bdrm|bedroom|bedrooms|\d\s*br\b|studio|penthouse|furnished|short.?term|long.?term|tenant|landlord|roommate|room ?mate|housing|accommodation)\b/i;
const JOB_RE = /\b(job|jobs|position|hiring|hire|employment|vacancy|opening|openings|full.?time|part.?time|salary|resume|cv\b|work from home|remote work|freelance|babysitter|babysitting|nanny|cleaner|cleaning lady|housekeeper|caregiver|tutor|secretary|receptionist|bookkeeper|assistant|looking to hire|seeking (?:a|an) (?:\w+ )?(?:worker|employee|teacher|nanny|babysitter|cleaner|tutor|driver))\b/i;
// asking for one, rather than offering one
const SEEK_RE = /\b(looking for|seeking|searching for|in search of|iso\b|wanted|need(?:s|ed)? (?:a|an|to find)|anyone (?:know|have|renting)|does anyone|is there|any(?:body|one) (?:looking|renting|hiring)|want(?:s|ed)? to rent|wtb|looking to rent|need (?:an? )?(?:apartment|apt|place|job|work)|am looking|we are looking|i am looking|i'm looking|we're looking|looking to (?:rent|find|work|hire))\b/i;
const OFFER_RE = /\b(available|avail\b|for rent|to rent out|renting out|now hiring|we are hiring|we're hiring|hiring\b|is hiring|position (?:available|open)|job (?:opening|offer|opportunity)|opportunity|sublet available|for sublet|for sale)\b/i;

// real signs of a rental or a job, not just the word "apartment" in a story (13 Oct 2026: a
// "what made you feel you belonged in Israel?" discussion was taken for a rental)
const RENTAL_SURE = /(?:\b\d(?:\.5)?\s*(?:br|bdrm|bed|beds|bedroom|bedrooms|room|rooms|rm)\b|\b(?:for rent|to rent|to let|for let|sublet|sub-let|rent(?:al)? available|available (?:from|now|immediately|for)|furnished|unfurnished|long.?term|short.?term|per month|a month|\/month|pcm|\bnis\b|₪|shekel|\$\s?\d|\d\s?\$|looking (?:for|to rent) (?:an? )?(?:\d+ ?(?:br|bdrm|bedroom|room)|apartment|apt|flat|studio|sublet|place to (?:rent|live)|room(?:mate)?)|seeking (?:an? )?(?:apartment|apt|flat|sublet|rental|room)|need(?:s|ed)? (?:an? )?(?:apartment|apt|flat|sublet|rental|room)|apartment (?:for|to) rent|apt (?:for|to) rent|flat (?:for|to) rent|(?:apartment|apt|flat|house|studio|penthouse|unit) (?:available|for sale|wanted)|wanted:? (?:apartment|apt|flat|room))\b)/i;
const JOB_SURE = /\b(?:hiring|we are looking for an? (?:\w+ ){0,3}(?:teacher|assistant|secretary|bookkeeper|nanny|babysitter|cleaner|tutor|driver|manager|worker|employee|rep|representative|agent|aide|caregiver|therapist|nurse|coordinator|receptionist|developer|designer|writer|editor|salesperson)|position|positions|vacancy|vacancies|job (?:opening|offer|opportunity|available|wanted)|openings?\b|full.?time|part.?time|salary|resume|\bcv\b|looking for (?:a job|work|employment)|seeking (?:a job|work|employment)|available for work|work from home|remote (?:job|work|position)|freelance|per hour|an hour|\/hr\b|apply (?:to|at|by|here)|send (?:your )?(?:cv|resume))\b/i;
const DWELLING = /\b(?:apartment|apartments|apt|apts|flat|flats|dira|dirah|sublet|studio|penthouse|rooms?|bedrooms?|bdrm|\d\s?br|house|unit|villa|cottage|basement|duplex|vacation rental|holiday (?:apartment|rental)|place to (?:live|stay|rent)|accommodation)\b/i;
const CHATTER = /\b(?:what made you|how do you feel|curious|i'm curious|anyone else|poll|survey|discussion|thoughts\?|opinions?|does anyone else|what do you think|share your|tell me about|story|stories|sharing|in case it helps|what i learned|lessons?|rant|vent)\b/i;
// a job post is "seeking" only when the writer wants work for herself; "seeking a babysitter" is a job on offer
const WANT_WORK = /\b(?:looking for (?:a job|work|employment|a position)|seeking (?:a job|work|employment|a position)|available for work|open to (?:work|offers|positions)|my (?:cv|resume)|i am (?:a|an) (?:\w+ ){0,2}(?:teacher|assistant|bookkeeper|nanny|babysitter|cleaner|tutor|driver|nurse|therapist|designer|developer|writer|editor)|years? (?:of )?experience|i have experience|experienced (?:\w+ ){0,2}(?:looking|available|seeking))\b/i;

// ── a recommendation request: "anyone know of a good sheitel macher…" (Miriam, 13 Oct 2026:
//    "she isn't looking for work, she's looking for a wig lady") ────────────────────────────
const ASK_RE = /\b(?:anyone know(?:s)? (?:of |a |an |any |where |who |which )?|can (?:anyone|someone|anybody) recommend (?:a |an |any )?|recommendations? (?:for|of|on) (?:a |an |any )?|looking for (?:a |an |the |any )?|does anyone (?:know|have|use) (?:of |a |an |any )?|in need of (?:a |an )?|need(?:s|ed)? (?:a |an |to find a )|searching for (?:a |an )?|who (?:is|does|has) (?:a |an |the )?(?:good |great |reliable )?|where can i (?:find|get) (?:a |an )?)/i;
const FLUFF = /^(?:good|great|reliable|steady|regular|experienced|recommended|cheap|affordable|frum|heimish|english[- ]speaking|anglo|local|nice|decent|honest|trusted|really|very|excellent|amazing|wonderful|kosher|female|male|woman|lady|the|a|an|any|some|desperately|urgently)[\s,]+/i;
const STOP = /\s+(?:that|who|which|whom|to|for|in|near|around|with|and|or|from|at|by|on|please|pls|thanks|thank|asap|urgently|today|tomorrow|tonight|this|next)\b[\s\S]*$|[,.;:!?()\n][\s\S]*$/i;
// what the site calls it, so the search finds the posts
const SYN = [
  [/\b(?:sh[ae]it[le]{1,3}|sheitel|shaitel|sheitle|shaitle|wig)s?\s+(?:macher|lady|stylist|washer|person|woman)\b|\bwig\s+(?:lady|macher)\b|\bsheitel\b|\bshaitel\b|\bwigs?\b/i, 'sheitel macher'],
  [/\bcleaning (?:lady|help|woman|person)\b|\bhousekeeper\b|\bcleaner\b/i, 'cleaner'],
  [/\bbaby ?sitter\b|\bbabysitting\b/i, 'babysitter'],
  [/\bpediatrician\b|\bpaediatrician\b|\bchildren'?s doctor\b|\bkids'? doctor\b/i, 'pediatrician'],
  [/\bdentist\b/i, 'dentist'], [/\bdoula\b/i, 'doula'], [/\bplumber\b/i, 'plumber'], [/\belectrician\b/i, 'electrician'], [/\bhandyman\b/i, 'handyman'],
  [/\b(?:gan|ganenet|daycare|day care|playgroup|maon|nursery)\b/i, 'gan'], [/\bmikv[ae]h?\b/i, 'mikva'], [/\bsofer\b/i, 'sofer'], [/\bmover\b|\bmoving company\b|\bmovers\b/i, 'movers'],
  [/\bcaterer\b|\bcatering\b/i, 'caterer'], [/\bphotographer\b/i, 'photographer'], [/\bseamstress\b|\btailor\b|\balterations?\b/i, 'seamstress'], [/\bmechanic\b/i, 'mechanic'],
  [/\btherapist\b|\bcounsel(?:l)?or\b/i, 'therapist'], [/\btutor\b/i, 'tutor'], [/\bnanny\b/i, 'nanny'], [/\bcar service\b|\btaxi\b|\bdriver\b/i, 'driver'],
];
function askTopic(subject, text) {
  const body = String(text || '').replace(/\s+/g, ' ');
  const s = String(subject || '') + '. ' + body;
  const m = ASK_RE.exec(s); if (!m) return '';
  let rest = s.slice(m.index + m[0].length);
  for (let i = 0; i < 4 && FLUFF.test(rest); i++) rest = rest.replace(FLUFF, '');
  let topic = rest.replace(STOP, '').trim().split(/\s+/).slice(0, 3).join(' ').replace(/[^\w' -]/g, '').trim();
  const whole = topic + ' ' + s;
  for (const [re, name] of SYN) if (re.test(topic) || (topic.length < 3 && re.test(s))) return name;
  // question words and vague words are not a thing to look for ("looking for a how to…", "anyone know of something")
  const VAGUE = /^(?:how|what|where|when|who|why|which|whom|whose|if|whether|someone|somebody|anyone|anybody|help|info|information|advice|something|anything|place|places|way|ways|idea|ideas|tips?|recommendations?|suggestions?|options?|some|any|more|one|ones|people|person|good|best|cheap|the|this|that|these|those|it|them|there|here)(?:\s+\w+)*$/i;
  const firstWord = topic.split(/\s+/)[0] || '';
  if (!topic || topic.length < 3 || VAGUE.test(topic) || /^(?:how|what|where|when|who|why|which|if|whether|to)$/i.test(firstWord)) { for (const [re, name] of SYN) if (re.test(whole)) return name; return ''; }
  if (!/[a-z\u0590-\u05ff]{3,}/i.test(topic)) return '';
  return topic.toLowerCase();
}
// does the site have posts on it? (the public member posts and updates, read once per round)
const STEM = (w) => String(w || '').toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]/g, '').replace(/(?:ers|ies|es|s)$/, (x) => x === 'ies' ? 'y' : '').slice(0, 7);
async function siteHas(topic, site, key, cache) {
  if (!cache.posts) {
    const hdr = key ? { 'x-ingest-key': key, 'User-Agent': 'chutznik-bridge' } : { 'User-Agent': 'chutznik-bridge' };
    const get = async (q) => { try { const r = await fetch(site + '/api/live-data?type=' + q, { headers: hdr, signal: AbortSignal.timeout(25000) }); return r.ok ? await r.json() : []; } catch (e) { return []; } };
    let ups = await get('updates'); if (ups && ups.delta) ups = ups.items || [];
    const posts = await get('posts');
    cache.posts = [].concat(Array.isArray(ups) ? ups : [], Array.isArray(posts) ? posts : []).filter((p) => p && (!p.status || p.status === 'public'))
      .map((p) => (String(p.title || '') + ' ' + String(p.memo || p.content || p.body || '') + ' ' + (p.comments || []).map((c) => c && c.content || '').join(' ')).toLowerCase());
  }
  const words = topic.split(/\s+/).map(STEM).filter((w) => w.length >= 3);
  if (!words.length) return 0;
  let n = 0; for (const t of cache.posts) { if (words.every((w) => t.indexOf(w) > -1)) n++; if (n >= 25) break; }
  return n;
}

function classify(subject, text) {
  const subj = String(subject || ''), body = String(text || '');
  const s = subj + '\n' + body;
  const head = subj + '\n' + body.split('\n').slice(0, 3).join('\n');
  const isRental = RENTAL_RE.test(s) && RENTAL_SURE.test(s) && DWELLING.test(s);   // "maternity gown to buy or rent" is not a rental
  const isJob = JOB_RE.test(s) && JOB_SURE.test(s) && !/\b(apartment|apt|bedroom|bdrm|rental)\b/i.test(subj);
  let kind = isRental ? 'rental' : (isJob ? 'job' : '');
  if (!kind) { const topic = askTopic(subject, text); return topic ? { kind: 'ask', seek: true, topic } : null; }
  // a question to the group ("what made you feel at home?") is a conversation, not a listing
  if (/\?\s*$/.test(subj.trim()) && CHATTER.test(head) && !SEEK_RE.test(head)) return null;
  if (CHATTER.test(subj) && !RENTAL_SURE.test(subj) && !JOB_SURE.test(subj)) return null;
  // "looking for a job" beats "job available" when both appear: the subject decides, then the first line
  let seek = SEEK_RE.test(head) && !OFFER_RE.test(subj);
  if (!SEEK_RE.test(head) && !OFFER_RE.test(head)) seek = SEEK_RE.test(s) && !OFFER_RE.test(s);
  if (kind === 'job') seek = WANT_WORK.test(s) || (/\?\s*$/.test(head.trim()) && !/\b(?:hiring|we are looking for|position|vacancy|opening)\b/i.test(subj)) || /\b(?:where (?:are|can i find|do i find|to find)|any groups?|job (?:groups?|boards?|listings?|sites?)|are there (?:any )?(?:groups?|sites?|places?)|where .{0,30}jobs? (?:are )?posted)\b/i.test(s);
  // an advert with a price, "realty" or what the apartment includes is an offer, whatever its footer says
  if (kind === 'rental' && seek && !/^\s*(?:urgently |urgent:? )?(?:wanted|seeking|looking for|iso|searching for|need)\b/i.test(subj)) {
    let strength = 0; try { strength = require('./rental-match.js').offerStrength(subj + '\n' + body.slice(0, 600)); } catch (e) {}
    if (strength >= 2) seek = false;
  }
  return { kind, seek };
}

// ── the note ────────────────────────────────────────────────────────────────
function noteFor(c, matchText) {
  const rental = c.kind === 'rental';
  const subject = rental ? 'rental info' : c.kind === 'ask' ? (c.topic + ' info') : 'job info';
  let text;
  if (matchText) text = matchText;   // her matches, in Miriam's words (rental-match.js)
  else if (c.kind === 'ask') text = 'hi! I saw you\'re looking for a ' + c.topic + '. there are a few recommended here 👉 ' + SITE + '/israel/search/' + encodeURIComponent(c.topic).replace(/%20/g, '+') + '\nhatzlachah!';
  else if (rental && !c.seek) text = 'hi! I saw you just posted a rental. there are people looking to rent here 👉 ' + SITE + '/israel/rental\nhatzlachah!';
  else if (rental && c.seek) text = 'hi! I saw you\'re looking for a rental. there are tons listed here 👉 ' + SITE + '/israel/rental\nhatzlachah!';
  else if (!rental && !c.seek) text = 'hi! I saw you just posted a job. there are people looking for work here 👉 ' + SITE + '/israel/jobs\nhatzlachah!';
  else text = 'hi! I saw you\'re looking for work. there are tons of jobs listed here 👉 ' + SITE + '/israel/jobs\nhatzlachah!';
  const html = '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.55;color:#3a2f27">'
    + text.split('\n').map(l => l.replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#a8483f">$1</a>')).join('<br>')
    + '</div>';
  return { subject, text, html };
}

// ── sending: Resend (the site's own way) or Gmail SMTP as a fallback ────────
async function sendMail(to, note, log, opts) {
  // the site's own mail function first: every note leaves as Chutznik <info@chutznik.org>, logged like every other email (Miriam, 13 Oct 2026)
  if (opts && opts.ingestKey) {
    const r = await fetch(((opts && opts.site) || SITE) + '/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': opts.ingestKey, 'User-Agent': 'chutznik-bridge' },
      body: JSON.stringify({ type: 'custom', to: [to], subject: note.subject, body: note.text, html: note.html, plain: true }) });
    if (!r.ok) throw new Error('site mail ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120));
    return 'site';
  }
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
  // a realtor's footer ("Want daily property updates? Choose what works best for you… looking for…") is not the post
  x = x.replace(/\*?\s*want daily (?:property )?updates\?[\s\S]*$/i, '').replace(/\n(?:follow us|join our (?:whatsapp|status)|for more listings)[\s\S]*$/i, '');
  x = x.replace(/--\s*\n[\s\S]*?(You received this message because|To unsubscribe|Visit this group|To view this discussion)[\s\S]*$/i, '');
  x = x.replace(/\n(?:You received this message because|To unsubscribe from this group|To view this discussion|Visit this group at)[\s\S]*$/i, '');
  x = x.replace(/\n>.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return x;
}

let busy = false, sentToday = 0, dayKey = '';
// the suggestions email, through the site's own mail function (logged like every other email)
function esc(v) { return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
async function sendSuggestions(list, opts, log) {
  const to = (opts && opts.to && opts.to.length) ? opts.to : SUGGEST_DEFAULT_TO;
  const site = (opts && opts.site) || SITE, key = opts && opts.ingestKey;
  if (!key) { log('📬 jerusaguide: no site key for the suggestions email'); return false; }
  const what = (x) => x.kind === 'ask' ? 'a ' + x.topic : (x.seek ? 'the ' : 'your ') + x.kind;
  const label = (x) => x.kind === 'ask' ? 'is looking for a ' + x.topic : (x.seek ? 'is looking for a ' : 'posted a ') + x.kind;
  const approve = (x) => site + '/israel/#approve/' + x.token + '?who=' + encodeURIComponent(x.who) + '&what=' + encodeURIComponent(what(x)) + '&via=email';
  const block = (x) => '<div style="border:1px solid #eadfd3;border-radius:12px;padding:12px 14px;margin:0 0 14px">'
    + '<div style="font-size:12px;color:#9a8c80">' + esc(x.who) + ' · ' + esc(label(x)) + '</div>'
    + '<div style="font-weight:700;color:#3a2920;margin:2px 0 6px">' + esc(x.subject || '(no subject)') + '</div>'
    + (x.snippet ? '<div style="font-size:13px;color:#6b5d50;white-space:pre-wrap;margin-bottom:8px">' + esc(x.snippet) + '</div>' : '')
    + '<div style="background:#fbf6f0;border-radius:8px;padding:8px 10px;font-family:Georgia,serif;font-size:14px;white-space:pre-wrap;color:#3a2f27">' + esc(x.note.text) + '</div>'
    + '<div style="margin-top:10px"><a href="' + approve(x) + '" style="display:inline-block;background:#7a2c0c;color:#fff;border-radius:99px;padding:10px 22px;text-decoration:none;font-weight:700;font-size:14px">✓ Send it from Chutznik</a>'
    + ' <a href="' + approve(x) + '&edit=1&text=' + encodeURIComponent(x.note.text) + '" style="display:inline-block;background:#fff;color:#7a2c0c;border:1.5px solid #d9c4b2;border-radius:99px;padding:9px 18px;text-decoration:none;font-weight:700;font-size:13px;margin-left:6px">✏️ Edit &amp; send</a></div></div>';
  const html = '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#3a2920;max-width:640px">'
    + '<div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#6b2a0c;margin-bottom:4px">' + list.length + ' poster' + (list.length === 1 ? '' : 's') + ' to write to</div>'
    + '<div style="color:#9a8c80;font-size:13px;margin-bottom:14px">Each one posted or asked about a rental or a job, or asked for a recommendation Chutznik has. Nothing was sent yet. Press a button and that note goes out from info@chutznik.org within a minute. Nobody is suggested twice.</div>'
    + list.map(block).join('')
    + '<div style="color:#b8aa9c;font-size:11px;margin-top:10px">Suggestions by the bridge, from the group posts in ' + esc(process.env.GMAIL_USER || 'the inbox') + '. Nobody is written to twice.</div></div>';
  const text = list.map((x) => x.who + ' (' + label(x) + '): ' + (x.subject || '') + '\n--- suggested note (subject: ' + x.note.subject + ') ---\n' + x.note.text + '\nSend it from Chutznik: ' + approve(x) + '\n').join('\n');
  const r = await fetch(site + '/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': key, 'User-Agent': 'chutznik-bridge' },
    body: JSON.stringify({ type: 'custom', to, subject: list.length + ' suggested note' + (list.length === 1 ? '' : 's') + ' to send', body: text, html }) });
  const rt = (await r.text().catch(() => '')).slice(0, 160);
  if (!r.ok) { log('📬 jerusaguide: suggestions mail failed ' + r.status + ' ' + rt); return false; }
  log('📬 jerusaguide: ' + list.length + ' suggestion(s) emailed to ' + to.join(', '));
  return true;
}
async function run(log, opts) {
  log = log || ((s) => console.log(s));
  MODE = modeNow();
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
  const suggestions = [], siteCache = {};
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
      if (c.kind === 'ask') {
        let n = 0; try { n = await siteHas(c.topic, (opts && opts.site) || SITE, opts && opts.ingestKey, siteCache); } catch (e) {}
        if (n < 2) { skipped++; log('📬 jerusaguide: ' + who + ' asked for a ' + c.topic + ' — the site has ' + n + ' post(s) on it, left alone'); continue; }
      }
      // a rental poster hears about her matches on the site instead of the plain note (Miriam, 22 Sep 2026)
      let matchText = '';
      if (c.kind === 'rental' || c.kind === 'job') {
        try { const RM = require('./rental-match.js'); const it = RM.itemFromText(subject, text, c.seek); if (!recent) recent = await RM.fetchRecent(SITE); const m = RM.findMatches(it, recent); if (m.length) matchText = RM.message(it, m, SITE); } catch (e) { log('🤝 matches: ' + (e && e.message)); }
      }
      const note = noteFor(c, matchText);
      if (MODE === 'suggest') { suggestions.push({ mid, token: require('crypto').randomBytes(16).toString('hex'), who, kind: c.kind, topic: c.topic || '', seek: c.seek, subject: subject.slice(0, 120), snippet: text.replace(/\s+/g, ' ').trim().slice(0, 280), note }); sent++; sentToday++; continue; }
      if (MODE === 'dry') { log('📬 jerusaguide (dry): would email ' + who + ' — ' + note.subject + ' — ' + (c.seek ? 'asking' : 'posting') + ' · "' + subject.slice(0, 60) + '"'); TOLD[who] = { ts: Date.now(), kind: c.kind, seek: c.seek, dry: true, subject: subject.slice(0, 80) }; sent++; sentToday++; continue; }
      try {
        const via = await sendMail(who, note, log, opts);
        TOLD[who] = { ts: Date.now(), kind: c.kind, seek: c.seek, via, subject: subject.slice(0, 80) };
        sent++; sentToday++;
        log('📬 jerusaguide: emailed ' + who + ' — ' + note.subject + ' (' + (c.seek ? 'asking' : 'posting') + ')');
        await new Promise((r) => setTimeout(r, 4000));
      } catch (e) { log('📬 jerusaguide: ' + who + ' failed: ' + (e && e.message)); }
    }
    if (suggestions.length) {
      const ok = await sendSuggestions(suggestions, opts, log);
      if (ok) for (const x of suggestions) { TOLD[x.who] = { ts: Date.now(), kind: x.kind, seek: x.seek, suggested: true, subject: x.subject.slice(0, 80) }; PENDING[x.token] = { who: x.who, kind: x.kind, seek: x.seek, subject: x.subject, note: x.note, at: Date.now() }; }
      if (ok) savePending();
      else { sent -= suggestions.length; sentToday -= suggestions.length; for (const x of suggestions) SEEN.delete(x.mid); }
    }
    saveSeen(); saveTold();
  } catch (e) { const inner = e && e.errors && e.errors[0] && e.errors[0].message; log('📬 jerusaguide: ' + (e && e.message ? e.message.slice(0, 160) : e) + (inner ? ' (' + String(inner).slice(0, 120) + ')' : '')); }
  finally { try { await client.logout(); } catch (e) {} busy = false; }
  if (sent || skipped) log('📬 jerusaguide: ' + sent + ' note(s) ' + (MODE === 'dry' ? 'rehearsed' : MODE === 'suggest' ? 'suggested' : 'sent') + ', ' + skipped + ' left alone');
}

// Miriam pressed "Send it from Chutznik" on a suggested note (the approve token came back from the site)
async function approve(token, opts, log, text) {
  const p = PENDING[token]; if (!p) return false;
  if (p.sent) return true;
  // Miriam edited the note on the site before pressing Send: her words go, not the suggestion
  let note = p.note;
  if (typeof text === 'string' && text.trim().length >= 10) {
    const t = text.trim().slice(0, 2000);
    note = { subject: p.note.subject, text: t, html: '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.55;color:#3a2f27">' + t.split('\n').map((l) => esc(l).replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#a8483f">$1</a>')).join('<br>') + '</div>' };
  }
  try {
    const via = await sendMail(p.who, note, log, opts);
    p.sent = Date.now(); p.via = via; if (note !== p.note) p.edited = true; TOLD[p.who] = { ts: Date.now(), kind: p.kind, seek: p.seek, via, approved: true, subject: String(p.subject || '').slice(0, 80) };
    log('📬 jerusaguide: emailed ' + p.who + ' — ' + p.note.subject + ' (approved by Miriam)');
  } catch (e) { p.tries = (p.tries || 0) + 1; log('📬 jerusaguide: note to ' + p.who + ' failed: ' + (e && e.message)); if (p.tries < 3) { savePending(); return false; } p.sent = Date.now(); p.failed = true; }
  savePending(); saveTold();
  return true;
}
const pendingCount = () => Object.values(PENDING).filter((p) => p && !p.sent).length;
// JG_RESUGGEST {stamp} in the site settings: the suggested-but-unsent notes are forgotten and the
// last two days are read again under the current rules (once per stamp)
const RESUG_FILE = path.join(__dirname, '..', 'jg-resuggest.txt');
const RULES = 5;   // bumped with each change of the rules; a stamp ending in -rules-N waits for code at least N
function resuggest(stamp, log) {
  let done = ''; try { done = fs.readFileSync(RESUG_FILE, 'utf8').trim(); } catch (e) {}
  if (!stamp || done === String(stamp)) return false;
  const need = Number((String(stamp).match(/rules-(\d+)$/) || [])[1] || 0); if (need > RULES) return false;   // the bridge has not updated yet
  let n = 0;
  for (const k of Object.keys(TOLD)) if (TOLD[k] && (TOLD[k].suggested || TOLD[k].dry) && !TOLD[k].approved && !TOLD[k].via) { delete TOLD[k]; n++; }
  for (const k of Object.keys(PENDING)) if (PENDING[k] && !PENDING[k].sent) delete PENDING[k];
  SEEN = new Set(); saveSeen(); saveTold(); savePending();
  try { fs.writeFileSync(RESUG_FILE, String(stamp)); } catch (e) {}
  (log || console.log)('📬 jerusaguide: re-suggesting — ' + n + ' unsent suggestion(s) forgotten, the last ' + HOURS + 'h are read again');
  return true;
}

module.exports = { run, approve, pendingCount, resuggest, askTopic, classify, noteFor, posterAddress, modeNow, get MODE() { return modeNow(); } };

if (require.main === module) {
  // a quick look at the classifier: node scripts/jerusaguide-mail.js
  const tests = [
    ['2 bedroom apartment available in Rechavia for Sukkos', 'Furnished, 3rd floor, call 052…'],
    ['Looking for a 3 bdrm apt in Ramat Eshkol', 'Family of 5, from November, long term'],
    ['Hiring: office assistant, part time', 'English speaking office in Givat Shaul…'],
    ['Looking for work — bookkeeper', 'I have 5 years experience, available mornings'],
    ['Dentist recommendation?', 'Anyone know a good dentist in Har Nof'],
    ['What made you feel like you actually BELONGED in Israel?', "For those of you who've moved to Israel from abroad (which is most of you), I'm curious about something: What made one apartment building or neighborhood feel like *home*, while another just felt like a place you lived? I'm especially interested in the little everyday things"],
    ['Sublet in Nachlaot', '1 bedroom, available from Nov 1 to Jan 15, 4500 NIS'],
    ['Looking for a place to live', 'Young couple looking for a 2 room apartment in the Katamon area from December'],
    ['Thoughts on the new bus routes?', 'Our neighborhood lost the 15 line, anyone else?'],
    ['Seeking babysitter', 'Looking for a babysitter twice a week in Ramat Eshkol, 50 NIS per hour'],
    ['My job hunt story', "After months of looking for work I finally learned what matters, sharing in case it helps someone"],
    ['Fall', 'Anyone know of a good shaitle macher that can covert a regular wig into a fall and does a good job? thanks!'],
    ['Pediatrician in Ramat Eshkol', 'Can anyone recommend an English speaking pediatrician in the Ramat Eshkol area? Thanks'],
    ['Cleaning help', 'Looking for a reliable cleaning lady for Thursdays in Har Nof'],
    ['Plumber', 'does anyone have a plumber they like? sink is leaking'],
    ['Selling a stroller', 'Bugaboo in great condition, 800 NIS'],
    ['New in the aka project', 'New in the aka project 4 bedrooms 3 bathrooms Sukkah balcony 6th floor The apartment includes: Beds in all rooms Refrigerator, oven, washing machine Living room table with 8 chairs Rent 16,000 Rosenbaum realty 0534681265 * Want Daily Property Updates? Choose What Works Best for You: looking for something specific? write to us'],
    ['Urgently Looking for Apt for 3 week Rental', 'anyone know of a 2-3 bedroom apt in Gush 80 /Tzfanya area for rental from Thurs Oct 15 - Nov 8?'],
    ['Groups -Remote job', 'Are there any groups where remote jobs are posted? Thanks'],
    ['looking for maternity gown', 'Looking for maternity gown to buy or rent! pls email z0553395935@gmail.com with pics and price thanks'],
    ['Secretary needed', 'Busy office in Geula is looking for a full time secretary, good English, send CV to office@x.com'],
    ['Question', 'Looking for how to get a teudat zehut renewed quickly, any ideas?'],
    ['Maccabident Agripas best dentist', 'Have you used a dentist in the maccabident dentist on agripas that you were happy with? specifically looking for an adult dentist. Please pm me. Thanks a mill'],
    ['Advice', 'Anyone know of something good for a toddler who will not sleep?'],
    ['Desperately looking for good, steady cleaning lady', 'For twice a week if possible. Please send me any leads Thank you so much!'],
    ['Help', 'Looking for what I need for a bris, where do people buy?'],
  ];
  for (const [s, t0] of tests) { const t = cleanText(t0); const c = classify(s, t); console.log(JSON.stringify(c), '←', s, c ? '→ ' + noteFor(c).text.split('\n')[0] : ''); }
}
