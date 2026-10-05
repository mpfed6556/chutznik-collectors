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

// A letter, not a campaign (Miriam, 6 Oct 2026: the first version landed in
// Gmail's Promotions tab): plain paragraphs in her own voice, a handful of
// links, no picture grid, no stat boxes. Signed "Miriam from Chutznik".
function build(SITE, st, member) {
  const first = (member && member.name ? String(member.name).trim().split(' ')[0] : '') || 'there';
  const unsub = member && member.email ? SITE + '/api/email-unsubscribe?token=' + Buffer.from(String(member.email).toLowerCase()).toString('base64url') : SITE;
  const postLink = (x) => SITE + '/post/' + (x.post.slug || x.id);
  const title = (x) => String(x.post.title || '').replace(/^wanted:\s*/i, 'Wanted: ').slice(0, 70);
  const a = (href, label) => '<a href="' + esc(href) + '" style="color:#a86a45">' + esc(label) + '</a>';
  const hot = st.top.filter((x) => !/^up_wa_(CLEANERS|BABYSIT)$/.test(String(x.id))).slice(0, 5);   // the two lists are named in the sentence above
  const busy = st.busiest ? niceDay(st.busiest).replace(/^(\w+), (\w+) (\d+)$/, '$1 $2 $3') : '';
  const paras = [
    'Hi ' + esc(first) + ',',
    'Chutznik turned three months old, and I wanted to tell you where it got to, since you were one of the first ' + n(st.members) + ' people to join.',
    'Since July 5 there have been <b>' + n(st.total) + ' posts</b> on the site, about ' + n(st.perDay) + ' a day. The busiest day was ' + esc(busy) + ', with ' + n(st.busiestN) + '. That is everything the English-speaking WhatsApp groups post, pulled in and made searchable, plus what members post themselves.',
    'What is in there: <b>' + n(st.rentals) + ' apartments for rent</b>, ' + n(st.businesses) + ' business listings, ' + n(st.jobs) + ' jobs, ' + n(st.events) + ' events on the calendar, and ' + n(st.comments) + ' comments and replies between members. ' + n(st.newMembers) + ' people joined in the last three months.',
    'The pages people open most are ' + a(SITE + '/post/up_wa_CLEANERS', 'the cleaners list') + ' and ' + a(SITE + '/post/up_wa_BABYSIT', 'the babysitters list') + '. The most-searched words are ' + esc(st.searches.slice(0, 6).join(', ')) + '.',
  ];
  const hotHtml = hot.length ? '<p style="margin:0 0 6px">A few posts that got a lot of attention:</p><ul style="margin:0 0 16px;padding-left:20px">' + hot.map((x) => '<li style="margin:3px 0">' + a(postLink(x), title(x)) + '</li>').join('') + '</ul>' : '';
  const html = '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:16px;line-height:1.6;color:#2b2420;max-width:560px">'
    + paras.map((t) => '<p style="margin:0 0 16px">' + t + '</p>').join('')
    + hotHtml
    + '<p style="margin:0 0 16px">If you have not been back for a while: ' + a(SITE + '/search/rentals', 'rentals') + ', ' + a(SITE + '/search/restaurants', 'restaurants') + ', ' + a(SITE + '/calendar', 'this week’s calendar') + ', or just ' + a(SITE + '/israel', 'open Chutznik') + ' and search for whatever you need.</p>'
    + '<p style="margin:0 0 16px">If you know someone who should be on here, forward this to them. And if something is missing from the site, reply to this email. It comes straight to me.</p>'
    + '<p style="margin:0 0 16px">Miriam</p>'
    + '<p style="margin:24px 0 0;font-size:12px;color:#9a8c80">You are getting this because you are a Chutznik member. ' + a(unsub, 'Unsubscribe') + '</p>'
    + '</div>';
  const text = 'Hi ' + first + ',\n\nChutznik turned three months old, and I wanted to tell you where it got to, since you were one of the first ' + n(st.members) + ' people to join.\n\n'
    + 'Since July 5 there have been ' + n(st.total) + ' posts on the site, about ' + n(st.perDay) + ' a day. The busiest day was ' + busy + ', with ' + n(st.busiestN) + '.\n\n'
    + 'What is in there: ' + n(st.rentals) + ' apartments for rent, ' + n(st.businesses) + ' business listings, ' + n(st.jobs) + ' jobs, ' + n(st.events) + ' events on the calendar, and ' + n(st.comments) + ' comments and replies. ' + n(st.newMembers) + ' people joined in the last three months.\n\n'
    + 'The pages people open most: the cleaners list ' + SITE + '/post/up_wa_CLEANERS and the babysitters list ' + SITE + '/post/up_wa_BABYSIT. Most-searched words: ' + st.searches.slice(0, 6).join(', ') + '.\n\n'
    + (hot.length ? 'A few posts that got a lot of attention:\n' + hot.map((x) => '- ' + title(x) + ' ' + postLink(x)).join('\n') + '\n\n' : '')
    + 'Rentals: ' + SITE + '/search/rentals\nRestaurants: ' + SITE + '/search/restaurants\nCalendar: ' + SITE + '/calendar\nOpen Chutznik: ' + SITE + '/israel\n\n'
    + 'If you know someone who should be on here, forward this. If something is missing from the site, reply to this email.\n\nMiriam\n\nUnsubscribe: ' + unsub;
  return { subject: 'Three months of Chutznik', html, text };
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
