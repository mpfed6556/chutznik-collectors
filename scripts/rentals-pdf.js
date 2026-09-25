// ── "Rentals Today in Jerusalem" — a clickable one-page PDF of the day's rental listings ──
// The same stationery as the TODAY sheet (today-pdf.js): watercolour Jerusalem
// background, the logo and date up top, one card per listing, the skyline along
// the foot. Every card links straight to its post. Offers first, then the
// "Wanted" requests under their own small heading. (Miriam, 20 Sep 2026)
'use strict';
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const T = require('./today-pdf.js');

const F = (n) => path.join(__dirname, '..', 'fonts', n);
const FONTS = { B: F('PlayfairDisplay-Bold.ttf'), P: F('PlayfairDisplay-Regular.ttf'), R: F('Lora-Regular.ttf'), RB: F('Lora-Bold.ttf'), H: F('FrankRuhlLibre-Bold.ttf'), U: F('DejaVuSans.ttf') };
const BG_BASE = F('bg2-base.png'), BG_TL = F('bg2-tl.png'), BG_TR = F('bg2-tr.png'), BG_BOT = F('bg2-bot.png');

const W = 1024, PAD = 56, CARD_R = 968, CARD_H = 112, GAP = 12, FIRST_Y = 589, BOT_ART = 291, TAIL = 300, SECTION_H = 64;
const INK = { title: '#6b2a0c', title2: '#a3541a', date: '#16100b', heb: '#5a2410', rule: '#d9b48c', pill: '#7a2c0c', key: '#eba43c',
              card: '#14161b', sub: '#6d5a4e', divider: '#e2a179', chev: '#c07a4a', offer: '#c4845f', offerPale: '#f5e2d6', wanted: '#0a64fb', wantedPale: '#d4e5fe' };

const hasHebrew = (s) => /[֐-׿]/.test(String(s || ''));
const clean = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
function chevron(doc, cx, cy, size, color, weight) {
  const s = size / 24;
  doc.save().translate(cx - size / 2, cy - size / 2).scale(s).lineWidth(weight / s).lineCap('round').lineJoin('round').strokeColor(color);
  doc.path('m9 18 6-6-6-6').stroke(); doc.restore();
}
function hebrewLine(doc, words, rightX, y, size, color) {   // the Hebrew date, word by word from the right (as the TODAY sheet does)
  if (!words || !words.length) return;
  doc.font('H').fontSize(size).fillColor(color);
  const sp = doc.widthOfString(' ') * 1.6;
  let x = rightX;
  for (const w of words) { const wd = doc.widthOfString(w); x -= wd; doc.text(w, x, y, { lineBreak: false }); x -= sp; }
}
// a key, drawn as strokes (Lucide "key-round")
function keyIcon(doc, cx, cy, size, color, weight) {
  const s = size / 24;
  doc.save().translate(cx - size / 2, cy - size / 2).scale(s).lineWidth(weight / s).lineCap('round').lineJoin('round').strokeColor(color);
  doc.path('M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z').stroke();
  doc.circle(16.5, 7.5, 0.9).fill(color); doc.restore();
}

