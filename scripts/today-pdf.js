// ── "Happening Now in Jerusalem" — a clickable one-page PDF of the day's events ──
// Built from the same calendar logic as chutznik.org/calendar (events-lib.js), and
// laid out to match the Chutznik daily template: watercolour Jerusalem background,
// the logo and date up top, then one card per event. Every card links to its post,
// so the sheet can go out on a WhatsApp status and people can tap through.
'use strict';
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const L = require('./events-lib.js');

const F = (n) => path.join(__dirname, '..', 'fonts', n);
const FONTS = { B: F('PlayfairDisplay-Bold.ttf'), P: F('PlayfairDisplay-Regular.ttf'), R: F('Lora-Regular.ttf'), RB: F('Lora-Bold.ttf'), H: F('FrankRuhlLibre-Bold.ttf'), U: F('DejaVuSans.ttf') };
const LOGO = F('logo.png');
const BG_BASE = F('bg-base.png'), BG_TOP = F('bg-top.png'), BG_BOT = F('bg-bot.png');

// ── the page, in the template's own pixels ──────────────────────────────────
const W = 1054;                 // page width
const PAD = 44;                 // card left edge
const CARD_R = 1010;            // card right edge
const CARD_H = 124, GAP = 15;   // card box and the space between cards
const FIRST_Y = 550;            // top of the first card
const BOT_ART = 255;            // the skyline strip along the bottom
const TAIL = 265;               // space kept under the last card

const INK = { word: '#4a1410', org: '#7a4a2c', title: '#8c3f12', date: '#1c1008', heb: '#7c3312', rule: '#dcbb96', time: '#171717', card: '#14161b', divider: '#dcb28e' };

// bar / pastel circle / glyph, per kind of event — the calendar's own colours
const KIND = {
  tour:   { bar: '#0a64fb', pale: '#d4e5fe', ink: '#1266fb', icon: 'pin' },
  place:  { bar: '#0a64fb', pale: '#d4e5fe', ink: '#1266fb', icon: 'pin' },
  health: { bar: '#26905b', pale: '#d6f8d7', ink: '#2f9e5e', icon: 'health' },
  food:   { bar: '#fe6904', pale: '#ffe6d0', ink: '#f97316', icon: 'food' },
  show:   { bar: '#6d45dc', pale: '#e7ddfd', ink: '#7c4ddb', icon: 'masks' },
  sale:   { bar: '#e0648a', pale: '#fbdde6', ink: '#d9527c', icon: 'tag' },
  kids:   { bar: '#f59e0b', pale: '#fdeecb', ink: '#e08c06', icon: 'baby' },
  class:  { bar: '#0ea5e9', pale: '#d3eefb', ink: '#0d96d4', icon: 'cap' },
  torah:  { bar: '#a8816b', pale: '#eee1d8', ink: '#96705a', icon: 'book' },
  chesed: { bar: '#ef4444', pale: '#fcdcdc', ink: '#e03b3b', icon: 'hands' },
  meet:   { bar: '#c4845f', pale: '#f5e2d6', ink: '#b3714c', icon: 'users' },
};

