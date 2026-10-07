// ── "Chutznik is 3 months old" — the milestones sheet as a clickable PDF ──
// The same stationery as the TODAY and RENTALS sheets: watercolour Jerusalem
// background, the title up top, one card per listing, the skyline at the foot.
// Shaitel machers, then the newest rentals, then the newest jobs (Miriam, 7 Oct 2026:
// "the same exact template as the calendar PDF I get each day").
'use strict';
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const T = require('./today-pdf.js');
const M = require('./milestones.js');

const F = (n) => path.join(__dirname, '..', 'fonts', n);
const FONTS = { B: F('PlayfairDisplay-Bold.ttf'), P: F('PlayfairDisplay-Regular.ttf'), R: F('Lora-Regular.ttf'), RB: F('Lora-Bold.ttf'), H: F('FrankRuhlLibre-Bold.ttf'), U: F('DejaVuSans.ttf') };
const BG_BASE = F('bg2-base.png'), BG_TL = F('bg2-tl.png'), BG_TR = F('bg2-tr.png'), BG_BOT = F('bg2-bot.png');
const W = 1024, PAD = 56, CARD_R = 968, CARD_H = 112, GAP = 12, FIRST_Y = 589, BOT_ART = 291, TAIL = 300, SECTION_H = 64;
const INK = { title: '#6b2a0c', title2: '#a3541a', date: '#16100b', heb: '#5a2410', rule: '#d9b48c', pill: '#7a2c0c', sun: '#eba43c', card: '#14161b', sub: '#6d5a4e', divider: '#e2a179', chev: '#c07a4a' };
const KIND = { wig: { bar: '#e0648a', pale: '#fbdde6' }, rent: { bar: '#c4845f', pale: '#f5e2d6' }, job: { bar: '#0ea5e9', pale: '#d3eefb' } };
const hasHebrew = (s) => /[֐-׿]/.test(String(s || ''));
function chevron(doc, cx, cy, size, color, weight) {
  const s = size / 24;
  doc.save().translate(cx - size / 2, cy - size / 2).scale(s).lineWidth(weight / s).lineCap('round').lineJoin('round').strokeColor(color);
  doc.path('m9 18 6-6-6-6').stroke(); doc.restore();
}
function hebrewLine(doc, words, rightX, y, size, color) {
  if (!words || !words.length) return;
  doc.font('H').fontSize(size).fillColor(color);
  const sp = doc.widthOfString(' ') * 1.6; let x = rightX;
  for (const w of words) { const wd = doc.widthOfString(w); x -= wd; doc.text(w, x, y, { lineBreak: false }); x -= sp; }
}
const linkOf = (site, x) => site + '/post/' + (x.slug || (String(x.id).startsWith('up_') || !/^(wa_|mag_|ext_|ev_|biz_)/.test(String(x.id)) ? String(x.id) : 'up_' + String(x.id)));