// ── the listings: every rental that went public in the last day ─────────────
const isRental = (p) => (p.types || []).some((t) => /^rental$/i.test(String(t)));
const isWanted = (p) => /^wanted\b/i.test(String(p.title || ''));
function priceLabel(p) {
  const n = parseInt(String(p.price || '').replace(/[^\d]/g, ''), 10);
  if (!n) return '';
  return 'NIS ' + n.toLocaleString('en-US') + (p.priceMode === 'night' ? ' / night' : ' / month');
}
function bedsLabel(p) {
  if (p.beds === 0 || p.beds === '0') return 'Studio';
  const b = parseInt(p.beds, 10); return b > 0 ? b + ' bdrm' : '';
}
function whereLabel(p) {
  const c = Array.isArray(p.communities) ? p.communities.filter(Boolean) : [];
  return clean(c[0] || p.area || '');
}
function subLine(p) {
  const bits = [whereLabel(p), p.term === 'short' ? 'short term' : (p.term === 'long' ? 'long term' : ''), priceLabel(p), p.size ? p.size + ' m²' : '', clean(p.contactPhone || '')].filter(Boolean);
  return bits.join('  ·  ');
}
function pickRentals(updates, posts, since) {
  const ext = (updates || []).filter((p) => p && (!p.status || p.status === 'public') && isRental(p) && (p.created || 0) >= since)
    .map((p) => ({ ...p, _url: '/post/up_' + encodeURIComponent(String(p.id)) }));
  const mem = (posts || []).filter((p) => p && isRental(p) && (p.created || 0) >= since && !p._pending)
    .map((p) => ({ ...p, _url: '/post/' + encodeURIComponent(String(p.slug || p.id)) }));
  const all = ext.concat(mem).filter((p) => p.created <= Date.now() + 60000);
  const offers = all.filter((p) => !isWanted(p)).sort((a, b) => whereLabel(a).localeCompare(whereLabel(b)) || b.created - a.created);
  const wanted = all.filter(isWanted).sort((a, b) => b.created - a.created);
  return { offers, wanted };
}
async function fetchTodayRentals(site) {
  const since = Date.now() - 24 * 3600 * 1000;
  const get = async (q) => { try { const r = await fetch(site + '/api/live-data?type=' + q + '&t=' + Date.now()); return r.ok ? await r.json() : []; } catch (e) { return []; } };
  const [updates, posts] = await Promise.all([get('updates'), get('posts')]);
  return { today: T.israelToday(), ...pickRentals(Array.isArray(updates) ? updates : [], Array.isArray(posts) ? posts : [], since) };
}

