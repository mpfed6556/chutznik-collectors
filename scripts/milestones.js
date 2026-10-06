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
    getJson(SITE + '/api/live-data?type=members' + t, H).catch(() => []),
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
  const pubAll = (Array.isArray(updates) ? updates : []).filter((u) => u && u.status === 'public');
  const isLong = (u) => !/\bshort[- ]term\b/i.test(u.title || '') && (u.term === 'long' || (u.term !== 'short' && u.priceMode === 'month') || /\blong[- ]term\b/i.test(u.title || ''));
  const offers = pubAll.filter((u) => (u.types || []).includes('Rental') && !/^wanted/i.test(u.title || '') && isLong(u)).sort(byTime);
  let rentals = offers.filter((u) => now - tsOf(u) < 86400000); if (rentals.length < 10) rentals = offers.slice(0, 12);
  const jobs = pubAll.filter((u) => (u.types || []).includes('Jobs') && !/^wa_(BABYSIT|CLEANERS)$/.test(String(u.id)) && !/\bflying to\b|\bseeking (?:someone|a )|^(?:my name|i'?m |i am |we are a )/i.test(u.title || '')).sort(byTime).slice(0, 10);
  const wigRe = /sheitel|shaitel|sheitl|shaytel|\bwigs?\b/i, wigWork = /macher|stylist|salon|wash|\bset\b|cut|styl|repair|colou?r|wigs|hair/i;
  const wigs = pubAll.concat((Array.isArray(posts) ? posts : []).filter((p) => p && !p.isExternal))
    .filter((x) => { const t = (x.title || '') + ' ' + (x.memo || ''); return wigRe.test(t) && wigWork.test(t) && !/looking to hire|seeking .*salons|wanted:/i.test(x.title || ''); })
    .sort(byTime);
  const seenPhone = new Set(); const wigList = wigs.filter((x) => { const k = String(x.contactPhone || '').replace(/\D/g, '').slice(-9) || x.id; if (seenPhone.has(k)) return false; seenPhone.add(k); return true; });
  return {
    rentalList: rentals, jobList: jobs, wigList,
    total: all.length, external: live.length, mine: mine.length, dayCount: dayKeys.length,
    perDay: dayKeys.length ? Math.round(all.length / dayKeys.length) : 0, busiest, busiestN: busiest ? days[busiest] : 0, firstDay,
    rentals: cat('rental'), businesses: cat('company'), jobs: cat('jobs'), events: cat('events'), healthcare: cat('healthcare'), places: cat('place'),
    comments, members: (Array.isArray(members) ? members : []).length, newMembers, top, searches: topTerms,
    siteVisits: visitDays.reduce((a, b) => a + b, 0), memberList: Array.isArray(members) ? members : [],
  };
}

const C = { ink: '#3a2920', brown: '#6b2a0c', tan: '#c4845f', cream: '#fdf6f1', mute: '#9a8c80', line: '#f0e4da' };
function statBox(num, label) {
  return '<td width="25%" style="padding:5px"><div style="background:' + C.cream + ';border-radius:14px;padding:14px 6px;text-align:center">'
    + '<div style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:' + C.brown + ';line-height:1">' + esc(num) + '</div>'
    + '<div style="font-size:12px;color:' + C.mute + ';margin-top:4px">' + esc(label) + '</div></div></td>';
}
function picButton(SITE, img, label, path) {
  return '<td width="33%" style="padding:5px;vertical-align:top"><a href="' + esc(SITE + path) + '" style="display:block;text-decoration:none;background:#fff;border:1px solid ' + C.line + ';border-radius:16px;padding:14px 4px 12px;text-align:center">'
    + '<img src="' + esc(SITE + '/img/' + img) + '" width="56" height="56" alt="" style="display:block;margin:0 auto 8px;width:56px;height:56px;border:0">'
    + '<span style="font-size:13px;font-weight:700;color:' + C.ink + '">' + esc(label) + '</span></a></td>';
}
// the post's link on the site
const linkOf = (SITE, x) => SITE + '/post/' + (x.slug || (String(x.id).startsWith('up_') || !/^(wa_|mag_|ext_|ev_)/.test(String(x.id)) ? String(x.id) : 'up_' + String(x.id)));
// "3 bdrm · Romema · ₪12,000/month"
function rentalLine(x) {
  const t = String(x.title || '');
  const beds = x.beds ? x.beds + ' bdrm' : (t.match(/(\d(?:-\d)?)\s*bdrm/i) || [])[1] ? (t.match(/(\d(?:-\d)?)\s*bdrm/i) || [])[1] + ' bdrm' : (/\broom\b/i.test(t) ? 'room' : 'apartment');
  const area = (t.match(/\bin ([A-Z][\w'’]+(?: [A-Z][\w'’]+)?)/) || [])[1] || (String(x.area || '').replace(/ & Surrounding/, '') || 'Jerusalem');
  const price = x.price ? '₪' + n(x.price) + (x.priceMode === 'night' ? '/night' : '/month') : '';
  return [beds, area, price].filter(Boolean).join(' · ');
}
// Miriam's letter, word for word where she gave the words (6 Oct 2026)
function build(SITE, st, member) {
  const first = (member && member.name ? String(member.name).trim().split(' ')[0] : '') || 'there';
  const unsub = member && member.email ? SITE + '/api/email-unsubscribe?token=' + Buffer.from(String(member.email).toLowerCase()).toString('base64url') : SITE;
  const a = (href, label) => '<a href="' + esc(href) + '" style="color:' + C.brown + ';font-weight:700;text-decoration:none">' + esc(label) + '</a>';
  const h3 = (t) => '<h3 style="font-family:Georgia,serif;color:' + C.brown + ';font-size:18px;margin:26px 0 8px">' + esc(t) + '</h3>';
  const row = (x, sub) => '<tr><td style="padding:7px 0;border-bottom:1px solid ' + C.line + '">' + a(linkOf(SITE, x), String(x.title || '').replace(/^wanted:\s*/i, '').slice(0, 72)) + (sub ? '<div style="font-size:12px;color:' + C.mute + '">' + esc(sub) + '</div>' : '') + '</td></tr>';
  const tiles = [['ic-rentals-mail.png', 'Rentals', '/search/rentals'], ['ic-place-mail.png', 'Restaurants', '/search/restaurants'], ['ic-cleaners-mail.png', 'Cleaners', '/post/up_wa_CLEANERS'],
    ['ic-person-mail.png', 'Babysitters', '/post/up_wa_BABYSIT'], ['ic-mikva-mail.png', 'Mikvaot', '/search/mikva'], ['ic-doctors-mail.png', 'Doctors', '/search/doctors']];
  const html = '<div style="background:#fbf7f3;padding:18px 10px"><div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:' + C.ink + ';max-width:600px;margin:0 auto;background:#fff;border-radius:22px;padding:26px 22px">'
    + '<p style="margin:0 0 14px">Hi ' + esc(first) + ',</p>'
    + '<div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:' + C.brown + ';margin:0 0 14px">Chutznik turned three months old</div>'
    + '<p style="margin:0 0 16px">Since July 5 there have been <b>' + n(st.total) + ' posts</b> on the site: ' + n(st.rentals) + ' apartments for rent, ' + n(st.jobs) + ' jobs, ' + n(st.businesses) + ' business listings — and a first-time-ever shared ' + a(SITE + '/calendar', 'Jerusalem calendar') + '! And ' + n(st.comments) + ' comments and replies!</p>'
    + '<table width="100%" style="border-collapse:collapse"><tr>' + statBox(n(st.perDay) + '+', 'new posts every day') + statBox(n(st.rentals), 'apartments for rent') + statBox(n(st.businesses), 'business listings') + statBox(n(st.jobs), 'jobs') + '</tr></table>'
    + h3('Jump straight in')
    + '<table width="100%" style="border-collapse:collapse"><tr>' + tiles.slice(0, 3).map((t) => picButton(SITE, t[0], t[1], t[2])).join('') + '</tr><tr>' + tiles.slice(3).map((t) => picButton(SITE, t[0], t[1], t[2])).join('') + '</tr></table>'
    + (st.rentalList.length ? h3('Long-term rentals from the last day') + '<table width="100%" style="border-collapse:collapse">' + st.rentalList.map((x) => row(x, rentalLine(x))).join('') + '</table>' : '')
    + (st.jobList.length ? h3('The latest jobs') + '<table width="100%" style="border-collapse:collapse">' + st.jobList.map((x) => row(x, String(x.group || '').slice(0, 40))).join('') + '</table>' : '')
    + (st.wigList.length ? h3('Shaitel machers (wig stylists) on Chutznik') + '<table width="100%" style="border-collapse:collapse">' + st.wigList.map((x) => row(x, '')).join('') + '</table>' : '')
    + '<p style="margin:26px 0 0;font-size:16px">Just ' + a(SITE + '/israel', 'open Chutznik') + ' and search for whatever you need.</p>'
    + '<p style="margin:16px 0 0">Miriam</p>'
    + '<div style="margin-top:24px;padding-top:12px;border-top:1px solid ' + C.line + ';font-size:11px;color:#b8aa9c"><a href="' + esc(unsub) + '" style="color:#b8aa9c">Unsubscribe</a></div>'
    + '</div></div>';
  const text = 'Hi ' + first + ',\n\nChutznik turned three months old\n\nSince July 5 there have been ' + n(st.total) + ' posts on the site: ' + n(st.rentals) + ' apartments for rent, ' + n(st.jobs) + ' jobs, ' + n(st.businesses) + ' business listings - and a first time ever shared Jerusalem calendar! ' + SITE + '/calendar\nAnd ' + n(st.comments) + ' comments and replies!\n\n'
    + 'Rentals: ' + SITE + '/search/rentals\nRestaurants: ' + SITE + '/search/restaurants\nCleaners: ' + SITE + '/post/up_wa_CLEANERS\nBabysitters: ' + SITE + '/post/up_wa_BABYSIT\nMikvaot: ' + SITE + '/search/mikva\nDoctors: ' + SITE + '/search/doctors\n\n'
    + (st.rentalList.length ? 'Long-term rentals from the last day:\n' + st.rentalList.map((x) => '- ' + String(x.title || '').slice(0, 72) + ' (' + rentalLine(x) + ') ' + linkOf(SITE, x)).join('\n') + '\n\n' : '')
    + (st.jobList.length ? 'The latest jobs:\n' + st.jobList.map((x) => '- ' + String(x.title || '').slice(0, 72) + ' ' + linkOf(SITE, x)).join('\n') + '\n\n' : '')
    + (st.wigList.length ? 'Shaitel machers (wig stylists) on Chutznik:\n' + st.wigList.map((x) => '- ' + String(x.title || '').slice(0, 72) + ' ' + linkOf(SITE, x)).join('\n') + '\n\n' : '')
    + 'Just open Chutznik and search for whatever you need: ' + SITE + '/israel\n\nMiriam\n\nUnsubscribe: ' + unsub;
  return { subject: 'Chutznik turned three months old', html, text };
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

module.exports = { gather, build, sendMilestones };
