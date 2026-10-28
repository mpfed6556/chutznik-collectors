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
const HOURS = Number(process.env.JG_HOURS || 48);   // the first look back; later rounds look at the last few hours only
const DAILY = Number(process.env.JG_DAILY || 50);   // 50 a day: the replies in threads are written to as well (28 Oct 2026)
const SITE = (process.env.JG_SITE || 'https://chutznik.org').replace(/\/$/, '');
const TOLD_FILE = path.join(__dirname, '..', 'jg-told.json');
const PENDING_FILE = path.join(__dirname, '..', 'jg-pending.json');   // suggested notes waiting for Miriam's one-tap "Send it from Chutznik"
const SEEN_FILE = path.join(__dirname, '..', 'jg-seen.json');

let TOLD = {}; try { TOLD = JSON.parse(fs.readFileSync(TOLD_FILE, 'utf8')) || {}; } catch (e) {}
let PENDING = {}; try { PENDING = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')) || {}; } catch (e) {}
const savePending = () => { try { const cut = Date.now() - 14 * 86400000; for (const k of Object.keys(PENDING)) if ((PENDING[k].at || 0) < cut) delete PENDING[k]; fs.writeFileSync(PENDING_FILE, JSON.stringify(PENDING, null, 1)); } catch (e) {} };
let SEEN = new Set(); try { SEEN = new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))); } catch (e) {}
// the highest UID handled per mailbox generation: the next round searches only after it
const HIGH_FILE = path.join(__dirname, '..', 'jg-high.json');
let HIGH = {}; try { HIGH = JSON.parse(fs.readFileSync(HIGH_FILE, 'utf8')) || {}; } catch (e) {}
const saveHigh = () => { try { fs.writeFileSync(HIGH_FILE, JSON.stringify(HIGH)); } catch (e) {} };
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

// ── sending: Resend (the site's own way) or Gmail SMTP as a fallback ────────
async function sendMail(to, note, log, opts) {
  // the site's own mail function first: every note leaves as Chutznik <info@chutznik.org>, logged like every other email (Miriam, 13 Oct 2026)
  if (opts && opts.ingestKey) {
    const r = await fetch(((opts && opts.site) || SITE) + '/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': opts.ingestKey, 'User-Agent': 'chutznik-bridge' },
      body: JSON.stringify({ type: 'custom', to: [to], subject: note.subject, body: note.text, html: note.html, plain: true, fromName: 'Miriam', tag: 'jerusaguide' }) });
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

// only what the person just wrote (Miriam, 28 Oct 2026: "the bot should only read the new message content and nothing after
// the fresh content … after four or five sentences it should stop, whether or not the person is finished writing")
const QUOTE_START = /^\s*(?:on .{4,120}wrote:?\s*$|-{2,}\s*original message|-{2,}\s*forwarded message|_{5,}|from:\s|sent:\s|sent from my |get outlook for|בתאריך .{4,120}כתב|you received this message because|to unsubscribe from this group|to view this discussion|visit this group at|>)/i;
function freshText(t) {
  const lines = String(t || '').replace(/\r/g, '').split('\n');
  const keep = [];
  for (const l of lines) { if (QUOTE_START.test(l)) break; keep.push(l); if (keep.length >= 12) break; }
  const flat = keep.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  // five sentences at most: a full stop, ! or ? followed by a space, or a line break, ends one
  const parts = flat.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) || [];
  return parts.slice(0, 5).join(' ').replace(/\s+/g, ' ').trim().slice(0, 700);
}

// never written to (Miriam, 28 Oct 2026: "ensure that no email is sent to the admins of the Google group, and Bee Dushinsky"):
// the group's own accounts, anyone signing as its admin or moderator, and whatever JG_SKIP in the site settings adds
const NEVER = ['jerusaguideteam@gmail.com', 'jerusaguideauto@gmail.com', 'dushinsky'];
const ADMIN_NAME = /\b(?:admin|admins|administrator|moderator|moderators|mod team|jg auto|jguide admin|jerusaguide (?:ads|team|admin)|do not reply|no-?reply)\b/i;
function neverWrite(addr, name) {
  const a = String(addr || '').toLowerCase(), n = String(name || '').toLowerCase();
  const list = NEVER.concat(Array.isArray(global._jgSkip) ? global._jgSkip : []);
  if (list.some((x) => x && (x.includes('@') ? a === x : (a.includes(x) || n.includes(x))))) return true;
  if (ADMIN_NAME.test(n) || /^(?:admin|moderator|team|noreply|no-reply)[._-]?|jerusaguide(?:team|auto|admin)@/i.test(a)) return true;
  return false;
}

// a business advertising itself: a service or product on offer, how to order or book, a price (28 Oct 2026)
const BIZ_HINT = /\b(?:we offer|i offer|offering|now offering|taking orders|place your orders?|order (?:now|today|by)|orders? (?:open|for shabb?(?:os|at))|book (?:now|today|your|a)|call (?:or|\/) (?:whatsapp|text)|whatsapp (?:me|us)|contact (?:me|us) (?:for|to)|prices? (?:start|from)|starting (?:at|from)|discount|\d+ ?% off|on sale|special offer|services?|lessons?|catering|caterer|delivery|deliveries|free (?:consultation|delivery|estimate|trial)|licensed|certified|years of experience|my business|our (?:store|shop|business|company|clinic|studio)|appointments?|now open|grand opening)\b/gi;
// a reply offers something when its own words do: a rental (or, under a rental question, a price or a phone number), a job, a business
// what kind of business a message is about, for the note (Miriam, 28 Oct 2026: "all mention the business type in the message")
const BIZ_TYPES = [[/\bbrunch|breakfast (?:package|tray|box)/i, 'brunch place'], [/\bcater/i, 'caterer'], [/\bbak(?:ery|er|es|ed)\b|\bcakes?\b|\bchallah/i, 'bakery'],
  [/\bnails?\b|manicure|pedicure/i, 'nail salon'], [/\bsh[ae]it[el]{1,3}\b|\bwigs?\b/i, 'sheitel macher'], [/\bmake-?up\b/i, 'makeup artist'], [/\bhair\s*(?:cut|dresser|stylist|salon)|\bbarber/i, 'hair salon'],
  [/\bclean(?:er|ing)\b/i, 'cleaning service'], [/\bplumb/i, 'plumber'], [/\belectrician/i, 'electrician'], [/\bhandyman/i, 'handyman'], [/\bmov(?:ers?|ing company)\b/i, 'moving company'],
  [/\bphotograph/i, 'photographer'], [/\btutor/i, 'tutor'], [/\btherap/i, 'therapist'], [/\bdentist/i, 'dentist'], [/\bpediatrician|\bdoctor\b/i, 'doctor'],
  [/\bseamstress|\btailor|\balterations?\b/i, 'seamstress'], [/\bflorist|\bflowers\b/i, 'florist'], [/\bdriver\b|\btaxi\b/i, 'driver'], [/\bbabysit/i, 'babysitter'],
  [/\bgan\b|\bdaycare\b|\bplaygroup\b/i, 'gan'], [/\brestaurant|\bpizza|\bsushi|\bcaf[eé]\b/i, 'restaurant'], [/\bsupper|\bmeals?\b|\bfood\b|\bmenu\b|\btakeout\b/i, 'food business'],
  [/\bgift (?:baskets?|packages?|boxes?)|\bgift\b/i, 'gift business'], [/\blessons?\b|\bclass(?:es)?\b/i, 'class']];
