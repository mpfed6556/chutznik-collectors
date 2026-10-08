// ── Every business on Chutznik, with the number its advert came from (Miriam, 8 Oct 2026:
//    "add to the business listing the number or email that the ad came from and organize it more").
//    The site knows the business and its printed contact; only the bridge remembers which WhatsApp
//    number sent each advert (its posted.json, the last thirty days) — so the list is built here
//    and goes to Miriam as a spreadsheet on WhatsApp and as a table by email.
'use strict';

const BIZ = 'Company / Organization / Store / Group';
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const emailsIn = (t) => Array.from(new Set((String(t).match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).map((e) => e.replace(/[.,]+$/, ''))));
const phonesIn = (t) => Array.from(new Set((String(t).match(/(?:\+972[-\s]?|0)(?:[23489]|5\d|7\d)[-\s.]?\d{3}[-\s.]?\d{3,4}|\*\d{4}/g) || []).map((x) => x.trim())));
const linksIn = (t) => Array.from(new Set((String(t).match(/https?:\/\/[^\s)\]"']+/g) || []).filter((l) => !/chutznik\.org/.test(l))));
const norm = (x) => String(x || '').replace(/\D/g, '').replace(/^972/, '0');
const dedupePhones = (list) => { const seen = new Set(); return list.filter((x) => { const n = norm(x); if (!n || seen.has(n)) return false; seen.add(n); return true; }); };
const pretty = (digits) => { const d = String(digits || '').replace(/\D/g, ''); if (!d) return ''; if (d.startsWith('972')) return '0' + d.slice(3); return '+' + d; };
const nameOf = (p) => { if (String(p.id).startsWith('biz_')) return p.author || strip(p.title); const t = strip(p.title); const m = t.split(/\s[—–-]\s|:\s/)[0]; return m.length >= 3 ? m : t; };
const sourceOf = (p) => { const id = String(p.id); if (id.startsWith('biz_')) return 'Business page'; if (id.startsWith('mag_')) return 'Magazine ad'; if (id.startsWith('cvc_')) return "Chaim V'Chesed"; if (id.startsWith('em_')) return 'Email'; return 'WhatsApp group'; };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const csvq = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

async function getJson(url, headers) { try { const r = await fetch(url, { headers: headers || {}, signal: AbortSignal.timeout(60000) }); return r.ok ? await r.json() : null; } catch (e) { return null; } }

async function build({ SITE, KEY, posted, log }) {
  const H = { 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' };
  const ups = (await getJson(SITE + '/api/live-data?type=updates&queue=1&t=' + Date.now(), H)) || [];
  const posts = (await getJson(SITE + '/api/live-data?type=posts&t=' + Date.now(), H)) || [];
  const members = (await getJson(SITE + '/api/live-data?type=members&withMentioned=1&t=' + Date.now(), H)) || [];
  const memberByName = new Map(); for (const m of (Array.isArray(members) ? members : [])) { const n = String(m.name || '').trim().toLowerCase(); if (n && !memberByName.has(n)) memberByName.set(n, m); }
  const P = posted || {};
  const senderOf = (ids) => { for (const id of ids) { const e = P[id]; if (e && (e.jid || e.phone)) return { phone: pretty(e.phone || String(e.jid).split('@')[0]), name: e.name || '', chat: e.chat || '' }; } return null; };
  const rows = [];
  for (const p of (Array.isArray(ups) ? ups : [])) {
    if (!(p.types || []).includes(BIZ) || (p.status && p.status !== 'public')) continue;
    const text = strip(p.memo) + ' ' + (p.comments || []).map((c) => strip(c.content)).join(' ');
    const from = senderOf([String(p.id)].concat((p.mergedFrom || []).map(String)));
    rows.push({ section: sourceOf(p), name: nameOf(p), offer: strip(p.title), phone: dedupePhones([p.contactPhone || ''].concat(phonesIn(text))).filter(Boolean).join(' / '),
      from: from ? from.phone : '', fromName: from ? from.name : '', group: from && from.chat ? from.chat : (p.group || ''), email: emailsIn(text).join(' / '),
      site: [p.contactWebsite || ''].concat(linksIn(text)).filter(Boolean).join(' / '), area: p.area || '', link: SITE + '/israel/post/up_' + encodeURIComponent(String(p.id)), verified: p.verified ? 'yes' : '', id: String(p.id) });
  }
  for (const p of (Array.isArray(posts) ? posts : [])) {
    if (!(p.types || []).includes(BIZ) || p.deleted || p.status === 'hidden' || p._ad) continue;
    const text = strip(p.memo || p.content) + ' ' + (p.comments || []).map((c) => strip(c.content)).join(' ');
    const m = memberByName.get(String(p.author || '').trim().toLowerCase());
    rows.push({ section: 'Member post', name: nameOf(p), offer: strip(p.title), phone: dedupePhones([p.contact || ''].concat(phonesIn(text))).filter(Boolean).join(' / '),
      from: m && m.phone ? pretty(m.phone) : '', fromName: p.author || '', group: 'posted on Chutznik', email: [(m && m.email) || ''].concat(emailsIn((p.contact || '') + ' ' + text)).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' / '),
      site: [p.website || ''].concat(linksIn(text)).filter(Boolean).join(' / '), area: p.contactAddress || '', link: SITE + '/israel/post/' + encodeURIComponent(p.slug || String(p.id)), verified: p.verified ? 'yes' : '', id: String(p.id) });
  }
  const order = { 'Business page': 0, 'WhatsApp group': 1, 'Magazine ad': 2, 'Member post': 3, 'Email': 4, "Chaim V'Chesed": 5 };
  rows.sort((a, b) => ((order[a.section] ?? 9) - (order[b.section] ?? 9)) || (a.group || '').localeCompare(b.group || '') || a.name.localeCompare(b.name));
  if (log) log('📇 business list: ' + rows.length + ' rows, ' + rows.filter((r) => r.from).length + ' with the sender\'s number, ' + rows.filter((r) => r.email).length + ' with an email');
  return rows;
}

const COLS = [['section', 'Where from'], ['name', 'Business'], ['offer', 'What they offer'], ['phone', 'Phone / WhatsApp (printed)'], ['from', 'Sent from (number)'], ['fromName', 'Sender name'], ['group', 'Group'], ['email', 'Email'], ['site', 'Website'], ['area', 'Area'], ['link', 'Open on Chutznik'], ['verified', 'Verified'], ['id', 'Post id']];
function toCsv(rows) { return '﻿' + COLS.map((c) => csvq(c[1])).join(',') + '\n' + rows.map((r) => COLS.map((c) => csvq(r[c[0]])).join(',')).join('\n'); }
function toHtml(rows) {
  let h = '<div style="font-family:Arial,sans-serif;font-size:13px;color:#3a2920"><p>' + rows.length + ' businesses on Chutznik — ' + rows.filter((r) => r.from).length + ' with the WhatsApp number the advert came from (the bridge remembers the last thirty days), ' + rows.filter((r) => r.email).length + ' with an email. The spreadsheet is on your WhatsApp.</p>';
  let sec = '';
  for (const r of rows) {
    if (r.section !== sec) { if (sec) h += '</table>'; sec = r.section; h += '<h3 style="margin:18px 0 6px;color:#6b2a0c">' + esc(sec) + '</h3><table style="border-collapse:collapse;width:100%"><tr>' + ['Business', 'What they offer', 'Printed contact', 'Sent from', 'Group', 'Email / site', ''].map((x) => '<th style="text-align:left;border-bottom:2px solid #e3d9cd;padding:4px 6px;font-size:12px">' + x + '</th>').join('') + '</tr>'; }
    h += '<tr>' + [r.name, r.offer, r.phone, (r.from ? r.from + (r.fromName ? ' (' + r.fromName + ')' : '') : ''), r.group, [r.email, r.site].filter(Boolean).join(' · ')].map((x) => '<td style="border-bottom:1px solid #f1ece3;padding:4px 6px;vertical-align:top">' + esc(x) + '</td>').join('') + '<td style="border-bottom:1px solid #f1ece3;padding:4px 6px"><a href="' + esc(r.link) + '" style="color:#9a6547">open</a></td></tr>';
  }
  return h + (sec ? '</table>' : '') + '</div>';
}

// to: WhatsApp numbers (digits) for the spreadsheet; emailTo: addresses for the table
async function run({ SITE, KEY, log, posted, to, emailTo, sock }) {
  const rows = await build({ SITE, KEY, posted, log });
  if (!rows.length) return 'business list: nothing to send';
  const csv = Buffer.from(toCsv(rows), 'utf8');
  let sent = 0;
  for (const num of (to || [])) {
    if (!sock) break;
    try { await sock.sendMessage(num + '@s.whatsapp.net', { document: csv, mimetype: 'text/csv', fileName: 'Chutznik-businesses.csv', caption: '📇 Every business on Chutznik (' + rows.length + '): name, what they offer, printed contact, the number the advert came from, group, email, link. Opens in Excel or Google Sheets.' }); sent++; }
    catch (e) { if (log) log('📇 WhatsApp to ' + num + ' failed: ' + (e && e.message)); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  let mailed = 0;
  if (emailTo && emailTo.length) {
    try {
      const r = await fetch(SITE + '/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' },
        body: JSON.stringify({ type: 'custom', to: emailTo, subject: 'Businesses on Chutznik — ' + rows.length + ' with contacts and where each advert came from', body: rows.map((r) => [r.section, r.name, r.phone, r.from, r.email, r.link].filter(Boolean).join(' | ')).join('\n'), html: toHtml(rows) }) });
      if (r.ok) mailed = emailTo.length; else if (log) log('📇 email: HTTP ' + r.status);
    } catch (e) { if (log) log('📇 email: ' + (e && e.message)); }
  }
  return 'business list: ' + rows.length + ' rows → ' + sent + ' WhatsApp, ' + mailed + ' email';
}
module.exports = { run, build, toCsv, toHtml };
