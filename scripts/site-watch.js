// ── The droplet watches the site (Miriam, 3 Nov 2026: "I should be informed if posts aren't coming in on the WhatsApp
//    end or site end or Vercel end — all without Claude"). The site's own watch (a Vercel schedule) looks after the bridge;
//    this one looks after the site and Vercel from the outside, so when Vercel itself is down someone still hears.
//    Every 10 minutes the three feeds the site's loading screen needs are asked for: the posts count, the board, the
//    groups feed. Two failures in a row (20 minutes) → one email to the owners, again every 6 hours while it lasts, and one
//    more when it is back. Shabbos: nothing is sent (held until after). Record: site-watch.json beside the bridge.
'use strict';
const fs = require('fs');
const path = require('path');
let SH = null; try { SH = require('./shabbos'); } catch (e) {}
const FILE = path.join(__dirname, '..', 'site-watch.json');
const SITE = (process.env.INGEST_URL || 'https://chutznik.org/api/ingest-whatsapp').replace(/\/api\/.*/, '');
const KEY = process.env.INGEST_KEY || '';
const TO = String(process.env.ALERT_TO || 'mpfederman@gmail.com,miriam@chutznik.org').split(',').map((s) => s.trim()).filter(Boolean);
const EVERY = 10 * 60 * 1000, AGAIN = 6 * 3600 * 1000;
let LOG = (s) => console.log(s);
const il = (t) => new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; } };
const save = (r) => { try { fs.writeFileSync(FILE, JSON.stringify(r, null, 1)); } catch (e) {} };
const hdrs = { 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge site-watch' };

// one look at the three feeds: '' when all answer, else what failed
async function look() {
  const get = (q) => fetch(SITE + '/api/live-data?' + q, { headers: hdrs, signal: AbortSignal.timeout(25000) });
  try {
    const r = await get('type=updates&since=' + (Date.now() + 365 * 864e5));
    const body = await r.text().catch(() => ''); let j = null; try { j = JSON.parse(body); } catch (e) {}
    if (!r.ok) return 'posts: HTTP ' + r.status + ' ' + body.replace(/\s+/g, ' ').slice(0, 140);
    if (!j || typeof j.count !== 'number') return 'posts: no count';
    if (j.count < 200) return 'posts: only ' + j.count;
  } catch (e) { return 'posts: ' + String(e && e.message).slice(0, 100); }
  for (const [t, name] of [['posts', 'board'], ['whatsapp', 'groups']]) {
    try {
      const r = await get('type=' + t); const body = await r.text().catch(() => '');
      if (!r.ok) return name + ': HTTP ' + r.status + ' ' + body.replace(/\s+/g, ' ').slice(0, 140);
      if (!/^\s*\[/.test(body)) return name + ': not a list';
    } catch (e) { return name + ': ' + String(e && e.message).slice(0, 100); }
  }
  return '';
}

async function mail(subject, text) {
  const from = 'Chutznik <info@chutznik.org>';
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: TO, subject, text }) });
    if (r.ok) return 'resend'; throw new Error('resend ' + r.status);
  }
  const nodemailer = require('nodemailer');
  const user = process.env.GMAIL_USER, pass = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) throw new Error('no RESEND_API_KEY and no Gmail login in .env');
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  await t.sendMail({ from: user, to: TO.join(','), subject, text });
  return 'gmail';
}

let _fails = 0;
async function round() {
  const rec = load(); const now = Date.now();
  const why = await look();
  if (why) {
    _fails++;
    LOG('🩺 site watch: ' + why + (_fails < 2 ? ' — looking again in 10 min' : ''));
    if (_fails < 2) return;
    rec.downSince = rec.downSince || now; rec.lastWhy = why; rec.lastAt = now;
    if (SH && SH.isShabbos && SH.isShabbos(now)) { rec.heldShabbos = true; save(rec); return; }
    if (!rec.alertedAt || now - rec.alertedAt > AGAIN) {
      try {
        await mail('⚠️ chutznik.org is not answering — ' + why.split(':')[0],
          'The droplet asked chutznik.org for its posts and got: ' + why + '\n\nSince ' + il(rec.downSince) + ' (Israel time). Visitors see "Chutznik could not be reached" until it answers again.\n\n'
          + 'If Vercel is down: vercel-status.com. If only the posts fail, GitHub may be slow — it usually heals by itself within the hour.\n\n'
          + 'This email comes every six hours while it lasts, and once more when it is back.\n— Chutznik (sent from the droplet, which does not depend on Vercel)');
        rec.alertedAt = now; rec.alerts = (rec.alerts || 0) + 1; LOG('🩺 site watch: owners told');
      } catch (e) { LOG('🩺 site watch: could not send the alert — ' + (e && e.message)); }
    }
    save(rec); return;
  }
  _fails = 0;
  if (rec.downSince) {
    const since = rec.downSince; delete rec.downSince; delete rec.heldShabbos; const told = !!rec.alertedAt; delete rec.alertedAt; rec.backAt = now; save(rec);
    if (told) { try { await mail('✅ chutznik.org answers again', 'The site answers again since ' + il(now) + ' (Israel time). It was not answering from ' + il(since) + '.\n— Chutznik (from the droplet)'); } catch (e) {} }
    LOG('🩺 site watch: back');
  }
}
let _started = false;
function start(log) {
  if (_started) return; _started = true; if (log) LOG = log;
  setInterval(() => { round().catch((e) => LOG('🩺 site watch: ' + (e && e.message))); }, EVERY);
  setTimeout(() => { round().catch((e) => LOG('🩺 site watch: ' + (e && e.message))); }, 90 * 1000);
  LOG('🩺 site watch: chutznik.org asked every 10 min (posts, board, groups) · owners emailed after 20 min of silence · ' + TO.join(', '));
}
module.exports = { start, round, look };