function bizTypeOf(...texts) { const t = texts.join(' '); for (const [re, name] of BIZ_TYPES) if (re.test(t)) return name; return ''; }
// the business a reply names: the first words before a dash, a full stop or a comma, when they read like a name ("Morning Bites", "Bon Bon", "Chalav Udvash")
function bizNameOf(text) {
  let first = String(text || '').trim().split(/\s+[-–—]\s+|[.,!:\n(]/)[0].replace(/^(?:try|use|call|i recommend|i'd recommend|recommend|definitely|def|go to|check out|order from)\s+/i, '').trim();
  first = first.replace(/[^\p{L}\p{N}'&\s]/gu, '').replace(/\s+/g, ' ').trim();
  let words = first.split(' ').filter(Boolean);
  // the name ends where the sentence goes on ("Say cheese On Wed" → "Say cheese")
  const cut = words.findIndex((w, i) => i > 0 && /^(?:on|at|in|for|is|are|was|were|has|have|had|they|she|he|it|from|with|and|but|if|when|who|which|that|this|was|very|so|really|amazing|great|best|sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|motzei|tonight|today|tomorrow)$/i.test(w));
  if (cut > 0) words = words.slice(0, cut);
  first = words.join(' ');
  if (!words.length || words.length > 4 || first.length > 32 || first.length < 3) return '';
  if (/^(?:i|we|my|she|he|they|you|it|this|that|the|a|an|so|yes|no|me|following|thanks|thank|good|great|same|also|hi|hey|maybe|not|please)$/i.test(words[0])) return '';
  if (!words.some((w) => /^[A-Z\u0590-\u05FF]/.test(w))) return '';
  return first;
}
// a reply under a request that names a business: the replier is told it can go on Chutznik (Miriam, 28 Oct 2026: "this thread has
// some business listings that should have gotten emails")
const CHAT_REPLY = /^\s*(?:following|me too|same|same here|good luck|hatzlacha|thanks|thank you|bump|interested|\+1|i also|also looking|following!|subscribing|watching|ditto)\b/i;
function recommendationIn(subject, text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 3 || t.length > 450 || /\?/.test(t) || CHAT_REPLY.test(t)) return null;
  const asks = /\?|\b(?:looking for|anyone|recommend|need(?:ed)?|want to (?:order|buy|find|get)|where (?:can|to|is)|does anyone|who (?:does|has|knows)|suggestions?|any (?:good|ideas)|iso)\b/i.test(String(subject || ''));
  if (!asks) return null;
  const phone = /(?:\+?972[\s-]?|\b0)(?:5\d|[2-9])[\s-]?\d{3}[\s-]?\d{4}\b/.test(t);
  const name = bizNameOf(t);
  if (!phone && !name) return null;
  return { kind: 'recommend', seek: false, name, type: bizTypeOf(subject, t) };
}
function classifyReply(subject, text) {
  const t = String(text || '');
  const rec = recommendationIn(subject, t);
  if (t.replace(/\s+/g, ' ').trim().length < 15) return rec;
  let c = classify('', t);
  if (c && c.kind === 'rental') return c;
  if (c && c.kind === 'job' && !c.seek) return c;
  const offer = /(?:\b\d[\d,.]*\s*(?:nis|₪|shekels?|ils)\b|\b(?:available|for rent|i have|we have|my (?:apartment|flat|unit)|call|whatsapp)\b|(?:\+?972|0)5\d[\s-]?\d{3}[\s-]?\d{4})/i;
  if (!/\?\s*$/.test(t.trim()) && RENTAL_RE.test(subject) && DWELLING.test(String(subject) + ' ' + t) && offer.test(t)) return { kind: 'rental', seek: false };
  return rec;
}
function isBusinessAd(subject, text) {
  const s = String(subject || '') + '\n' + String(text || '');
  if (/\?/.test(String(subject || '')) || SEEK_RE.test(String(subject || ''))) return false;
  const hits = new Set((s.match(BIZ_HINT) || []).map((x) => x.toLowerCase())).size;
  const phone = /(?:\+?972|0)[\s-]?(?:[2-9]|5\d)[\s-]?\d{3}[\s-]?\d{4}\b|\b05\d[\s-]?\d{7}\b/.test(s);
  return hits >= 2 || (hits >= 1 && phone);
}

// ── the reply: one sentence, in Miriam's own voice, no emojis, never the same words twice (Miriam, 28 Oct 2026:
//    "always worded in a different way so they see you're a real human … not more than one sentence") ──────────
const TEXTS_FILE = path.join(__dirname, '..', 'jg-texts.json');
let TEXTS = new Set(); try { TEXTS = new Set(JSON.parse(fs.readFileSync(TEXTS_FILE, 'utf8'))); } catch (e) {}
const saveTexts = () => { try { fs.writeFileSync(TEXTS_FILE, JSON.stringify([...TEXTS].slice(-20000))); } catch (e) {} };
const textKey = (t) => require('crypto').createHash('sha256').update(String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).digest('hex').slice(0, 20);
const AREAS = ['Katamon', 'Old Katamon', 'Rechavia', 'Baka', 'German Colony', 'Talpiot', 'Arnona', 'Nachlaot', 'Ramat Eshkol', 'Maalot Dafna', 'Sanhedria', 'Geula', 'Romema', 'Har Nof', 'Bayit Vegan', 'Givat Shaul', 'Kiryat Moshe', 'Ramot', 'Ramat Shlomo', 'French Hill', 'Arzei Habira', 'Shmuel Hanavi', 'Mekor Baruch', 'Kiryat Shmuel', 'Talbiyeh', 'Musrara', 'Old City', 'Rova', 'Givat Mordechai', 'Beit Hakerem', 'Gilo', 'Pisgat Zeev', 'Neve Yaakov', 'Ramat Beit Shemesh', 'Beit Shemesh', 'Efrat', 'Givat Zeev', 'Maale Adumim', 'Telz Stone', 'Kiryat Yovel', 'Malcha', 'Ir Ganim', 'Armon Hanatziv', 'Baka', 'Emek Refaim'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function areaOf(s) { const t = String(s || ''); for (const a of AREAS) if (new RegExp('\\b' + a.replace(/ /g, '\\s+') + '\\b', 'i').test(t)) return a; return ''; }
function firstName(n) { const f = String(n || '').trim().split(/\s+/)[0] || ''; return /^[A-Z][a-z]{1,14}$/.test(f) && !/^(?:the|info|office|admin|jerusalem|realty|team|mr|mrs|ms)$/i.test(f) ? f : ''; }
const LINKS = { rentals: ['chutznik.org/israel/rentals', 'https://chutznik.org/israel/rentals', 'chutznik.org'], jobs: ['chutznik.org/israel/jobs', 'https://chutznik.org/israel/jobs', 'chutznik.org'], site: ['chutznik.org', 'https://chutznik.org', 'www.chutznik.org'] };
// "Hi! feel free to post your question about … on chutznik.org/…" (Miriam, 28 Oct 2026: no "I saw your…")
// no name and no "too" (Miriam, 28 Oct 2026, on "Hello Mir! Feel free to post your apartment on … too")
const OPEN = ['Hi!', 'Hey!', 'Hello!', 'Hi there!', 'Hey there!', 'Hello there!'];
const BODY = {
  rental_seek: [
    "you can post what you need on {L}, landlords and agents check it every day",
    "feel free to put up a post about {t} on {L}, new listings come in all day",
    "feel free to post your question about {t} on {L}, a lot of rentals are listed there",
    "feel free to post what you're looking for on {L}, there are new rentals there every day",
    "you're welcome to post your question about {t} on {L}, people check it all day",
    "feel free to ask about {t} on {L}, the rentals from all the groups are there",
  ],
  rental_offer: [
    "you can list your apartment on {L} for free, people looking to rent check it daily",
    "feel free to add your apartment{a} to {L}, it costs nothing",
    "feel free to post your apartment on {L}, it's free and lots of people are looking",
    "you're welcome to list your rental on {L}, it's free",
    "feel free to put your apartment up on {L}, people search there every day",
    "feel free to post your rental{a} on {L}, it's free and English speakers look there",
  ],
  job: [
    "you can post the job on {L} for free, people looking for work check it daily",
    "feel free to add the position to {L}, it costs nothing",
    "feel free to post your job on {L}, it's free and lots of people are looking for work",
    "you're welcome to list the position on {L}, it's free",
    "feel free to put the job up on {L}, English speakers look for work there",
    "feel free to post the opening on {L}, it's free",
  ],
  business: [
    "you can list {Y} on {L} for free, people search there for local services",
    "feel free to add {Y}{a} to {L}, it costs nothing",
    "feel free to post {Y} on {L}, it's free",
    "you're welcome to list {Y} on {L}, people look for local services there",
    "feel free to add your ad for {Y} to {L}, it's free",
    "feel free to post {Y}{a} on {L}, English speakers look for local services there",
  ],
  recommend: [
    "feel free to post {B} on {L}, people look for {T} there every day",
    "you're welcome to list {B} on {L} for free, it's where English speakers in Jerusalem find {T}",
    "feel free to add {B} to {L}, it's free and people search there for {T}",
    "you can put {B} up on {L} at no cost, so more people find it when they need {T}",
    "feel free to share {B} on {L}, people there are always asking for {T}",
    "you're welcome to post {B} on {L}, it's free and lots of people look for {T} there",
  ],
};
const CLOSE = { recommend: ['.', '!', ', hatzlacha!', ', thanks for sharing!', ', all the best!'], rental_seek: ['.', '!', ', hatzlacha!', ', good luck!', ', good luck with the search!'], rental_offer: ['.', '!', ', hatzlacha!', ', all the best!', ', good luck!'], job: ['.', '!', ', hatzlacha!', ', all the best!', ', good luck!'], business: ['.', '!', ', hatzlacha!', ', all the best!', ', wishing you lots of success!'] };
const SUBJ = {
  recommend: ['About your recommendation', 'Re your reply', 'Your recommendation', 'Re your post', 'The business you mentioned'],
  rental_seek: ['Your apartment search', 'About the place you are looking for', 'Rentals in Jerusalem', 'Re your apartment post', 'Your rental question'],
  rental_offer: ['Your rental post', 'About your apartment', 'Your listing', 'Re your apartment', 'Your apartment post'],
  job: ['Your job post', 'About the position', 'Re your job opening', 'Your opening', 'The job you posted'],
  business: ['Your ad', 'About your business', 'Re your post', 'Your business', 'Your post'],
};
function oneSentence(kind, ctx) {
  const L = LINKS[kind === 'job' ? 'jobs' : (kind === 'business' || kind === 'recommend') ? 'site' : 'rentals'];
  const name = firstName(ctx && ctx.name), area = areaOf(ctx && ctx.text);
  const topics = area ? ['apartments in ' + area, 'a rental in ' + area, 'a place in ' + area] : ['apartments', 'a rental', 'the apartment you need'];
  for (let tries = 0; tries < 80; tries++) {
    const op = pick(OPEN);
    const T = (ctx && ctx.type) || '', an = (w) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
    const B = (ctx && ctx.bname) || (T ? 'the ' + T : 'the business');
    let body = pick(BODY[kind]).replace('{Y}', T ? 'your ' + T : 'your business').replace('{B}', B).replace('{T}', T ? an(T) : 'a good local business').replace('{t}', pick(topics)).replace('{a}', area && Math.random() < 0.7 ? ' in ' + area : '').replace('{L}', pick(L));
    body = body.charAt(0).toUpperCase() + body.slice(1);
    const text = (op + ' ' + body + pick(CLOSE[kind])).replace(/\s+/g, ' ').trim();
    if (!TEXTS.has(textKey(text))) return { text, subject: pick(SUBJ[kind]) };
  }
  return null;   // every wording was used already: nothing goes rather than the same words again
}
// ── a business ad with a flyer: posted on Chutznik as a fresh post, and the poster told where it is (Miriam, 28 Oct 2026:
//    "each time a business is posted on jerusaguide with a flier it should post as a fresh new post on chutznik and then inform
//    the author that we posted it for them … show the link … they can claim the listing so people can reach them from there")
const FLYER_OPEN = ['Hi!', 'Hey!', 'Hello!', 'Hi there!', 'Hey there!', 'Hello there!'];
const FLYER_BODY = [
  "I posted your ad on Chutznik for free so English speakers in Jerusalem can find you, here it is: {U}, and you can claim the listing there so people reach you directly",
  "your ad is now up on Chutznik at no cost, take a look at {U}, and if you like you can claim the listing so customers contact you straight from there",
  "I put your flyer up on Chutznik for free, you can see it here {U}, and claiming the listing lets people reach you right from the page",
  "your business is now listed on Chutznik for free at {U}, feel free to claim it there so people can get in touch with you directly",
  "I shared your ad on Chutznik so more people see it, it's here: {U}, and you can claim the listing to have people reach you from there",
  "your flyer is posted on Chutznik for free, have a look at {U}, and you're welcome to claim the listing so customers can contact you there",
];
const FLYER_EVENT = [
  "I posted your event on Chutznik for free so more people in Jerusalem see it, here it is: {U}, and you can claim the listing there so people reach you directly",
  "your event is now up on Chutznik at no cost, take a look at {U}, and if you like you can claim the listing so people contact you straight from there",
  "I put your flyer up on Chutznik's calendar for free, you can see it here {U}, and claiming the listing lets people reach you right from the page",
  "your event is listed on Chutznik for free at {U}, feel free to claim it there so people can get in touch with you directly",
  "I shared your event on Chutznik so more people come, it's here: {U}, and you can claim the listing to have people reach you from there",
];
const FLYER_CLOSE = ['.', '!', ', hatzlacha!', ', wishing you lots of success!', ', all the best!'];
const FLYER_SUBJ = ['Your ad is on Chutznik', 'I posted your ad', 'Your flyer on Chutznik', 'Your business on Chutznik', 'Your listing'];
function flyerNote(url, kind) {
  for (let tries = 0; tries < 80; tries++) {
    const body = pick(kind === 'event' ? FLYER_EVENT : FLYER_BODY).replace('{U}', url);
    const text = (pick(FLYER_OPEN) + ' ' + body.charAt(0).toUpperCase() + body.slice(1) + pick(FLYER_CLOSE)).replace(/\s+/g, ' ').trim();
    if (!TEXTS.has(textKey(text))) {
      const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222">' + esc(text).replace(esc(url), '<a href="' + url + '">' + esc(url) + '</a>') + '</div>';
      return { subject: kind === 'event' ? pick(['Your event is on Chutznik', 'I posted your event', 'Your flyer on Chutznik', 'Your event listing']) : pick(FLYER_SUBJ), text, html, kind: kind || 'business' };
    }
  }
  return null;
}
// the message again in full (the round reads only its top), its pictures uploaded, the post made; the post's link, or '' when
// there is no flyer or the site already has this business
// what a flyer is about, when the message's own words do not say (Miriam, 28 Oct 2026, on the RCCS "Holding onto Shabbos" flyer:
// "you should have caught this to make into a post and then inform author. Also do it for events")
const EVENT_WORDS = /\b(?:motzei shabb?(?:os|at)|shabbaton|melave malka|kumzit[sz]|concert|live music|choir|shiur(?:im)?|lecture|workshop|seminar|event|tickets?|register|registration|rsvp|admission|doors open|farbreng\w*|gathering|evening of|night of|tour|trip|fair|bazaar|party|siyum|gala|dinner|chinese auction|auction|raffle|performance|show|program|retreat|class(?:es)?|course)\b/i;
const DATE_WORDS = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b|\b(?:sunday|monday|tuesday|wednesday|thursday|friday|motzei)\b|\bparsh(?:as|at)\b/i;
function flyerKind(words) {
  const t = String(words || '');
  if (EVENT_WORDS.test(t) && DATE_WORDS.test(t)) return 'event';
  if (isBusinessAd('', t) || bizTypeOf(t)) return 'business';
  if (EVENT_WORDS.test(t)) return 'event';
  return '';
}
async function postFlyer(client, uid, mid, subject, text, who, whoName, opts, log, hint) {
  const site = (opts && opts.site) || SITE, key = opts && opts.ingestKey; if (!key) return '';
  let full; try { const msg = await client.fetchOne(uid, { source: true }, { uid: true }); if (!msg || !msg.source || msg.source.length > 12e6) return ''; const { simpleParser } = require('mailparser'); full = await simpleParser(msg.source); } catch (e) { return ''; }
  const pics = (full.attachments || []).filter((a) => /^image\/(?:jpeg|jpg|png|webp|gif)$/i.test(String(a.contentType || '')) && a.size >= 15000 && a.size <= 2.9e6).slice(0, 3);
  if (!pics.length) return '';
  // the flyer's own words, read on the droplet for free (the site's AI reads it properly afterwards and replaces them)
  let rough = ''; try { if (global._OS && global._OS.ocrBuffer) rough = await Promise.race([global._OS.ocrBuffer(Buffer.from(pics[0].content)), new Promise((r) => setTimeout(() => r(''), 25000))]) || ''; } catch (e) {}
  const kind = hint === 'business' ? 'business' : flyerKind(subject + ' ' + text + ' ' + rough);
  if (!kind) { log('📬 jerusaguide: a picture from ' + who + ' reads as neither an event nor a business — not posted'); return null; }
  const id = 'jg_' + require('crypto').createHash('sha1').update(mid).digest('hex').slice(0, 14);
  const H = { 'Content-Type': 'application/json', 'x-ingest-key': key, 'User-Agent': 'chutznik-bridge' };
  const attachments = [];
  for (let i = 0; i < pics.length; i++) {
    try {
      const mime = /png/i.test(pics[i].contentType) ? 'image/png' : /webp/i.test(pics[i].contentType) ? 'image/webp' : /gif/i.test(pics[i].contentType) ? 'image/gif' : 'image/jpeg';
      const r = await fetch(site + '/api/save-attachment', { method: 'POST', headers: H, body: JSON.stringify({ postId: id, index: i, mime, base64: Buffer.from(pics[i].content).toString('base64') }), signal: AbortSignal.timeout(60000) });
      const j = await r.json().catch(() => ({})); if (r.ok && j && j.url) attachments.push({ url: j.url, name: 'flyer.jpg' });
    } catch (e) {}
  }
  if (!attachments.length) return '';   // every picture was turned away (the dress check) or failed: no post
  // the ad as written, without the quoted thread or the group's footer
  const lines = []; for (const l of cleanText(full.text || '').split('\n')) { if (QUOTE_START.test(l)) break; lines.push(l); }
  const body = lines.join('\n').replace(/\s*\[image:[^\]]*\]/gi, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);   // no "[image: flyer.png]" placeholders
  const phone = (body.match(/(?:\+?972[\s-]?|0)(?:5\d|[2-9])[\s-]?\d{3}[\s-]?\d{4}/) || [''])[0];
  const area = areaOf(subject + ' ' + body);
  // never mention jerusaguide on the post (Miriam, 28 Oct 2026): no greeting to the group, no group, source or author by that name
  const noJg = (v) => String(v || '').replace(/^\s*(?:hello|hi|hey|dear|shalom|good (?:morning|evening))[\s,]+(?:dear\s+|all\s+)?jerusa?guide(?:rs|\s+(?:team|members|friends|group|family))?\s*[,!.:;-]*[ \t]*\n*/i, '')
    .replace(/\s+(?:on|in|to|from|via|at|through)\s+(?:the\s+)?jerusa?guide(?:\s+group)?\b/gi, '').replace(/\bjerusa?guide(?:\s+group)?\b[\s:,-]*/gi, '').replace(/[ \t]{2,}/g, ' ').trim().replace(/^[a-z]/, (c) => c.toUpperCase());
  const item = { id, source: 'email', group: '', title: (noJg(subject) || 'Local business').slice(0, 90), memo: noJg(body || subject), types: [kind === 'event' ? 'Events' : 'Company / Organization / Store / Group'],
    area: 'Jerusalem & Surrounding', communities: area ? [area] : [], author: /jerusa?guide/i.test(String(whoName || '')) ? '' : String(whoName || '').slice(0, 60), contactPhone: phone.replace(/[\s-]/g, ''), contactWebsite: '',
    claimEmail: who, created: Date.now(), status: 'public', attachments, dedupeKey: 'jg|' + id, ...(rough ? { picText: rough, picVia: 'ocr' } : {}) };
  try {
    const r = await fetch(site + '/api/ingest-whatsapp?file=updates', { method: 'POST', headers: H, body: JSON.stringify({ file: 'updates', items: [item] }), signal: AbortSignal.timeout(120000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j || !(j.added > 0)) { log('📬 jerusaguide: flyer from ' + who + ' not posted (' + (r.status) + (j && j.added === 0 ? ', the site already has it' : '') + ')'); return null; }
  } catch (e) { return null; }
  log('📬 jerusaguide: posted the ' + (kind === 'event' ? 'event' : 'business') + ' flyer "' + item.title.slice(0, 50) + '" as up_' + id);
  return { url: site + '/israel/post/up_' + id, kind };
}

function noteFor(c, ctx) {
  const kind = c.kind === 'recommend' ? 'recommend' : c.kind === 'business' ? 'business' : c.kind === 'job' ? 'job' : c.seek ? 'rental_seek' : 'rental_offer';
  const one = oneSentence(kind, Object.assign({}, ctx, { bname: c.name || '', type: c.type || (ctx && ctx.type) || '' })); if (!one) return null;
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222">' + esc(one.text).replace(/((?:https?:\/\/|www\.)?chutznik\.org[^\s,]*)/g, (m) => '<a href="' + (/^http/.test(m) ? m : 'https://' + m.replace(/^www\./, '')) + '">' + m + '</a>') + '</div>';
  return { subject: one.subject, text: one.text, html, kind };
}

const NOPUSH = new Set();   // messages judged again: no second memory or leads entry
let busy = false, sentToday = 0, dayKey = '', firstRound = true;
let LINK = null; try { LINK = require('./site-link.js'); } catch (e) {}
// a lead is anyone asking the group for something: a question mark up top, "looking for", "anyone know"… or the classifier's ask / seek
const LEAD_RE = /\b(?:looking for|anyone (?:know|have|has|recommend)|does anyone|do you know|where (?:can|do|to)|recommend|recommendation|suggestion|in search of|iso|seeking|need(?:ed|s)? (?:a|an|some|help)|wanted|any (?:good|idea|leads?)|who (?:does|has|knows)|is there)\b/i;
function looksLikeQuestion(subject, text, c) {
  if (c && (c.kind === 'ask' || c.seek)) return true;
  const head = String(subject || '') + '\n' + String(text || '').split('\n').slice(0, 4).join('\n');
  return /\?/.test(head) || LEAD_RE.test(head);
}
// the suggestions email, through the site's own mail function (logged like every other email)
function esc(v) { return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// the suggestions on WhatsApp (Miriam, 14 Oct 2026: "change to sending on whatsapp to 19294418833"): one message
// per poster with the note and the same two links as the email; a tap opens the site, which sends the note
async function sendSuggestionsWA(list, opts, log) {
  const nums = (opts && opts.wa) || [], sock = opts && typeof opts.sock === 'function' ? opts.sock() : null;
  if (!nums.length) return null;                                   // not asked for
  if (!sock || !sock.user) { log('📬 jerusaguide: WhatsApp is not connected, the suggestions wait'); return false; }
  const site = (opts && opts.site) || SITE;
  const what = (x) => x.kind === 'ask' ? 'a ' + x.topic : (x.seek ? 'the ' : 'your ') + x.kind;
  const label = (x) => x.kind === 'ask' ? 'is looking for a ' + x.topic : (x.seek ? 'is looking for a ' : 'posted a ') + x.kind;
  const approve = (x) => site + '/israel/#approve/' + x.token + '?who=' + encodeURIComponent(x.who) + '&what=' + encodeURIComponent(what(x)) + '&via=email';
  let sent = 0;
  for (const x of list) {
    const text = '✉️ *' + x.who + '* ' + label(x) + '\n_' + (x.subject || '(no subject)') + '_'
      + (x.snippet ? '\n' + x.snippet.slice(0, 220) + (x.snippet.length > 220 ? '…' : '') : '')
      + '\n\n*Suggested note:*\n' + x.note.text
      + '\n\n✓ Send it from Chutznik:\n' + approve(x)
      + '\n\n✏️ Edit & send:\n' + approve(x) + '&edit=1&text=' + encodeURIComponent(x.note.text);
    for (const num of nums) {
      try { await Promise.race([sock.sendMessage(num + '@s.whatsapp.net', { text }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000))]); sent++; }
      catch (e) { log('📬 jerusaguide: WhatsApp to ' + num + ' failed: ' + (e && e.message)); }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  log('📬 jerusaguide: ' + list.length + ' suggestion(s) sent on WhatsApp to ' + nums.join(', '));
  return sent > 0;
}
async function sendSuggestions(list, opts, log) {
  const wa = await sendSuggestionsWA(list, opts, log);
  if (wa !== null && !(opts && opts.to && opts.to.length)) return wa;   // WhatsApp asked for and no email list: done
  const to = (opts && opts.to && opts.to.length) ? opts.to : SUGGEST_DEFAULT_TO;
  const site = (opts && opts.site) || SITE, key = opts && opts.ingestKey;
  if (!key) { log('📬 jerusaguide: no site key for the suggestions email'); return !!wa; }
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
  if (!r.ok) { log('📬 jerusaguide: suggestions mail failed ' + r.status + ' ' + rt); return !!wa; }
  log('📬 jerusaguide: ' + list.length + ' suggestion(s) emailed to ' + to.join(', '));
  return true;
}
async function run(log, opts) {
  log = log || ((s) => console.log(s));
  MODE = modeNow();
  const early = (why) => { global._jgReport = Object.assign({}, global._jgReport || {}, { mode: MODE, skippedAt: new Date().toISOString(), skippedWhy: why }); if (global._jgLastWhy !== why) { global._jgLastWhy = why; log('📬 jerusaguide: ' + why); } };
  let shabbos = false; try { shabbos = require('./shabbos.js').isShabbos(); } catch (e) {}
  const notesOff = MODE === 'off' || shabbos;   // off, or Shabbos: no note, no suggestion — the inbox is still read for the leads and the memory (23–24 Oct 2026)
  if (shabbos && global._jgLastWhy !== 'shabbos') { global._jgLastWhy = 'shabbos'; log('🕯️ Shabbos — jerusaguide notes wait until after Shabbos (New York time)'); }
  if (notesOff && global._jgLastWhy !== 'off-reading') { global._jgLastWhy = 'off-reading'; log('📬 jerusaguide: notes are off — reading the group for leads and memory only'); }
  // a round that hangs (Gmail not answering) must not block every round after it: ten minutes and the lock is dropped
  if (busy && Date.now() - (global._jgBusySince || 0) < 10 * 60 * 1000) return; busy = true; global._jgBusySince = Date.now();
  const today = new Date().toISOString().slice(0, 10); if (today !== dayKey) { dayKey = today; sentToday = 0; }
  const user = process.env.GMAIL_USER, pass = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) { busy = false; return early('no GMAIL_USER / GMAIL_APP_PASSWORD on the droplet — the inbox cannot be read'); }
  let ImapFlow, simpleParser;
  try { ({ ImapFlow } = require('imapflow')); ({ simpleParser } = require('mailparser')); } catch (e) { busy = false; return early('run  npm i imapflow mailparser'); }
  // the round's report for bridge-status.json (14 Oct 2026, Miriam: "i havent gotten one since 11:54" — a quiet
  // round leaves nothing in the log, so the status says when it ran, what it found and why each message was left alone)
  const rep = { mode: MODE, startedAt: new Date().toISOString(), found: 0, fresh: 0, why: {}, told: Object.keys(TOLD).length, pending: pendingCount() };
  const why = (k) => { rep.why[k] = (rep.why[k] || 0) + 1; };
  // hard limits on the connection: a round that silently hung on Gmail blocked every round after it for hours
  // (14 Oct 2026: nothing suggested since the morning, nothing in the log, no report at all)
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false, connectionTimeout: 30000, greetingTimeout: 15000, socketTimeout: 120000 });
  const step = (what) => { global._jgReport = Object.assign({}, global._jgReport || {}, { running: { startedAt: rep.startedAt, step: what, at: new Date().toISOString() } }); };
  const killer = setTimeout(() => { step('timed out after 4 minutes — the connection was closed'); log('📬 jerusaguide: the round took over 4 minutes, closing the connection'); try { client.close(); } catch (e) {} }, 4 * 60 * 1000);
  const ours = new Set([user.toLowerCase(), REPLY_TO.toLowerCase(), (FROM.match(/<([^>]+)>/) || [])[1] || ''].filter(Boolean));
  let sent = 0, skipped = 0, recent = null;   // recent: the site's rentals of the last three days, for the matches
  const suggestions = [], siteCache = {}, leads = [];
  try {
    step('connecting to Gmail');
    await client.connect();
    step('opening the mailbox');
    let box = '[Gmail]/All Mail';
    try { await client.mailboxOpen(box); } catch (e) { box = 'INBOX'; await client.mailboxOpen(box); }
    const since = new Date(Date.now() - (firstRound ? HOURS : 3) * 3600 * 1000); firstRound = false;
    // the group sends hundreds of emails a day (14 Oct 2026: 436 in the window) and every round used to pull the
    // full text of each one, so a round never got to the end. Now: from the last UID handled onwards only (an IMAP
    // "since" is a whole day), the headers in one call, and the full text only of the messages never seen before
    const uv = String(client.mailbox && client.mailbox.uidValidity || '');
    const hw = (uv && HIGH[uv]) ? Number(HIGH[uv]) : 0;
    let uids = [];
    if (hw) {
      // one quick ask: everything after the last UID; the headers below say which are the group's
      // (Miriam, 14 Oct 2026: "only read the first two lines… without reading all the long inlines")
      let found = []; try { found = await client.search({ uid: (hw + 1) + ':*' }, { uid: true }) || []; } catch (e) {}
      for (const u of found) if (u > hw && !uids.includes(u)) uids.push(u);
    } else {
      for (const base of [{ from: GROUP }, { to: GROUP }, { cc: GROUP }, { header: { 'List-ID': GROUP_KEY } }]) {
        let found = []; try { found = await client.search(Object.assign({ since }, base), { uid: true }) || []; } catch (e) {}
        for (const u of found) if (!uids.includes(u)) uids.push(u);
      }
    }
    // once: the messages since 15:46 UTC on 28 Oct were cut short before their group headers and taken for "not from the group";
    // they are read again (nothing was sent from them, and nothing went to memory or the leads)
    // once more (28 Oct 2026 19:30): the replies naming a business were left alone before; judged again now — notes only, since
    // memory and the leads have them already
    const REJUDGE = path.join(__dirname, '..', 'jg-rejudge-1028b.txt');   // b: again for the event and business flyers (28 Oct 2026 20:00) let rejudgeOk = false;
    const REJ_LIST = path.join(__dirname, '..', 'jg-rejudge-list-b.json');
    if (!fs.existsSync(REJUDGE)) {
      try {
        let list = null; try { list = JSON.parse(fs.readFileSync(REJ_LIST, 'utf8')); } catch (e) {}
        if (!Array.isArray(list)) {   // made once: the group's messages since 15:46 UTC
          list = []; const cut = Date.parse('2026-10-28T15:46:00Z'); const more = [];
          for (const base of [{ to: GROUP }, { cc: GROUP }, { from: GROUP }]) { let f = []; try { f = await client.search(Object.assign({ since: new Date('2026-10-28T00:00:00Z') }, base), { uid: true }) || []; } catch (e) {} for (const u of f) if (!more.includes(u)) more.push(u); }
          if (more.length) for await (const m of client.fetch(more.join(','), { uid: true, envelope: true, internalDate: true }, { uid: true })) {
            const t = m.internalDate ? new Date(m.internalDate).getTime() : 0; if (t < cut) continue;
            list.push({ uid: m.uid, mid: 'jg_' + String((m.envelope && m.envelope.messageId) || m.uid).replace(/[<>\s]/g, '').slice(0, 80) });
          }
          fs.writeFileSync(REJ_LIST, JSON.stringify(list)); log('📬 jerusaguide: judging again ' + list.length + ' message(s) since 15:46 UTC under the new reply rules');
        }
        const todo = list.filter((x) => !x.done).slice(0, 8);   // a few each round, so a round never runs out of time on them
        for (const x of todo) { SEEN.delete(x.mid); NOPUSH.add(x.mid); if (!uids.includes(x.uid)) uids.push(x.uid); }
        global._jgRejudge = { list, todo: new Set(todo.map((x) => x.mid)) };
        rejudgeOk = true;
      } catch (e) {}
    }
    // (a second pass, 28 Oct 2026 19:10: the first was cut off by the 4-minute limit; only what is still unread is fetched now)
    const REREAD = path.join(__dirname, '..', 'jg-reread-1028b.txt'); let rereadOk = false;
    if (!fs.existsSync(REREAD)) {
      try {
        const cut = Date.parse('2026-10-28T15:46:00Z'); const more = [];
        for (const base of [{ to: GROUP }, { cc: GROUP }, { from: GROUP }, { header: { 'List-ID': GROUP_KEY } }]) { let f = []; try { f = await client.search(Object.assign({ since: new Date('2026-10-28T00:00:00Z') }, base), { uid: true }) || []; } catch (e) {} for (const u of f) if (!more.includes(u)) more.push(u); }
        if (more.length) for await (const m of client.fetch(more.join(','), { uid: true, envelope: true, internalDate: true }, { uid: true })) {
          const t = m.internalDate ? new Date(m.internalDate).getTime() : 0; if (t < cut) continue;
          if (SEEN.has('jg_' + String((m.envelope && m.envelope.messageId) || m.uid).replace(/[<>\s]/g, '').slice(0, 80))) continue;   // read already
          if (!uids.includes(m.uid)) uids.push(m.uid);
        }
        rereadOk = true; log('📬 jerusaguide: reading again the messages since 15:46 UTC (cut short before)');
      } catch (e) {}
    }
    uids.sort((a, b) => a - b);
    rep.found = uids.length; step('searching: ' + uids.length + ' group message(s) ' + (hw ? 'after UID ' + hw : 'in the window'));
    // the headers of all of them in one go: a message already seen, or a reply in a thread, is never downloaded
    const heads = [];
    if (uids.length) { try { for await (const m of client.fetch(uids.join(','), { uid: true, envelope: true }, { uid: true })) heads.push(m); } catch (e) { log('📬 jerusaguide: headers: ' + (e && e.message)); } }
    let maxUid = hw;
    const toRead = [];
    for (const h of heads) {
      if (h.uid > maxUid) maxUid = h.uid;
      const env = h.envelope || {};
      const mid = 'jg_' + String(env.messageId || h.uid).replace(/[<>\s]/g, '').slice(0, 80);
      if (SEEN.has(mid)) continue;
      // the envelope says whether this is the group's mail at all; anything else is skipped unread
      const addrs = ['from', 'to', 'cc', 'sender', 'replyTo'].flatMap((k) => (env[k] || []).map((a) => String(a.address || '').toLowerCase()));
      const grp = addrs.some((a) => a === GROUP || a.indexOf(GROUP_KEY) > -1);
      if (hw && !grp) { SEEN.add(mid); continue; }
      toRead.push({ uid: h.uid, mid, grp });
    }
    step('reading ' + toRead.length + ' new message(s)');
    let n = 0, complete = true; const roundStart = Date.parse(rep.startedAt) || Date.now();
    for (const { uid, mid, grp } of toRead) {
      if (Date.now() - roundStart > 190 * 1000) { complete = false; log('📬 jerusaguide: out of time this round — the rest next round'); break; }   // the 4-minute limit must never cut a round mid-way
      if (++n % 10 === 0) step('reading message ' + n + ' of ' + toRead.length);
      // the daily cap guards against spamming posters: it counts notes actually SENT. Suggestions to Miriam are
      // not capped (14 Oct 2026: "daily cap of 25 reached" and nothing was suggested for the rest of the day)
      if (MODE !== 'suggest' && !notesOff && sentToday >= DAILY) { log('📬 jerusaguide: daily cap of ' + DAILY + ' reached'); complete = false; break; }
      let parsed;
      // the top of the message only: the posting is in its first lines, the rest is quoted thread and footers
      let hasPic = false;
      try { const msg = await client.fetchOne(uid, { source: { maxLength: 48000 } }, { uid: true }); if (!msg || !msg.source) continue; hasPic = /Content-Type:\s*image\/(?:jpe?g|png|webp|gif)/i.test(msg.source.toString('latin1')); parsed = await simpleParser(msg.source); } catch (e) { continue; }
      if (SEEN.has(mid)) continue;
      SEEN.add(mid); rep.fresh++;
      // (28 Oct 2026: with 16 KB the long Google headers were cut before List-ID and every message looked foreign)
      if (!grp && !fromTheGroup(parsed)) { why('not from the group'); continue; }
      const who = posterAddress(parsed);
      if (!who || ours.has(who)) { skipped++; why('our own address'); continue; }
      const subject = String(parsed.subject || '').replace(/^\s*(?:(?:re|fw|fwd)\s*:\s*)+/i, '').replace(/\[[^\]]*\]\s*/g, '').trim();
      // a reply in a thread (Miriam, 28 Oct 2026: "people ask a question as a first email and then others reply with rentals or business
      // info … ensure they get emails too"): judged by its own fresh words, the thread's subject only as a hint
      const isReply = /^\s*re\s*:/i.test(parsed.subject || '');
      // the first lines are the posting; the long quoted thread underneath is never read (Miriam, 14 Oct 2026)
      const text = freshText(cleanText(parsed.text || (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, ' ') : '')));
      let c = isReply ? classifyReply(subject, text) : classify(subject, text);
      if ((!c || c.kind === 'ask') && isBusinessAd(isReply ? '' : subject, text)) c = { kind: 'business', seek: false };
      // every posting goes to Chutznik memory, and a question goes to the admin's leads — told before or not (23 Oct 2026)
      const link = (opts && opts.link) || LINK;
      const when = (parsed.date && new Date(parsed.date).getTime()) || Date.now();
      const whoName = String(parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].name || '').replace(/\s*via\s+.*$/i, '').trim();
      if (!NOPUSH.has(mid)) try { if (link) link.memoryPush({ src: 'jerusaguide', group: 'jerusaguide', ts: when, author: whoName || who, title: subject, text }); } catch (e) {}
      if (!NOPUSH.has(mid) && looksLikeQuestion(subject, text, c)) { leads.push({ id: mid, group: 'jerusaguide', text: (subject + '\n' + text).trim().slice(0, 700), name: whoName, email: who, at: when }); rep.leads = (rep.leads || 0) + 1; }
      if (notesOff) { skipped++; why('notes are off'); continue; }
      // only people posting or seeking a rental are written to — not jobs, not other questions (Miriam, 23 Oct 2026)
      // a first post with a picture that is not a question: a flyer (an event or a business), read and posted for them
      if ((!c || c.kind === 'ask') && !isReply && hasPic && !looksLikeQuestion(subject, text, null)) c = { kind: 'flyer', seek: false };
      if (!c) { skipped++; why('not a rental, job or request'); continue; }   // (26 Oct 2026: this check came after the rental one and a null threw, ending the round)
      // a rental post or question, a job on offer, a business advert (Miriam, 28 Oct 2026); not someone looking for work, not other questions
      if (c.kind === 'business' && !c.type) c.type = bizTypeOf(subject, text);
      if (!(c.kind === 'rental' || (c.kind === 'job' && !c.seek) || c.kind === 'business' || c.kind === 'recommend' || c.kind === 'flyer')) { skipped++; why(c.kind === 'job' ? 'looking for work — no note' : 'not a rental, job post or business advert'); continue; }
      if (neverWrite(who, whoName)) { skipped++; why('the group\'s admins and the never-write list'); continue; }
      if (TOLD[who]) { skipped++; why('already written to'); continue; }                         // never twice — whatever they post
      let note = null;
      if ((c.kind === 'business' || c.kind === 'flyer') && MODE === 'live') {   // a flyer: posted for them first, then the note says where
        let got = null; try { got = await postFlyer(client, uid, mid, subject, text, who, whoName, opts, log, c.kind === 'business' ? 'business' : ''); } catch (e) {}
        if (got && got.url) { note = flyerNote(got.url, got.kind); rep.flyers = (rep.flyers || 0) + 1; }
      }
      if (!note && c.kind === 'flyer') { skipped++; why('a picture that is not an event or business flyer'); continue; }
      if (!note) note = noteFor(c, { name: whoName, text: subject + ' ' + text });
      if (!note) { skipped++; why('every wording already used'); continue; }
      if (MODE === 'suggest') { suggestions.push({ mid, token: require('crypto').randomBytes(16).toString('hex'), who, kind: c.kind, topic: c.topic || '', seek: c.seek, subject: subject.slice(0, 120), snippet: text.replace(/\s+/g, ' ').trim().slice(0, 280), note }); sent++; continue; }
      if (MODE === 'dry') { log('📬 jerusaguide (dry): would email ' + who + ' — ' + note.subject + ' — ' + (c.seek ? 'asking' : 'posting') + ' · "' + subject.slice(0, 60) + '"'); TOLD[who] = { ts: Date.now(), kind: c.kind, seek: c.seek, dry: true, subject: subject.slice(0, 80) }; sent++; sentToday++; continue; }
      try {
        const via = await sendMail(who, note, log, opts);
        TOLD[who] = { ts: Date.now(), kind: c.kind, seek: c.seek, via, subject: subject.slice(0, 80) };
        TEXTS.add(textKey(note.text)); saveTexts();
        sent++; sentToday++;
        log('📬 jerusaguide: emailed ' + who + ' — ' + note.subject + ' (' + (c.seek ? 'asking' : 'posting') + ')');
        await new Promise((r) => setTimeout(r, 4000));
      } catch (e) { log('📬 jerusaguide: ' + who + ' failed: ' + (e && e.message)); }
    }
    if (suggestions.length) {
      step('emailing ' + suggestions.length + ' suggestion(s)');
      const ok = await sendSuggestions(suggestions, opts, log);
      if (ok) for (const x of suggestions) { TOLD[x.who] = { ts: Date.now(), kind: x.kind, seek: x.seek, suggested: true, subject: x.subject.slice(0, 80) }; PENDING[x.token] = { who: x.who, kind: x.kind, seek: x.seek, subject: x.subject, note: x.note, at: Date.now() }; }
      if (ok) savePending();
      else { sent -= suggestions.length; for (const x of suggestions) SEEN.delete(x.mid); }
    }
    if (leads.length) { const link = (opts && opts.link) || LINK; try { if (link) await link.leadsPush(leads); } catch (e) {} }
    // the high-water mark moves only when every new message was read: a round cut short reads the rest next time
    if (complete && uv && maxUid > hw) { HIGH[uv] = maxUid; saveHigh(); }
    if (rejudgeOk && global._jgRejudge) { try { const R = global._jgRejudge; for (const x of R.list) if (R.todo.has(x.mid) && SEEN.has(x.mid)) x.done = true;
      if (R.list.every((x) => x.done)) { fs.writeFileSync(REJUDGE, new Date().toISOString()); log('📬 jerusaguide: judging again — done'); } else fs.writeFileSync(REJ_LIST, JSON.stringify(R.list)); } catch (e) {} NOPUSH.clear(); }
    if (rereadOk && complete) { try { fs.writeFileSync(REREAD, new Date().toISOString()); } catch (e) {} }
    saveSeen(); saveTold();
  } catch (e) { const inner = e && e.errors && e.errors[0] && e.errors[0].message; rep.error = (e && e.message ? e.message.slice(0, 160) : String(e)) + (inner ? ' (' + String(inner).slice(0, 120) + ')' : ''); log('📬 jerusaguide: ' + rep.error); }
  finally { clearTimeout(killer); try { await client.logout(); } catch (e) {} busy = false; }
  rep.suggested = suggestions.length; rep.sent = sent; rep.finishedAt = new Date().toISOString();
  if (suggestions.length) rep.lastSuggestedAt = rep.finishedAt;
  const prev = global._jgReport || {};
  global._jgReport = Object.assign({}, rep, { running: null, lastSuggestedAt: rep.lastSuggestedAt || prev.lastSuggestedAt || null, rounds: (prev.rounds || 0) + 1, lastError: rep.error || prev.lastError || null, lastErrorAt: rep.error ? rep.finishedAt : (prev.lastErrorAt || null) });
  if (sent || skipped) log('📬 jerusaguide: ' + sent + ' note(s) ' + (MODE === 'dry' ? 'rehearsed' : MODE === 'suggest' ? 'suggested' : 'sent') + ', ' + skipped + ' left alone');
}

// Miriam pressed "Send it from Chutznik" on a suggested note (the approve token came back from the site)
async function approve(token, opts, log, text) {
  const p = PENDING[token]; if (!p) return false;
  if (neverWrite(p.who, '')) { p.sent = Date.now(); p.failed = true; savePending(); return true; }
  if (p.sent) return true;
  // Miriam edited the note on the site before pressing Send: her words go, not the suggestion
  let note = p.note;
  if (typeof text === 'string' && text.trim().length >= 10) {
    let t = text.trim().slice(0, 2000);
    note = { subject: p.note.subject, text: t, html: '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.55;color:#3a2f27">' + t.split('\n').map((l) => esc(l).replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#a8483f">$1</a>')).join('<br>') + '</div>' };
  }
  try {
    const via = await sendMail(p.who, note, log, opts);
    p.sent = Date.now(); p.via = via; TEXTS.add(textKey(note.text)); saveTexts(); if (note !== p.note) p.edited = true; TOLD[p.who] = { ts: Date.now(), kind: p.kind, seek: p.seek, via, approved: true, subject: String(p.subject || '').slice(0, 80) };
    log('📬 jerusaguide: emailed ' + p.who + ' — ' + p.note.subject + ' (approved by Miriam)');
  } catch (e) { p.tries = (p.tries || 0) + 1; log('📬 jerusaguide: note to ' + p.who + ' failed: ' + (e && e.message)); if (p.tries < 3) { savePending(); return false; } p.sent = Date.now(); p.failed = true; }
  savePending(); saveTold();
  return true;
}
const pendingCount = () => Object.values(PENDING).filter((p) => p && !p.sent).length;
// JG_RESUGGEST {stamp} in the site settings: the suggested-but-unsent notes are forgotten and the
// last two days are read again under the current rules (once per stamp)
const RESUG_FILE = path.join(__dirname, '..', 'jg-resuggest.txt');
const RULES = 11;   // bumped with each change of the rules; a stamp ending in -rules-N waits for code at least N
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

module.exports = { run, approve, neverWrite, flyerNote, flyerKind, recommendationIn, bizTypeOf, pendingCount, resuggest, askTopic, classify, classifyReply, noteFor, freshText, isBusinessAd, posterAddress, modeNow, get MODE() { return modeNow(); } };

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
    ['Homecooked Suppers and Shabbos Meals', 'Place your orders! Full menu, delivery in Ramat Eshkol, call or whatsapp 052-555-1234'],
    ['Sheitels washed and set', 'Professional wig styling, 15 years of experience, prices start at 150 NIS, appointments 054-1234567'],
    ['Apartment for rent in Katamon', '3 rooms, furnished, 7500 NIS a month, available from December.\nOn Mon, Oct 27, 2026 at 9:12 PM Someone <x@y.com> wrote:\n> Looking for a 2 bedroom in Baka, budget 6000'],
  ];
  for (const [s, t0] of tests) { const t = freshText(cleanText(t0)); let c = classify(s, t); if ((!c || c.kind === 'ask') && isBusinessAd(s, t)) c = { kind: 'business', seek: false };
    const ok = c && (c.kind === 'rental' || (c.kind === 'job' && !c.seek) || c.kind === 'business'); console.log((ok ? '✉ ' : '  ') + (c ? c.kind + (c.seek ? '/seek' : '') : '-').padEnd(13), s.slice(0, 50).padEnd(52), ok ? '→ ' + noteFor(c, { name: 'Sarah Levy', text: s + ' ' + t }).text : ''); }
}
