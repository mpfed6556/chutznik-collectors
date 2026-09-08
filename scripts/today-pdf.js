// ── "TODAY in Jerusalem" — a clickable one-page PDF of the day's events ──────
// Built from the same calendar logic as chutznik.org/calendar (events-lib.js).
// Each event has a "Read more" button that opens its post on the site, so the
// sheet can go out on a WhatsApp status and people can tap through.
'use strict';
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const L = require('./events-lib.js');

const FONT = path.join(__dirname, '..', 'fonts', 'DejaVuSans.ttf');
const FONT_B = path.join(__dirname, '..', 'fonts', 'DejaVuSans-Bold.ttf');
const LOGO = path.join(__dirname, '..', 'fonts', 'logo.png');
const LADY = path.join(__dirname, '..', 'fonts', 'lady.png');

const KIND_COLOR = { sale: '#e0648a', kids: '#f59e0b', show: '#8b5cf6', class: '#0ea5e9', torah: '#a8816b', health: '#10b981', tour: '#2563eb', food: '#f97316', chesed: '#ef4444', meet: '#c4845f' };
const KIND_WORD = { sale: 'Sale', kids: 'Kids', show: 'Show', class: 'Class', torah: 'Shiur', health: 'Wellness', tour: 'Trip', food: 'Food', chesed: 'Chesed', meet: 'Get-together' };

function israelToday() {
  // the calendar day in Israel, as a Date at local midnight of that day
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return new Date(g('year'), g('month') - 1, g('day'));
}
function hebrewDate(d) {
  try { return new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).format(d); } catch (e) { return ''; }
}
function clean(s) { return String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim(); }
function timeLabel(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am'; const hh = ((h + 11) % 12) + 1;
  return hh + (m ? ':' + String(m).padStart(2, '0') : '') + ' ' + ap;
}

// Today's events from the site's data (public items only, like the calendar)
async function fetchTodayEvents(site) {
  const get = async (t) => { const r = await fetch(site + '/api/live-data?type=' + t); if (!r.ok) throw new Error(t + ' ' + r.status); return r.json(); };
  const [posts, updates] = await Promise.all([get('posts').catch(() => []), get('updates').catch(() => [])]);
  for (const u of updates) if (u && typeof u.created === 'string') { const t = Date.parse(u.created); u.created = isNaN(t) ? Date.now() : t; }
  L.S.allPosts = Array.isArray(posts) ? posts : []; L.S._updates = Array.isArray(updates) ? updates : []; L.S._waPosts = [];
  const today = israelToday();
  const byDay = L.evByDay(L.collectEvents());
  const list = (byDay[L.evKey(today)] || []).slice();
  const tk = (t) => t ? t.split(':').map((x) => x.padStart(2, '0')).join(':') : '99:99';
  list.sort((a, b) => tk(a.time).localeCompare(tk(b.time)));
  return { today, events: list };
}

