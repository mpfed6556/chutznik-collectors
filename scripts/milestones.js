// The "what Chutznik reached" email to every member (Miriam, 5 Oct 2026).
// Built from the site's own data: posts per day, rentals, business listings,
// the most-visited posts and the most-searched words — with picture buttons
// into the site. Sent by the bridge through the site's mailer, one member at
// a time, when bridge-settings.json carries a MILESTONES stamp it has not
// sent yet ({ "stamp": "...", "to": "preview" | "members" }).
'use strict';

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => Number(v || 0).toLocaleString('en-US');
const tsOf = (x) => { const c = x && (x.created || x.createdAt || x.ts) || 0; if (typeof c === 'number') return c; const t = Date.parse(String(c || '')); return isNaN(t) ? 0 : t; };
const dayOf = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const niceDay = (key) => new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'long', month: 'long', day: 'numeric' });

async function getJson(url, headers) {
  const r = await fetch(url, { headers: headers || {}, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url.replace(/\?.*/, ''));
  return r.json();
}

// the numbers, from the site
async function gather(SITE, KEY) {
  const H = { 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' };
  const t = '&t=' + Date.now();
  const [posts, updates, views, searches, members] = await Promise.all([
    getJson(SITE + '/api/live-data?type=posts' + t).catch(() => []),
    getJson(SITE + '/api/live-data?type=updates' + t).catch(() => []),
    getJson(SITE + '/api/live-data?type=views' + t).catch(() => ({})),
    getJson(SITE + '/api/live-data?type=searches' + t, H).catch(() => []),
    getJson(SITE + '/api/live-data?type=members&withMentioned=1' + t, H).catch(() => []),
  ]);
  const now = Date.now(), since = now - 92 * 86400000;
  const live = (Array.isArray(updates) ? updates : []).filter((u) => u && u.status === 'public' && tsOf(u) >= since && tsOf(u) <= now + 60000 && !/^wa_(BABYSIT|CLEANERS)$/.test(String(u.id)));
  const mine = (Array.isArray(posts) ? posts : []).filter((p) => p && !p.isExternal && tsOf(p) >= since);
  const all = live.concat(mine);
  const cat = (name) => all.filter((x) => (x.types || []).some((c) => String(c).toLowerCase().startsWith(name))).length;
  const days = {};
  for (const x of all) { const d = dayOf(tsOf(x)); days[d] = (days[d] || 0) + 1; }
  const dayKeys = Object.keys(days).sort();
  const busiest = dayKeys.sort((a, b) => days[b] - days[a])[0];
  const firstDay = Object.keys(days).sort()[0];
  const comments = (Array.isArray(posts) ? posts : []).concat(Array.isArray(updates) ? updates : []).reduce((s, x) => s + ((x && x.comments) || []).length, 0);
  const newMembers = (Array.isArray(members) ? members : []).filter((m) => m.joinedAt && tsOf({ created: m.joinedAt }) >= since).length;
  // the most-visited posts: the views file counts by post id (up_… for WhatsApp posts)
  const byId = new Map();
  for (const p of (Array.isArray(posts) ? posts : [])) byId.set(String(p.id), p);
  for (const u of (Array.isArray(updates) ? updates : [])) if (u && u.status === 'public') byId.set('up_' + String(u.id), u);
  const top = Object.entries(views && typeof views === 'object' ? views : {}).filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => ({ id: k, views: Number(v) || 0, post: byId.get(k) }))
    // a real post with a real title: not the site's own "new members" note, not a bare link
    .filter((x) => x.post && x.post.title && !/^\?$/.test(x.post.title) && !/\.(com|co\.il|net|org|me)\b|^https?:/i.test(x.post.title) && String(x.id) !== '900001').sort((a, b) => b.views - a.views).slice(0, 6);
  const visitDays = Object.entries(views || {}).filter(([k]) => k.startsWith('_day:')).map(([, v]) => Number(v) || 0);
  // the most-searched words (plural and singular folded together)
  const fold = (w) => String(w || '').trim().toLowerCase().replace(/s$/, '').replace(/^mikvot$/, 'mikva').replace(/^cleaning$/, 'cleaner');
  const terms = {}, spell = {};
  for (const s of (Array.isArray(searches) ? searches : [])) {
    if (!s || !s.term || (s.ts || 0) < since) continue; const raw = String(s.term).trim().toLowerCase(); const k = fold(raw); if (k.length < 3) continue;
    terms[k] = (terms[k] || 0) + 1; spell[k] = spell[k] || {}; spell[k][raw] = (spell[k][raw] || 0) + 1;
  }
  // shown the way most people typed it ("restaurants", not "restaurant")
  const topTerms = Object.entries(terms).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => Object.entries(spell[k]).sort((a, b) => b[1] - a[1])[0][0]);
  // the lists Miriam asked for (6 Oct 2026): the newest long-term rentals (at least ten,
  // reaching back past the last day only if the day has fewer), the newest jobs, and
  // every wig stylist / sheitel macher on the site
  const byTime = (a, b) => tsOf(b) - tsOf(a);
  const junkTitle = (u) => /^(?:https?:|www\.|wa\.me)/i.test(String(u.title || '')) || String(u.title || '').length < 6;
  const pubAll = (Array.isArray(updates) ? updates : []).filter((u) => u && u.status === 'public');
  const isLong = (u) => !/\bshort[- ]term\b/i.test(u.title || '') && (u.term === 'long' || (u.term !== 'short' && u.priceMode === 'month') || /\blong[- ]term\b/i.test(u.title || ''));
  const offers = pubAll.filter((u) => (u.types || []).includes('Rental') && !/^wanted/i.test(u.title || '') && isLong(u)).sort(byTime);
  let rentals = offers.filter((u) => !junkTitle(u) && now - tsOf(u) < 86400000); if (rentals.length < 10) rentals = offers.slice(0, 12);
  const jobs = pubAll.filter((u) => !junkTitle(u) && (u.types || []).includes('Jobs') && !/^wa_(BABYSIT|CLEANERS)$/.test(String(u.id)) && !/\bflying to\b|\bseeking (?:someone|a )|^(?:my name|i'?m |i am |we are a |we have |for rent|seeking|looking for|wanted)/i.test(u.title || '') && !/\bin the us\b|\busa\b|\bremote\b|\+1\d{10}|\$\s?\d/i.test((u.title || '') + ' ' + (u.memo || '').slice(0, 300))).sort(byTime).slice(0, 10);
  const wigRe = /sheitel|shaitel|sheitl|shaytel|\bwigs?\b/i, wigWork = /macher|stylist|salon|wash|\bset\b|cut|styl|repair|colou?r|wigs|hair/i;
  const wigs = pubAll.concat((Array.isArray(posts) ? posts : []).filter((p) => p && !p.isExternal))
    .filter((x) => { const t = (x.title || '') + ' ' + (x.memo || ''); return wigRe.test(t) && wigWork.test(t) && !/looking to hire|seeking .*salons|wanted:|for sale|pre-owned|selling|\bsale\b|giving away/i.test(x.title || ''); })
    .sort(byTime);
  const seenPhone = new Set(); const wigList = wigs.filter((x) => { const k = String(x.contactPhone || '').replace(/\D/g, '').slice(-9) || x.id; if (seenPhone.has(k)) return false; seenPhone.add(k); return true; });
  return {
    rentalList: rentals, jobList: jobs, wigList,
    total: all.length, external: live.length, mine: mine.length, dayCount: dayKeys.length,
    perDay: dayKeys.length ? Math.round(all.length / dayKeys.length) : 0, busiest, busiestN: busiest ? days[busiest] : 0, firstDay,
    rentals: cat('rental'), businesses: cat('company'), jobs: cat('jobs'), events: cat('events'), healthcare: cat('healthcare'), places: cat('place'),
    comments, members: (Array.isArray(members) ? members : []).filter((m) => !m.mentioned).length, newMembers, top, searches: topTerms,
    siteVisits: visitDays.reduce((a, b) => a + b, 0), memberList: Array.isArray(members) ? members : [],
  };
}

const C = { ink: '#3a2920', brown: '#7a1f1f', tan: '#c4845f', cream: '#fdf6f1', mute: '#8a7a70', line: '#efe3d8', bg: '#fbf5ef' };
// the post's link on the site
const linkOf = (SITE, x) => SITE + '/post/' + (x.slug || (String(x.id).startsWith('up_') || !/^(wa_|mag_|ext_|ev_|biz_)/.test(String(x.id)) ? String(x.id) : 'up_' + String(x.id)));
const picOf = (SITE, x) => { const a = x && x.attachments && x.attachments[0]; return a && typeof a.url === 'string' ? (a.url.startsWith('http') ? a.url : SITE + a.url) : ''; };
// "Jerusalem · 3 bdrm · ₪12,000/month"
function rentalLine(x) {
  const t = String(x.title || '');
  const beds = x.beds ? x.beds + ' bdrm' : (t.match(/(\d(?:-\d)?)\s*bdrm/i) || [])[1] ? (t.match(/(\d(?:-\d)?)\s*bdrm/i) || [])[1] + ' bdrm' : (/\broom\b/i.test(t) ? 'room' : '');
  const area = (t.match(/\bin ([A-Z][\w'’]+(?: [A-Z][\w'’]+)?)/) || [])[1] || (String(x.area || '').replace(/ & Surrounding/, '') || 'Jerusalem');
  const price = x.price ? '₪' + n(x.price) + (x.priceMode === 'night' ? '/night' : '/month') : '';
  return [area, beds, price].filter(Boolean).join(' · ');
}
// The daily sheet's own stationery (Miriam, 7 Oct 2026: "the same exact template as the
// calendar PDF I get each day"): the watercolour header with the title baked in, one card per
// listing with a coloured bar, a round badge, the title and the facts, the skyline at the foot.
// Shaitel machers first, then the newest rentals, then the newest jobs. Every card opens its post.
const SHEET = { paper: '#fdf6ea', head: '#a3541a', rule: '#d9b48c', card: '#14161b', sub: '#6d5a4e', chev: '#c07a4a',
  wig: { bar: '#e0648a', pale: '#fbdde6', glyph: '✂' }, rent: { bar: '#c4845f', pale: '#f5e2d6', glyph: '⌂' }, job: { bar: '#0ea5e9', pale: '#d3eefb', glyph: '⚒' } };
const clean = (v) => String(v || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
const bedsOf = (x) => { if (x.beds === 0 || x.beds === '0') return 'Studio'; const b = parseInt(x.beds, 10) || parseInt((String(x.title || '').match(/(\d)\s*bdrm/i) || [])[1], 10); return b > 0 ? b + ' bdrm' : ''; };
const whereOf = (x) => clean((Array.isArray(x.communities) && x.communities.filter(Boolean)[0]) || String(x.area || '').replace(/ & Surrounding/, '') || 'Jerusalem');
const rentSub = (x) => [whereOf(x), x.term === 'short' ? 'short term' : 'long term', x.price ? 'NIS ' + n(parseInt(String(x.price).replace(/\D/g, ''), 10) || 0) + (x.priceMode === 'night' ? ' / night' : ' / month') : '', x.size ? x.size + ' m²' : '', clean(x.contactPhone)].filter(Boolean).join('  ·  ');
const firstLine = (x) => { const parts = String(x.memo || '').split(/\n|(?<=[.!?])\s/).map(clean).filter((l) => l.length > 12 && !/^(?:hi|hello|hey|shalom|please see|see (?:the )?(?:flyer|attached)|attached|flyer attached|🌐|translated from)/i.test(l) && !/^[\d\s+()-]+$/.test(l)); return (parts[0] || '').slice(0, 90); };
const jobSub = (x) => [whereOf(x), firstLine(x) !== clean(x.title) ? firstLine(x) : '', clean(x.contactPhone)].filter(Boolean).join('  ·  ');
const wigSub = (x) => [whereOf(x), firstLine(x) !== clean(x.title) ? firstLine(x) : '', clean(x.contactPhone)].filter(Boolean).join('  ·  ');
function sheetLists(st) {
  return { wigs: st.wigList.slice(0, 12), rentals: st.rentalList.slice(0, 10), jobs: st.jobList.slice(0, 10) };
}
function build(SITE, st, member) {
  const first = (member && member.name ? String(member.name).trim().split(' ')[0] : '') || 'there';
  const unsub = member && member.email ? SITE + '/api/email-unsubscribe?token=' + Buffer.from(String(member.email).toLowerCase()).toString('base64url') : SITE;
  const serif = "font-family:'Playfair Display',Georgia,'Times New Roman',serif";
  const body = "font-family:Lora,Georgia,'Times New Roman',serif";
  const { wigs, rentals, jobs } = sheetLists(st);
  const heading = (label) => '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:14px 0 8px"><tr>'
    + '<td style="white-space:nowrap;padding:0 10px 0 4px;' + serif + ';font-size:19px;font-weight:700;color:' + SHEET.head + '">' + esc(label) + '</td>'
    + '<td width="100%" style="border-top:1px solid ' + SHEET.rule + ';font-size:1px;line-height:1px">&nbsp;</td></tr></table>';
  const card = (x, k, badge, sub) => { const href = esc(linkOf(SITE, x)); const title = esc(clean(x.title).replace(/^wanted:\s*/i, '').slice(0, 70) || 'Post');
    return '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#ffffff;border-radius:15px;margin:0 0 9px"><tr>'
      + '<td width="11" style="width:11px;background:' + k.bar + ';border-radius:15px 0 0 15px">&nbsp;</td>'
      + '<td width="70" style="width:70px;padding:9px 4px 9px 12px;vertical-align:middle"><a href="' + href + '" style="text-decoration:none"><div style="width:54px;height:54px;line-height:54px;border-radius:27px;background:' + k.pale + ';color:' + k.bar + ';text-align:center;' + serif + ';font-weight:700;font-size:' + (badge.length > 3 ? '13px' : '24px') + '">' + esc(badge) + '</div></a></td>'
      + '<td style="padding:10px 8px 10px 10px;vertical-align:middle;border-left:1px solid #f0d7c6"><a href="' + href + '" style="text-decoration:none;color:' + SHEET.card + ';' + body + ';font-weight:700;font-size:17px;line-height:1.25;display:block">' + title + '</a>'
      + (sub ? '<div style="' + body + ';font-size:13px;color:' + SHEET.sub + ';margin-top:3px;line-height:1.3">' + esc(sub) + '</div>' : '') + '</td>'
      + '<td width="30" style="width:30px;vertical-align:middle;text-align:center"><a href="' + href + '" style="text-decoration:none;color:' + SHEET.chev + ';font-size:26px;font-weight:700">›</a></td></tr></table>'; };
  const html = '<div style="background:#f3ece2;padding:12px 6px"><div style="max-width:680px;margin:0 auto;background:' + SHEET.paper + ';border-radius:14px;overflow:hidden;' + body + '">'
    + '<a href="' + esc(SITE + '/israel') + '" style="display:block"><img src="' + esc(SITE + '/img/sheet-head-3mo.jpg') + '" width="680" alt="Chutznik is 3 months old!" style="display:block;width:100%;height:auto;border:0"></a>'
    + '<div style="padding:4px 14px 0;font-size:15px;color:' + SHEET.sub + '">Hi ' + esc(first) + ', here is what three months of Chutznik look like: ' + esc(n(st.total)) + ' posts, ' + esc(n(st.businesses)) + ' businesses and ' + esc(n(st.members)) + ' members. The newest of what people ask for most:</div>'
    + '<div style="padding:4px 14px 10px">'
    + (wigs.length ? heading('Shaitel machers') + wigs.map((x) => card(x, SHEET.wig, SHEET.wig.glyph, wigSub(x))).join('') : '')
    + (rentals.length ? heading('Latest rentals') + rentals.map((x) => card(x, SHEET.rent, bedsOf(x) || 'Rental', rentSub(x))).join('') : '')
    + (jobs.length ? heading('Latest jobs') + jobs.map((x) => card(x, SHEET.job, 'Job', jobSub(x))).join('') : '')
    + '<div style="text-align:center;padding:14px 0 4px"><a href="' + esc(SITE + '/israel') + '" style="display:inline-block;background:#7a2c0c;color:#fff;border-radius:99px;padding:12px 30px;text-decoration:none;font-weight:700;font-size:16px;' + serif + '">Open Chutznik ›</a></div>'
    + '</div>'
    + '<img src="' + esc(SITE + '/img/sheet-foot.jpg') + '" width="680" alt="" style="display:block;width:100%;height:auto;border:0">'
    + '<div style="text-align:center;padding:6px 16px 12px;font-size:11px;color:#b8aa9c"><a href="' + esc(unsub) + '" style="color:#b8aa9c">Unsubscribe</a></div>'
    + '</div></div>';
  const line = (x, sub) => '- ' + clean(x.title).slice(0, 70) + (sub ? ' (' + sub + ')' : '') + ' ' + linkOf(SITE, x);
  const text = 'Hi ' + first + ',\n\nChutznik is 3 months old! ' + n(st.total) + ' posts, ' + n(st.businesses) + ' businesses, ' + n(st.members) + ' members.\n\n'
    + (wigs.length ? 'Shaitel machers:\n' + wigs.map((x) => line(x, wigSub(x))).join('\n') + '\n\n' : '')
    + (rentals.length ? 'Latest rentals:\n' + rentals.map((x) => line(x, rentSub(x))).join('\n') + '\n\n' : '')
    + (jobs.length ? 'Latest jobs:\n' + jobs.map((x) => line(x, jobSub(x))).join('\n') + '\n\n' : '')
    + 'Open Chutznik: ' + SITE + '/israel\n\nUnsubscribe: ' + unsub;
  return { subject: 'Chutznik is 3 months old!', html, text };
}

// mode: 'preview' (to previewTo) or 'members' (everyone). Returns a short report line.
async function sendMilestones({ SITE, KEY, mode, previewTo, log, pause }) {
  const st = await gather(SITE, KEY);
  const list = mode === 'members' ? st.memberList : (previewTo || []).map((e) => ({ name: 'Miriam', email: e }));
  if (!list.length) return 'no one to send to';
  let ok = 0, failed = 0;
  for (const m of list) {
    const mail = build(SITE, st, m);
    try {
      const r = await fetch(SITE + '/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' },
        body: JSON.stringify({ type: 'custom', to: m.email, subject: mail.subject + (mode === 'preview' ? ' (preview)' : ''), body: mail.text, html: mail.html, fromName: 'Miriam from Chutznik', plain: true }), signal: AbortSignal.timeout(30000) });
      if (r.ok) ok++; else { failed++; if (log) log('📈 milestones: ' + m.email + ' → HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120)); }
    } catch (e) { failed++; if (log) log('📈 milestones: ' + m.email + ' → ' + (e && e.message)); }
    if (pause) await new Promise((res) => setTimeout(res, pause));
  }
  return mode + ': ' + ok + ' sent, ' + failed + ' failed · ' + st.total + ' posts, ' + st.rentals + ' rentals, ' + st.businesses + ' businesses, ' + st.members + ' members';
}

module.exports = { gather, build, sendMilestones, sheetLists, bedsOf, rentSub, jobSub, wigSub, clean };