// ── the page ────────────────────────────────────────────────────────────────
function buildRentalsPdf({ site, today, offers, wanted }) {
  const rows = offers.length + wanted.length;
  const nSec = (offers.some((p) => p.term === 'short') ? 1 : 0) + (offers.some((p) => p.term !== 'short') ? 1 : 0) + (wanted.length ? 1 : 0);
  const H = Math.max(1180, FIRST_Y + rows * (CARD_H + GAP) + nSec * (SECTION_H + 6 + GAP) - GAP + TAIL);
  const doc = new PDFDocument({ size: [W, H], margin: 0, font: FONTS.R, info: { Title: 'Rentals Today in Jerusalem — Chutznik', Author: 'Chutznik' } });
  doc.on('error', (e) => { try { console.error('pdf: ' + (e && e.message)); } catch (x) {} });
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  for (const k of Object.keys(FONTS)) { try { doc.registerFont(k, FONTS[k]); } catch (e) {} }
  const font = (k, s) => doc.font(hasHebrew(s) ? 'U' : k);

  doc.rect(0, 0, W, H).fill('#fdf6ea');
  try { doc.image(BG_BASE, 0, 0, { width: W, height: H }); } catch (e) {}
  try { doc.image(BG_TL, 0, 0, { width: 470 }); } catch (e) {}
  try { doc.image(BG_TR, W - 404, 0, { width: 404 }); } catch (e) {}
  try { doc.image(BG_BOT, 0, H - BOT_ART, { width: W }); } catch (e) {}
  doc.link(392, H - 74, 240, 50, site + '/israel');

  doc.font('B').fontSize(74).fillColor(INK.title).text('Rentals Today', 75, 150, { lineBreak: false });
  doc.font('B').fontSize(74).fillColor(INK.title).text('in ', 75, 240, { lineBreak: false });
  const inW = doc.widthOfString('in ');
  doc.font('B').fontSize(74).fillColor(INK.title2).text('Jerusalem', 75 + inW, 240, { lineBreak: false });
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  doc.font('B').fontSize(43).fillColor(INK.date).text(dayName + ', ' + dateStr, 86, 347, { lineBreak: false });
  hebrewLine(doc, T.hebrewDate(today), 358, 404, 30, INK.heb);

  const dy = 466;
  doc.lineWidth(1.6).strokeColor(INK.rule).moveTo(438, dy).lineTo(492, dy).stroke().moveTo(534, dy).lineTo(730, dy).stroke();
  doc.save().translate(513, dy).lineWidth(1.7).strokeColor('#7d8c5a');
  doc.moveTo(-2, 10).lineTo(2, -14).stroke();
  doc.ellipse(-9, -4, 9, 5.5).fillAndStroke('#9db06f', '#7d8c5a');
  doc.ellipse(9, -11, 9, 5.5).fillAndStroke('#9db06f', '#7d8c5a');
  doc.restore();

  const cap = rows ? 'Tap a listing to open it' : 'No new rentals today';
  doc.font('B').fontSize(36);
  const capW = doc.widthOfString(cap);
  const ph = 68, pw = capW + 158, px = Math.round(W / 2 - pw / 2), py = 500, pm = py + ph / 2;
  doc.save().opacity(0.62).roundedRect(px, py, pw, ph, ph / 2).fill('#fff6e9').restore();
  doc.save().opacity(0.5).roundedRect(px, py, pw, ph, ph / 2).lineWidth(1.4).stroke('#eed9bd').restore();
  keyIcon(doc, px + 52, pm, 38, INK.key, 2.6);
  doc.font('B').fontSize(36).fillColor(INK.pill).text(cap, px + 92, py + 15, { lineBreak: false });
  if (rows) chevron(doc, px + 92 + capW + 26, pm, 19, INK.pill, 3);

  let y = FIRST_Y;
  const card = (p, kind) => {
    const url = site + p._url;
    const mid = y + CARD_H / 2;
    const bar = kind === 'wanted' ? INK.wanted : INK.offer, pale = kind === 'wanted' ? INK.wantedPale : INK.offerPale;
    doc.save().opacity(0.96).roundedRect(PAD, y, CARD_R - PAD, CARD_H, 22).fill('#ffffff').restore();
    doc.roundedRect(PAD, y, 16, CARD_H, 8).fill(bar);
    // the beds pill
    const pill = bedsLabel(p) || (kind === 'wanted' ? 'Wanted' : 'Rental');
    doc.circle(141, mid, 42).fill(pale);
    doc.font('B').fontSize(pill.length > 6 ? 17 : 21).fillColor(bar).text(pill, 99, mid - (pill.length > 6 ? 10 : 13), { width: 84, align: 'center', lineBreak: false });
    doc.moveTo(214, y + 28).lineTo(214, y + CARD_H - 28).lineWidth(2).stroke(INK.divider);
    // title, then the facts
    const title = clean(p.title) || 'Rental';
    const tw = 901 - 245;
    font('RB', title).fontSize(27).fillColor(INK.card).text(title, 245, y + 20, { width: tw, height: 34, ellipsis: true, lineBreak: false });
    const sub = subLine(p);
    font('R', sub).fontSize(20).fillColor(INK.sub).text(sub, 245, y + 62, { width: tw, height: 26, ellipsis: true, lineBreak: false });
    chevron(doc, 934, mid, 20, INK.chev, 2.6);
    doc.link(PAD, y, CARD_R - PAD, CARD_H, url);
    y += CARD_H + GAP;
  };
  // the offers in two parts: short term, then long term (Miriam, 25 Sep 2026)
  const heading = (label) => { y += 6; doc.font('B').fontSize(28).fillColor(INK.title2).text(label, PAD + 6, y + 14, { lineBreak: false }); const lw = doc.widthOfString(label); doc.lineWidth(1.4).strokeColor(INK.rule).moveTo(PAD + 6 + lw + 24, y + 30).lineTo(CARD_R, y + 30).stroke(); y += SECTION_H; };
  const shortT = offers.filter((p) => p.term === 'short'), longT = offers.filter((p) => p.term !== 'short');
  if (shortT.length) { heading('Short term'); for (const p of shortT) card(p, 'offer'); }
  if (longT.length) { heading(shortT.length ? 'Long term' : 'Long term'); for (const p of longT) card(p, 'offer'); }
  if (wanted.length) {
    y += 6;
    doc.font('B').fontSize(28).fillColor(INK.title2).text('Looking for a place', PAD + 6, y + 14, { lineBreak: false });
    doc.lineWidth(1.4).strokeColor(INK.rule).moveTo(PAD + 300, y + 30).lineTo(CARD_R, y + 30).stroke();
    y += SECTION_H;
    for (const p of wanted) card(p, 'wanted');
  }
  doc.end();
  return done;
}

async function makeRentalsSheet(site) {
  const { today, offers, wanted } = await fetchTodayRentals(site);
  if (!offers.length && !wanted.length) return { today, offers, wanted, pdf: null };
  const pdf = await buildRentalsPdf({ site, today, offers, wanted });
  return { today, offers, wanted, pdf };
}

module.exports = { makeRentalsSheet, buildRentalsPdf, fetchTodayRentals, pickRentals };