// The sheet itself → Buffer
function buildTodayPdf({ site, today, events }) {
  const W = 1080, PAD = 64;
  const CARD_H = 150, GAP = 22;
  const headH = 470, footH = 240;
  const H = Math.max(1400, headH + events.length * (CARD_H + GAP) + footH);
  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: 'Today in Jerusalem — Chutznik', Author: 'Chutznik' } });
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  doc.registerFont('R', FONT); doc.registerFont('B', FONT_B);

  // paper
  doc.rect(0, 0, W, H).fill('#fbf6f0');
  doc.rect(0, 0, W, 14).fill('#c4845f');
  // header: logo + wordmark, site on the right
  try { doc.image(LOGO, PAD, 54, { width: 96, height: 96 }); } catch (e) {}
  doc.font('B').fontSize(52).fillColor('#6b4a36').text('Chutznik', PAD + 116, 68, { lineBreak: false });
  doc.font('R').fontSize(22).fillColor('#a8816b').text('chutznik.org', PAD + 118, 128, { lineBreak: false, link: site });
  doc.font('R').fontSize(20).fillColor('#9a8c80').text('What’s on in Jerusalem', W - PAD - 420, 86, { width: 420, align: 'right', lineBreak: false });

  // TODAY + date
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const heb = hebrewDate(today);
  doc.font('B').fontSize(118).fillColor('#c4845f').text('TODAY', PAD, 190, { lineBreak: false, characterSpacing: 4 });
  doc.font('B').fontSize(40).fillColor('#3d2f27').text(dayName + ', ' + dateStr, PAD, 322, { lineBreak: false });
  if (heb) doc.font('R').fontSize(26).fillColor('#9a8c80').text(heb, PAD, 374, { lineBreak: false });
  doc.font('R').fontSize(24).fillColor('#6b5a4e').text(events.length + ' things happening in Jerusalem today', PAD, 414, { lineBreak: false });
  doc.moveTo(PAD, 452).lineTo(W - PAD, 452).lineWidth(2).stroke('#eddccd');

  // event cards
  let y = headH;
  for (const e of events) {
    const url = site + '/post/' + encodeURIComponent(String(e.id));
    const col = KIND_COLOR[e.kind] || KIND_COLOR.meet;
    // card
    doc.roundedRect(PAD, y, W - PAD * 2, CARD_H, 22).fillAndStroke('#ffffff', '#efe3d8');
    doc.roundedRect(PAD, y, 14, CARD_H, 7).fill(col);
    // time column
    const tl = timeLabel(e.time);
    doc.font('B').fontSize(tl ? 30 : 22).fillColor(tl ? '#3d2f27' : '#b8aa9c').text(tl || 'all day', PAD + 40, y + 34, { width: 160, lineBreak: false });
    doc.font('R').fontSize(18).fillColor(col).text(KIND_WORD[e.kind] || 'Event', PAD + 40, y + 78, { width: 160, lineBreak: false });
    // title (two lines max)
    const title = clean(e.full || e.title) || 'Event';
    doc.font('B').fontSize(28).fillColor('#3d2f27').text(title, PAD + 215, y + 30, { width: W - PAD * 2 - 215 - 250, height: 80, ellipsis: true, lineGap: 2 });
    // Read more button
    const bw = 200, bh = 58, bx = W - PAD - 30 - bw, by = y + (CARD_H - bh) / 2;
    doc.roundedRect(bx, by, bw, bh, 29).fill('#c4845f');
    doc.font('B').fontSize(22).fillColor('#ffffff').text('Read more  ›', bx, by + 16, { width: bw, align: 'center', lineBreak: false });
    doc.link(bx, by, bw, bh, url);
    doc.link(PAD, y, W - PAD * 2 - bw - 40, CARD_H, url);
    y += CARD_H + GAP;
  }

  // footer
  const fy = H - footH + 30;
  doc.moveTo(PAD, fy).lineTo(W - PAD, fy).lineWidth(2).stroke('#eddccd');
  try { doc.image(LADY, W - PAD - 150, fy + 14, { height: 170 }); } catch (e) {}
  doc.font('B').fontSize(30).fillColor('#6b4a36').text('Powered by chutznik.org', PAD, fy + 40, { lineBreak: false, link: site });
  doc.font('R').fontSize(21).fillColor('#6b5a4e').text('The full calendar, every rental, every job and every recommendation — in English, all in one place.', PAD, fy + 88, { width: W - PAD * 2 - 200 });
  doc.font('R').fontSize(19).fillColor('#a8816b').text('Tap any event to open it  ·  ' + site.replace(/^https?:\/\//, '') + '/calendar', PAD, fy + 150, { lineBreak: false, link: site + '/calendar' });
  doc.link(PAD, fy + 30, 520, 50, site);
  doc.end();
  return done;
}

async function makeTodaySheet(site) {
  const { today, events } = await fetchTodayEvents(site);
  if (!events.length) return { today, events, pdf: null };
  const pdf = await buildTodayPdf({ site, today, events });
  return { today, events, pdf };
}

module.exports = { makeTodaySheet, buildTodayPdf, fetchTodayEvents, israelToday };

if (require.main === module) {
  // node scripts/today-pdf.js [site] [out.pdf] — a local try-out
  const site = process.argv[2] || 'https://www.chutznik.org';
  makeTodaySheet(site).then(({ events, pdf }) => {
    console.log(events.length + ' event(s) today');
    if (pdf) { const out = process.argv[3] || '/tmp/today.pdf'; fs.writeFileSync(out, pdf); console.log('wrote ' + out + ' (' + pdf.length + ' bytes)'); }
  }).catch((e) => { console.error(e); process.exit(1); });
}
