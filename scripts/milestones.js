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
  const junkTitle = (u) => /^(?:https?:|www\.|wa\.me)/i.test(String(u.title || '')) || String(u.title || '').length < 6;
  const pubAll = (Array.isArray(updates) ? updates : []).filter((u) => u && u.status === 'public');
  const isLong = (u) => !/\bshort[- ]term\b/i.test(u.title || '') && (u.term === 'long' || (u.term !== 'short' && u.priceMode === 'month') || /\blong[- ]term\b/i.test(u.title || ''));
  const offers = pubAll.filter((u) => (u.types || []).includes('Rental') && !/^wanted/i.test(u.title || '') && isLong(u)).sort(byTime);
  let rentals = offers.filter((u) => !junkTitle(u) && now - tsOf(u) < 86400000); if (rentals.length < 10) rentals = offers.slice(0, 12);
  const jobs = pubAll.filter((u) => !junkTitle(u) && (u.types || []).includes('Jobs') && !/^wa_(BABYSIT|CLEANERS)$/.test(String(u.id)) && !/\bflying to\b|\bseeking (?:someone|a )|^(?:my name|i'?m |i am |we are a )/i.test(u.title || '')).sort(byTime).slice(0, 10);
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
// Miriam's design (6 Oct 2026): banner, greeting, two big numbers, six picture tiles, three
// sections each with a photo and a two-column list, one button. Fluid on a phone.
function build(SITE, st, member) {
  const first = (member && member.name ? String(member.name).trim().split(' ')[0] : '') || 'there';
  const unsub = member && member.email ? SITE + '/api/email-unsubscribe?token=' + Buffer.from(String(member.email).toLowerCase()).toString('base64url') : SITE;
  const A = (href, label, extra) => '<a href="' + esc(href) + '" style="color:' + C.brown + ';text-decoration:none;' + (extra || '') + '">' + label + '</a>';
  const serif = "font-family:Georgia,'Times New Roman',serif";
  const sans = "font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif";
  const tiles = [['ic-rentals-mail.png', 'Rentals', '/search/rentals'], ['ic-place-mail.png', 'Restaurants', '/search/restaurants'], ['ic-cleaners-mail.png', 'Cleaners', '/post/up_wa_CLEANERS'],
    ['ic-person-mail.png', 'Babysitters', '/post/up_wa_BABYSIT'], ['ic-mikva-mail.png', 'Mikvaot', '/search/mikva'], ['ic-doctors-mail.png', 'Doctors', '/search/doctors']];
  const tile = (t) => '<td class="tile" width="16.6%" style="padding:4px;vertical-align:top"><a href="' + esc(SITE + t[2]) + '" style="display:block;text-decoration:none;background:#fff;border:1px solid ' + C.line + ';border-radius:14px;padding:14px 2px 10px;text-align:center">'
    + '<img src="' + esc(SITE + '/img/' + t[0]) + '" width="44" height="44" alt="" style="display:block;margin:0 auto 6px;width:44px;height:44px;border:0"><span style="' + sans + ';font-size:13px;font-weight:700;color:' + C.ink + '">' + esc(t[1]) + '</span></a></td>';
  const item = (x, sub) => '<div style="padding:7px 0;border-bottom:1px solid ' + C.line + '">' + A(linkOf(SITE, x), esc(String(x.title || '').replace(/^wanted:\s*/i, '').slice(0, 60)), 'font-weight:700;font-size:14px') + (sub ? '<div style="' + sans + ';font-size:12px;color:' + C.mute + ';margin-top:2px">' + esc(sub) + '</div>' : '') + '</div>';
  const twoCols = (list, subOf) => { const half = Math.ceil(list.length / 2); const col = (arr) => '<td class="col" width="50%" style="vertical-align:top;padding:0 8px">' + arr.map((x) => item(x, subOf(x))).join('') + '</td>';
    return '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>' + col(list.slice(0, half)) + col(list.slice(half)) + '</tr></table>'; };
  const rentals = st.rentalList.slice(0, 6), jobs = st.jobList.slice(0, 6), wigs = st.wigList.slice(0, 10);
  const rentalPhoto = picOf(SITE, st.rentalList.find((x) => picOf(SITE, x))) || SITE + '/img/cal-jerusalem.webp';
  const wigPhoto = picOf(SITE, st.wigList.find((x) => picOf(SITE, x)));
  const jobPhoto = picOf(SITE, st.jobList.find((x) => picOf(SITE, x)));
  const stat = (icon, num, label) => '<td class="stat" width="50%" style="padding:6px 10px;vertical-align:middle"><table cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>'
    + '<td style="vertical-align:middle;padding-right:12px"><img src="' + esc(SITE + '/img/' + icon) + '" width="52" height="52" alt="" style="display:block;width:52px;height:52px;border:0"></td>'
    + '<td style="vertical-align:middle;text-align:left"><div class="n" style="' + serif + ';font-size:40px;font-weight:700;color:' + C.brown + ';line-height:1">' + esc(num) + '</div><div style="' + sans + ';font-size:12px;letter-spacing:2.5px;color:' + C.mute + ';margin-top:2px">' + esc(label) + '</div></td></tr></table></td>';
  const section = (opts) => '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin-top:16px;background:#fff;border:1px solid ' + C.line + ';border-radius:18px"><tr>'
    + '<td class="photo" width="190" style="vertical-align:top;padding:0;border-radius:18px 0 0 18px;overflow:hidden">' + (opts.photo ? '<img src="' + esc(opts.photo) + '" width="190" alt="" class="photo-img" style="display:block;width:190px;height:230px;object-fit:cover;border-radius:18px 0 0 18px;border:0">' : '<div class="photo-img" style="width:190px;height:230px;background:' + C.cream + ';border-radius:18px 0 0 18px;text-align:center;font-size:60px;line-height:230px">' + opts.emoji + '</div>') + '</td>'
    + '<td class="sec-td" style="vertical-align:top;padding:16px 16px 10px">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:top"><table cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle;padding-right:10px">' + (opts.icon ? '<img src="' + esc(SITE + '/img/' + opts.icon) + '" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0">' : '<div style="font-size:30px;line-height:40px;width:40px;text-align:center">' + opts.glyph + '</div>') + '</td>'
    + '<td style="vertical-align:middle"><div style="' + serif + ';font-size:24px;font-weight:700;color:' + C.brown + ';line-height:1.1">' + esc(opts.title) + '</div><div style="' + sans + ';font-size:13px;color:' + C.mute + ';margin-top:3px">' + esc(opts.sub) + '</div></td></tr></table></td>'
    + (opts.all ? '<td style="vertical-align:top;text-align:right;white-space:nowrap">' + A(SITE + opts.all[1], esc(opts.all[0]) + ' →', 'display:inline-block;border:1px solid ' + C.line + ';border-radius:99px;padding:8px 14px;font-size:12px;font-weight:700;background:' + C.cream) + '</td>' : '') + '</tr></table>'
    + '<div style="height:8px"></div>' + opts.body + '</td></tr></table>';
  const html = '<!--[if mso]><style>table{border-collapse:collapse}</style><![endif]-->'
    + '<style>@media only screen and (max-width:620px){ .wrap{padding:0 !important} .card{border-radius:0 !important} .tile{display:inline-block !important;width:32% !important;box-sizing:border-box} .col{display:block !important;width:100% !important} .photo,.sec-td{display:block !important;width:100% !important;box-sizing:border-box !important} .photo{border-radius:18px 18px 0 0 !important} .photo-img{width:100% !important;height:170px !important;border-radius:18px 18px 0 0 !important} .big{font-size:34px !important} .stat{display:inline-block !important;width:49% !important;box-sizing:border-box !important;padding:6px 2px !important} .stat .n{font-size:30px !important} }</style>'
    + '<div class="wrap" style="background:' + C.bg + ';padding:16px 8px"><div class="card" style="max-width:680px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;' + sans + ';color:' + C.ink + ';line-height:1.45">'
    // banner: the painting with the name on it, flowers at the sides, a curved edge
    + '<a href="' + esc(SITE + '/israel') + '" style="display:block;text-decoration:none"><img src="' + esc(SITE + '/img/mail-banner.jpg') + '" width="680" alt="Chutznik — Israel. Together." style="display:block;width:100%;border:0"></a>'
    // greeting
    + '<div style="text-align:center;padding:8px 20px 4px"><div style="font-size:17px;color:' + C.mute + '">Hi ' + esc(first) + ',</div>'
    + '<div class="big" style="' + serif + ';font-size:38px;font-weight:700;color:' + C.brown + ';margin:4px 0 0">Chutznik is 3 months old! <span style="color:#e06a5a">&#10084;</span></div></div>'
    // two numbers with an icon beside each
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:14px 0 8px"><tr>' + stat('mail-ic-posts.png', n(st.total), 'POSTS') + stat('mail-ic-store.png', n(st.businesses), 'BUSINESS LISTINGS') + '</tr></table>'
    // tiles
    + '<div style="margin:10px 14px 0;background:' + C.cream + ';border:1px solid ' + C.line + ';border-radius:18px;padding:14px 8px 8px">'
    + '<div style="' + serif + ';font-size:24px;font-weight:700;color:' + C.brown + ';text-align:center;margin-bottom:10px">What are you looking for today?</div>'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>' + tiles.map(tile).join('') + '</tr></table></div>'
    // sections
    + '<div style="padding:0 14px">'
    + (rentals.length ? section({ photo: rentalPhoto, emoji: '🏠', icon: 'mail-ic-rentals.png', title: 'Latest Rentals', sub: n(st.rentals) + ' apartments for rent', all: ['View all rentals', '/search/rentals'], body: twoCols(rentals, rentalLine) }) : '')
    + (jobs.length ? section({ photo: jobPhoto, emoji: '💼', icon: 'mail-ic-jobs.png', title: 'Latest Jobs', sub: n(st.jobs) + ' jobs', all: ['View all jobs', '/search/jobs'], body: twoCols(jobs, (x) => String(x.group || '').slice(0, 40)) }) : '')
    + (wigs.length ? section({ photo: wigPhoto, emoji: '💇‍♀️', icon: '', glyph: '\u2702\ufe0f', title: 'Shaitel machers', sub: 'wig stylists on Chutznik', all: ['View all', '/search/sheitel'], body: twoCols(wigs, () => '') }) : '')
    + '</div>'
    // the button, and the faint skyline under it
    + '<div style="text-align:center;padding:26px 16px 6px"><a href="' + esc(SITE + '/israel') + '" style="display:inline-block;background:' + C.brown + ';color:#fff;border-radius:10px;padding:13px 36px;text-decoration:none;font-weight:700;font-size:16px">Open Chutznik →</a>'
    + '<div style="' + sans + ';font-size:12px;color:' + C.mute + ';margin-top:12px">New posts, rentals, jobs and recommendations are added every day.</div></div>'
    + '<img src="' + esc(SITE + '/img/mail-foot.jpg') + '" width="680" alt="" style="display:block;width:100%;border:0;margin-top:-6px">'
    + '<div style="text-align:center;padding:4px 16px 14px;font-size:11px;color:#b8aa9c;background:' + C.bg + '"><a href="' + esc(unsub) + '" style="color:#b8aa9c">Unsubscribe</a></div>'
    + '</div></div>';
  const text = 'Hi ' + first + ',\n\nChutznik is 3 months old!\n\n' + n(st.total) + ' posts · ' + n(st.businesses) + ' business listings\n\n'
    + 'What are you looking for today?\nRentals: ' + SITE + '/search/rentals\nRestaurants: ' + SITE + '/search/restaurants\nCleaners: ' + SITE + '/post/up_wa_CLEANERS\nBabysitters: ' + SITE + '/post/up_wa_BABYSIT\nMikvaot: ' + SITE + '/search/mikva\nDoctors: ' + SITE + '/search/doctors\n\n'
    + (rentals.length ? 'Latest rentals (' + n(st.rentals) + ' apartments for rent):\n' + rentals.map((x) => '- ' + String(x.title || '').slice(0, 60) + ' (' + rentalLine(x) + ') ' + linkOf(SITE, x)).join('\n') + '\nAll rentals: ' + SITE + '/search/rentals\n\n' : '')
    + (jobs.length ? 'Latest jobs (' + n(st.jobs) + '):\n' + jobs.map((x) => '- ' + String(x.title || '').slice(0, 60) + ' ' + linkOf(SITE, x)).join('\n') + '\nAll jobs: ' + SITE + '/search/jobs\n\n' : '')
    + (wigs.length ? 'Shaitel machers (wig stylists):\n' + wigs.map((x) => '- ' + String(x.title || '').slice(0, 60) + ' ' + linkOf(SITE, x)).join('\n') + '\n\n' : '')
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

module.exports = { gather, build, sendMilestones };