function buildMilestonesPdf({ site, today, st }) {
  const { wigs, rentals, jobs } = M.sheetLists(st);
  const rows = wigs.length + rentals.length + jobs.length;
  const nSec = (wigs.length ? 1 : 0) + (rentals.length ? 1 : 0) + (jobs.length ? 1 : 0);
  const H = Math.max(1180, FIRST_Y + rows * (CARD_H + GAP) + nSec * (SECTION_H + 6 + GAP) - GAP + TAIL);
  const doc = new PDFDocument({ size: [W, H], margin: 0, font: FONTS.R, info: { Title: 'Chutznik is 3 months old', Author: 'Chutznik' } });
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

  doc.font('B').fontSize(74).fillColor(INK.title).text('Chutznik is', 75, 150, { lineBreak: false });
  doc.font('B').fontSize(74).fillColor(INK.title2).text('3 months old!', 75, 240, { lineBreak: false });
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  doc.font('B').fontSize(43).fillColor(INK.date).text(dateStr, 86, 347, { lineBreak: false });
  hebrewLine(doc, T.hebrewDate(today), 358, 404, 30, INK.heb);
  const dy = 466;
  doc.lineWidth(1.6).strokeColor(INK.rule).moveTo(438, dy).lineTo(492, dy).stroke().moveTo(534, dy).lineTo(730, dy).stroke();
  doc.save().translate(513, dy).lineWidth(1.7).strokeColor('#7d8c5a');
  doc.moveTo(-2, 10).lineTo(2, -14).stroke();
  doc.ellipse(-9, -4, 9, 5.5).fillAndStroke('#9db06f', '#7d8c5a');
  doc.ellipse(9, -11, 9, 5.5).fillAndStroke('#9db06f', '#7d8c5a');
  doc.restore();
  const cap = 'Tap a listing to open it';
  doc.font('B').fontSize(36);
  const capW = doc.widthOfString(cap);
  const ph = 68, pw = capW + 158, px = Math.round(W / 2 - pw / 2), py = 500, pm = py + ph / 2;
  doc.save().opacity(0.62).roundedRect(px, py, pw, ph, ph / 2).fill('#fff6e9').restore();
  doc.save().opacity(0.5).roundedRect(px, py, pw, ph, ph / 2).lineWidth(1.4).stroke('#eed9bd').restore();
  // the sun, as on the TODAY sheet
  doc.save().lineWidth(2.8).strokeColor(INK.sun).circle(px + 52, pm, 7).stroke();
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; doc.moveTo(px + 52 + Math.cos(a) * 12, pm + Math.sin(a) * 12).lineTo(px + 52 + Math.cos(a) * 17, pm + Math.sin(a) * 17).stroke(); }
  doc.restore();
  doc.font('B').fontSize(36).fillColor(INK.pill).text(cap, px + 92, py + 15, { lineBreak: false });
  chevron(doc, px + 92 + capW + 26, pm, 19, INK.pill, 3);

  let y = FIRST_Y;
  const heading = (label) => { y += 6; doc.font('B').fontSize(28).fillColor(INK.title2).text(label, PAD + 6, y + 14, { lineBreak: false }); const lw = doc.widthOfString(label); doc.lineWidth(1.4).strokeColor(INK.rule).moveTo(PAD + 6 + lw + 18, y + 30).lineTo(CARD_R, y + 30).stroke(); y += SECTION_H; };
  const card = (p, k, badge, sub) => {
    const url = linkOf(site, p); const mid = y + CARD_H / 2;
    doc.save().opacity(0.96).roundedRect(PAD, y, CARD_R - PAD, CARD_H, 22).fill('#ffffff').restore();
    doc.roundedRect(PAD, y, 16, CARD_H, 8).fill(k.bar);
    doc.circle(141, mid, 42).fill(k.pale);
    const big = badge.length <= 2;
    doc.font(big ? 'U' : 'B').fontSize(big ? 34 : (badge.length > 6 ? 17 : 21)).fillColor(k.bar).text(badge, 99, mid - (big ? 20 : (badge.length > 6 ? 10 : 13)), { width: 84, align: 'center', lineBreak: false });
    doc.moveTo(214, y + 28).lineTo(214, y + CARD_H - 28).lineWidth(2).stroke(INK.divider);
    const title = M.clean(p.title).replace(/^wanted:\s*/i, '') || 'Post';
    const tw = 901 - 245;
    font('RB', title).fontSize(27).fillColor(INK.card).text(title, 245, y + 20, { width: tw, height: 34, ellipsis: true, lineBreak: false });
    font('R', sub).fontSize(20).fillColor(INK.sub).text(sub, 245, y + 62, { width: tw, height: 26, ellipsis: true, lineBreak: false });
    chevron(doc, 934, mid, 20, INK.chev, 2.6);
    doc.link(PAD, y, CARD_R - PAD, CARD_H, url);
    y += CARD_H + GAP;
  };
  if (wigs.length) { heading('Shaitel machers'); for (const p of wigs) card(p, KIND.wig, '✂', M.wigSub(p)); }
  if (rentals.length) { heading('Latest rentals'); for (const p of rentals) card(p, KIND.rent, M.bedsOf(p) || 'Rental', M.rentSub(p)); }
  if (jobs.length) { heading('Latest jobs'); for (const p of jobs) card(p, KIND.job, 'Job', M.jobSub(p)); }
  doc.end();
  return done;
}
async function makeMilestonesSheet(site, key) {
  const st = await M.gather(site, key);
  const pdf = await buildMilestonesPdf({ site, today: T.israelToday(), st });
  return { st, pdf };
}
module.exports = { buildMilestonesPdf, makeMilestonesSheet };