// Lucide icon outlines (24×24), drawn as strokes so they stay crisp at any size
const ICONS = {
  pin:    ['M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0', 'C12 10 3'],
  food:   ['M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2', 'M7 2v20', 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7'],
  masks:  ['M10 11h.01', 'M14 6h.01', 'M18 6h.01', 'M6.5 13.1h.01', 'M22 5c0 9-4 12-6 12s-6-3-6-12c0-2 2-3 6-3s6 1 6 3', 'M17.4 9.9c-.8.8-2 .8-2.8 0', 'M10.1 7.1C9 7.2 7.7 7.7 6 8.6c-3.5 2-4.7 3.9-3.7 5.6 4.5 7.8 9.5 8.4 11.2 7.4.9-.5 1.9-2.1 1.9-4.7', 'M9.1 16.5c.3-1.1 1.4-1.7 2.4-1.4'],
  cap:    ['M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z', 'M22 10v6', 'M6 12.5V16a6 3 0 0 0 12 0v-3.5'],
  book:   ['M12 5v16', 'M20.001 19A2 2 0 0022 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z'],
  tag:    ['M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z', 'C7.5 7.5 1.1'],
  baby:   ['M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5', 'M15 12h.01', 'M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1', 'M9 12h.01'],
  hands:  ['M19.414 14.414C21 12.828 22 11.5 22 9.5a5.5 5.5 0 0 0-9.591-3.676.6.6 0 0 1-.818.001A5.5 5.5 0 0 0 2 9.5c0 2.3 1.5 4 3 5.5l5.535 5.362a2 2 0 0 0 2.879.052 2.12 2.12 0 0 0-.004-3 2.124 2.124 0 1 0 3-3 2.124 2.124 0 0 0 3.004 0 2 2 0 0 0 0-2.828l-1.881-1.882a2.41 2.41 0 0 0-3.409 0l-1.71 1.71a2 2 0 0 1-2.828 0 2 2 0 0 1 0-2.828l2.823-2.762'],
  users:  ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M16 3.128a4 4 0 0 1 0 7.744', 'M22 21v-2a4 4 0 0 0-3-3.87', 'C9 7 4'],
  health: ['M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5', 'M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27'],
  sun:    ['C12 12 4', 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
};
// draw one icon centred on (cx, cy), `size` wide, in `color`
function icon(doc, name, cx, cy, size, color, weight) {
  const parts = ICONS[name] || ICONS.pin; const s = size / 24;
  doc.save().translate(cx - size / 2, cy - size / 2).scale(s)
     .lineWidth((weight || 2) / s)          // scale() also scales the pen, so undo it
     .strokeColor(color).lineJoin('round').lineCap('round');
  for (const p of parts) {
    if (p[0] === 'C') { const [x, y, r] = p.slice(1).trim().split(/\s+/).map(Number); doc.circle(x, y, r).stroke(); }
    else doc.path(p).stroke();
  }
  doc.restore();
}

// ── dates ───────────────────────────────────────────────────────────────────
function israelToday() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return new Date(g('year'), g('month') - 1, g('day'));
}
const HEB_MONTH = { tishri: 'תשרי', tishrei: 'תשרי', heshvan: 'חשון', cheshvan: 'חשון', marcheshvan: 'חשון', kislev: 'כסלו', tevet: 'טבת', teves: 'טבת', shevat: 'שבט', shvat: 'שבט', adar: 'אדר', 'adar i': 'אדר א׳', 'adar ii': 'אדר ב׳', nisan: 'ניסן', iyar: 'אייר', sivan: 'סיון', tamuz: 'תמוז', av: 'אב', elul: 'אלול' };
const GEM = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
function gematria(n) {
  let out = '';
  n = Number(n) || 0;
  if (n === 15) return 'ט״ו';
  if (n === 16) return 'ט״ז';
  for (const [v, ch] of GEM) while (n >= v) { out += ch; n -= v; }
  if (out.length > 1) out = out.slice(0, -1) + '״' + out.slice(-1);
  else if (out.length === 1) out += '׳';
  return out;
}
// "כ״ז אלול תשפ״ו" — built in visual (right-to-left) order, since PDF text is laid out left-to-right
function hebrewDate(d) {
  try {
    const ps = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(d);
    const g = (t) => (ps.find((x) => x.type === t) || {}).value || '';
    const mon = HEB_MONTH[String(g('month')).toLowerCase().replace(/\s+/g, ' ').trim()] || '';
    const day = gematria(Number(g('day')));
    const yr = gematria(Number(g('year')) % 1000);
    if (!mon || !day) return [];
    return [day, mon, yr];
  } catch (e) { return []; }
}
// Hebrew, right to left: pdfkit gets each word the right way round on its own, but
// loses the spaces between them -- so we place the words ourselves, from the right.
function hebrewLine(doc, words, rightX, y, size, color) {
  if (!words || !words.length) return;
  doc.font('H').fontSize(size).fillColor(color);
  const sp = doc.widthOfString(' ') * 1.6;
  let x = rightX;
  for (const w of words) { const wd = doc.widthOfString(w); x -= wd; doc.text(w, x, y, { lineBreak: false }); x -= sp; }
}
function clean(s) { return String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/₪/g, 'NIS ').replace(/\s+/g, ' ').trim(); }
const hasHebrew = (s) => /[֐-׿]/.test(String(s || ''));
function timeLabel(t) {
  if (!t) return 'all day';
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

// ── the sheet itself → Buffer ───────────────────────────────────────────────
function buildTodayPdf({ site, today, events }) {
  const H = Math.max(1180, FIRST_Y + events.length * (CARD_H + GAP) - GAP + TAIL);
  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: 'Happening Now in Jerusalem — Chutznik', Author: 'Chutznik' } });
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  for (const k of Object.keys(FONTS)) { try { doc.registerFont(k, FONTS[k]); } catch (e) {} }
  const font = (k, s) => doc.font(hasHebrew(s) ? 'U' : k);

  // paper: the warm field, the Old City up in the corner, the skyline along the foot
  doc.rect(0, 0, W, H).fill('#fdf6ea');
  try { doc.image(BG_BASE, 0, 0, { width: W, height: H }); } catch (e) {}
  try { doc.image(BG_TOP, W - 414, 0, { width: 414 }); } catch (e) {}
  try { doc.image(BG_BOT, 0, H - BOT_ART, { width: W }); } catch (e) {}

  // header — logo, wordmark, the day
  try { doc.image(LOGO, 58, 34, { width: 106, height: 106 }); } catch (e) {}
  doc.font('B').fontSize(63).fillColor(INK.word).text('Chutznik', 194, 50, { lineBreak: false });
  doc.font('R').fontSize(26).fillColor(INK.org).text('chutznik.org', 199, 119, { lineBreak: false, link: site });

  doc.font('B').fontSize(75).fillColor(INK.title)
     .text('Happening Now', 48, 172, { lineBreak: false })
     .text('in Jerusalem', 48, 258, { lineBreak: false });

  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  doc.font('B').fontSize(43).fillColor(INK.date).text(dayName + ', ' + dateStr, 50, 362, { lineBreak: false });
  hebrewLine(doc, hebrewDate(today), 340, 418, 31, INK.heb);

  // "Click an event to learn more", with a little sun and a rule running to the edge
  const capY = 486;
  icon(doc, 'sun', 62, capY + 18, 34, '#f0a437', 2.4);
  const cap = 'Click an event to learn more';
  doc.font('B').fontSize(40).fillColor(INK.title).text(cap, 96, capY, { lineBreak: false });
  const capW = doc.widthOfString(cap);
  doc.moveTo(96 + capW + 26, capY + 20).lineTo(CARD_R, capY + 20).lineWidth(2).stroke(INK.rule);

  // one card per event
  let y = FIRST_Y;
  for (const e of events) {
    const url = site + '/post/' + encodeURIComponent(String(e.id));
    const k = KIND[e.kind] || KIND.meet;
    doc.save().opacity(0.94).roundedRect(PAD, y, CARD_R - PAD, CARD_H, 18).fill('#ffffff').restore();
    doc.roundedRect(PAD, y, 11, CARD_H, 5).fill(k.bar);

    // pastel circle + glyph
    doc.circle(120, y + CARD_H / 2, 31).fill(k.pale);
    icon(doc, k.icon, 120, y + CARD_H / 2, 34, k.ink, 2.1);

    // the time, centred in its own column, then a hairline, then the title
    const tl = timeLabel(e.time);
    doc.font('B').fontSize(tl === 'all day' ? 32 : 36).fillColor(INK.time)
       .text(tl, 176, y + CARD_H / 2 - (tl === 'all day' ? 21 : 24), { width: 168, align: 'center', lineBreak: false });
    doc.moveTo(353, y + 32).lineTo(353, y + CARD_H - 32).lineWidth(1.6).stroke(INK.divider);

    const title = clean(e.full || e.title) || 'Event';
    const tw = 990 - 398;
    font('R', title).fontSize(29);
    const th = Math.min(doc.heightOfString(title, { width: tw, lineGap: 4 }), 84);
    doc.fillColor(INK.card).text(title, 398, y + (CARD_H - th) / 2 - 2, { width: tw, height: 84, ellipsis: true, lineGap: 4 });

    doc.link(PAD, y, CARD_R - PAD, CARD_H, url);
    y += CARD_H + GAP;
  }

  doc.end();
  return done;
}

async function makeTodaySheet(site) {
  const { today, events } = await fetchTodayEvents(site);
  if (!events.length) return { today, events, pdf: null };
  const pdf = await buildTodayPdf({ site, today, events });
  return { today, events, pdf };
}

module.exports = { makeTodaySheet, buildTodayPdf, fetchTodayEvents, israelToday, hebrewDate };

if (require.main === module) {
  // node scripts/today-pdf.js [site] [out.pdf] — a local try-out
  const site = process.argv[2] || 'https://chutznik.org';
  makeTodaySheet(site).then(({ events, pdf }) => {
    console.log(events.length + ' event(s) today');
    if (pdf) { const out = process.argv[3] || '/tmp/today.pdf'; fs.writeFileSync(out, pdf); console.log('wrote ' + out + ' (' + pdf.length + ' bytes)'); }
  }).catch((e) => { console.error(e); process.exit(1); });
}
