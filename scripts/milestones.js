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
  return {
    total: all.length, external: live.length, mine: mine.length, dayCount: dayKeys.length,
    perDay: dayKeys.length ? Math.round(all.length / dayKeys.length) : 0, busiest, busiestN: busiest ? days[busiest] : 0, firstDay,
    rentals: cat('rental'), businesses: cat('company'), jobs: cat('jobs'), events: cat('events'), healthcare: cat('healthcare'), places: cat('place'),
    comments, members: (Array.isArray(members) ? members : []).length, newMembers, top, searches: topTerms,
    siteVisits: visitDays.reduce((a, b) => a + b, 0), memberList: Array.isArray(members) ? members : [],
  };
}

const C = { ink: '#3a2920', brown: '#6b2a0c', tan: '#c4845f', cream: '#fdf6f1', mute: '#9a8c80', line: '#f0e4da' };
function statBox(num, label) {
  return '<td width="33%" style="padding:6px"><div style="background:' + C.cream + ';border-radius:14px;padding:14px 8px;text-align:center">'
    + '<div style="font-family:Georgia,serif;font-size:28px;font-weight:700;color:' + C.brown + ';line-height:1">' + esc(num) + '</div>'
    + '<div style="font-size:12px;color:' + C.mute + ';margin-top:4px">' + esc(label) + '</div></div></td>';
}
function picButton(SITE, img, label, path) {
  return '<td width="25%" style="padding:5px;vertical-align:top"><a href="' + esc(SITE + path) + '" style="display:block;text-decoration:none;background:#fff;border:1px solid ' + C.line + ';border-radius:16px;padding:12px 4px 10px;text-align:center">'
    + '<img src="' + esc(SITE + '/img/' + img) + '" width="44" height="44" alt="" style="display:block;margin:0 auto 6px;width:44px;height:44px;border:0">'
    + '<span style="font-size:12px;font-weight:700;color:' + C.ink + '">' + esc(label) + '</span></a></td>';
}
function build(SITE, st, member) {
  const first = (member && member.name ? String(member.name).trim().split(' ')[0] : '') || 'there';
  const unsub = member && member.email ? SITE + '/api/email-unsubscribe?token=' + Buffer.from(String(member.email).toLowerCase()).toString('base64url') : SITE;
  const postLink = (x) => SITE + '/post/' + (x.post.slug || x.id);
  const title = (x) => String(x.post.title || '').replace(/^wanted:\s*/i, 'Wanted: ').slice(0, 70);
  const tiles = [
    ['ic-rentals.webp', 'Rentals', '/search/rentals'], ['ic-place.webp', 'Restaurants', '/search/restaurants'],
    ['ic-cleaners.webp', 'Cleaners', '/post/up_wa_CLEANERS'], ['ic-person.webp', 'Babysitters', '/post/up_wa_BABYSIT'],
    ['ic-mikva.webp', 'Mikvaot', '/search/mikva'], ['ic-gans.webp', 'Gans', '/search/gans'],
    ['ic-doulas.webp', 'Doulas', '/search/doulas'], ['ic-doctors.webp', 'Doctors', '/search/doctors'],
  ];
  const pill = (term) => '<a href="' + esc(SITE + '/search/' + encodeURIComponent(term)) + '" style="display:inline-block;margin:0 6px 8px 0;padding:7px 14px;border-radius:99px;background:' + C.cream + ';color:' + C.brown + ';font-weight:700;font-size:13px;text-decoration:none">🔍 ' + esc(term) + '</a>';
  const hot = st.top.map((x) => '<tr><td style="padding:7px 0;border-bottom:1px solid ' + C.line + '"><a href="' + esc(postLink(x)) + '" style="color:' + C.ink + ';font-weight:700;text-decoration:none">' + esc(title(x)) + '</a>'
    + '<div style="font-size:12px;color:' + C.mute + '">' + esc((x.post.types || [])[0] || '') + (x.views ? ' · ' + n(x.views) + ' views' : '') + '</div></td></tr>').join('');
  const html = '<div style="background:#fbf7f3;padding:18px 10px"><div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:' + C.ink + ';max-width:600px;margin:0 auto;background:#fff;border-radius:22px;padding:26px 22px">'
    + '<table style="border-collapse:collapse"><tr><td style="padding-right:12px"><img src="' + esc(SITE + '/img/lady.png') + '" width="56" height="56" alt="" style="width:56px;height:56px;border-radius:50%;border:0;display:block"></td>'
    + '<td><div style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:' + C.brown + ';line-height:1.1">Three months of Chutznik</div><div style="font-size:13px;color:' + C.mute + '">What we built together, ' + esc(new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Jerusalem', month: 'long', year: 'numeric' })) + '</div></td></tr></table>'
    + '<p style="margin:18px 0 6px">Hi ' + esc(first) + ' 👋</p>'
    + '<p style="margin:0 0 14px">Chutznik is the English-speakers’ board for Jerusalem: everything posted in the WhatsApp groups, searchable in one place, plus what members post directly. Here is what the last three months looked like.</p>'
    + '<table width="100%" style="border-collapse:collapse"><tr>' + statBox(n(st.total), 'posts since ' + (st.firstDay ? niceDay(st.firstDay).replace(/^\w+, /, '') : 'the start')) + statBox(n(st.perDay), 'new posts every day') + statBox(n(st.busiestN), 'on the busiest day' + (st.busiest ? ' (' + niceDay(st.busiest).split(',')[0] + ' ' + st.busiest.slice(5).replace('-', '/') + ')' : '')) + '</tr>'
    + '<tr>' + statBox(n(st.rentals), 'apartments for rent') + statBox(n(st.businesses), 'business listings') + statBox(n(st.events), 'events on the calendar') + '</tr>'
    + '<tr>' + statBox(n(st.jobs), 'jobs') + statBox(n(st.comments), 'comments and replies') + statBox(n(st.members), 'members (' + n(st.newMembers) + ' joined this quarter)') + '</tr></table>'
    + '<h3 style="font-family:Georgia,serif;color:' + C.brown + ';font-size:18px;margin:24px 0 8px">Jump straight in</h3>'
    + '<table width="100%" style="border-collapse:collapse"><tr>' + tiles.slice(0, 4).map((t) => picButton(SITE, t[0], t[1], t[2])).join('') + '</tr><tr>' + tiles.slice(4).map((t) => picButton(SITE, t[0], t[1], t[2])).join('') + '</tr></table>'
    + (hot ? '<h3 style="font-family:Georgia,serif;color:' + C.brown + ';font-size:18px;margin:24px 0 4px">The posts everyone opened</h3><table width="100%" style="border-collapse:collapse">' + hot + '</table>' : '')
    + (st.searches.length ? '<h3 style="font-family:Georgia,serif;color:' + C.brown + ';font-size:18px;margin:24px 0 10px">What people searched for most</h3><div>' + st.searches.map(pill).join('') + '</div>' : '')
    + '<div style="margin:26px 0 8px;text-align:center"><a href="' + esc(SITE + '/israel') + '" style="display:inline-block;background:' + C.tan + ';color:#fff;border-radius:99px;padding:13px 30px;text-decoration:none;font-weight:700;font-size:15px">Open Chutznik</a>'
    + '<div style="margin-top:10px"><a href="' + esc(SITE + '/calendar') + '" style="color:' + C.brown + ';font-weight:700;text-decoration:none;margin:0 10px">📅 This week’s calendar</a> <a href="' + esc(SITE + '/israel?install=1') + '" style="color:' + C.brown + ';font-weight:700;text-decoration:none;margin:0 10px">📲 Put it on your phone</a></div></div>'
    + '<p style="margin:18px 0 0;font-size:14px">Know someone who should be here? Forward this. And if you see something missing from the site, reply to this email — it comes straight to Miriam.</p>'
    + '<div style="margin-top:22px;padding-top:12px;border-top:1px solid ' + C.line + ';font-size:11px;color:#b8aa9c">You are getting this because you are a Chutznik member. <a href="' + esc(unsub) + '" style="color:#b8aa9c">Unsubscribe</a></div>'
    + '</div></div>';
  const text = 'Three months of Chutznik\n\nHi ' + first + ',\n\n' + n(st.total) + ' posts since ' + (st.firstDay || 'the start') + ' — about ' + n(st.perDay) + ' a day, ' + n(st.busiestN) + ' on the busiest day.\n'
    + n(st.rentals) + ' apartments for rent · ' + n(st.businesses) + ' business listings · ' + n(st.events) + ' events · ' + n(st.jobs) + ' jobs · ' + n(st.comments) + ' comments · ' + n(st.members) + ' members (' + n(st.newMembers) + ' new this quarter).\n\n'
    + 'Rentals: ' + SITE + '/search/rentals\nRestaurants: ' + SITE + '/search/restaurants\nCleaners: ' + SITE + '/post/up_wa_CLEANERS\nCalendar: ' + SITE + '/calendar\n\n'
    + (st.top.length ? 'The posts everyone opened:\n' + st.top.map((x) => '• ' + title(x) + ' — ' + postLink(x)).join('\n') + '\n\n' : '')
    + (st.searches.length ? 'Most searched: ' + st.searches.join(', ') + '\n\n' : '')
    + 'Open Chutznik: ' + SITE + '/israel\n\nUnsubscribe: ' + unsub;
  return { subject: 'Three months of Chutznik — ' + n(st.total) + ' posts, ' + n(st.rentals) + ' rentals, and the posts everyone opened', html, text };
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
        body: JSON.stringify({ type: 'custom', to: m.email, subject: mail.subject + (mode === 'preview' ? ' [preview]' : ''), body: mail.text, html: mail.html }), signal: AbortSignal.timeout(30000) });
      if (r.ok) ok++; else { failed++; if (log) log('📈 milestones: ' + m.email + ' → HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120)); }
    } catch (e) { failed++; if (log) log('📈 milestones: ' + m.email + ' → ' + (e && e.message)); }
    if (pause) await new Promise((res) => setTimeout(res, pause));
  }
  return mode + ': ' + ok + ' sent, ' + failed + ' failed · ' + st.total + ' posts, ' + st.rentals + ' rentals, ' + st.businesses + ' businesses, ' + st.members + ' members';
}

module.exports = { gather, build, sendMilestones };
