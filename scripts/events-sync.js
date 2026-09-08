// scripts/events-sync.js — "What's on in Jerusalem" from the city's own sources.
// Runs on GitHub Actions every 2 hours. Each source is read, its new events are
// sent to Chutznik as PUBLIC posts under Events (with the date written in the
// text, so the site's calendar picks them up). events-status.json records
// what each source gave — and, when a source could not be parsed, a snippet
// of what came back, so the parser can be adjusted without guessing.
//
// Sources (Miriam, 8 Sep 2026): Reconnect Shiurim (women's shiurim), the
// Kotel (Western Wall Heritage Foundation), the Jerusalem municipality's
// events, and the city's official events calendar (iTravelJerusalem) which
// carries concerts, shows, fairs and tours.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');

// Runs inside updates-sync.js (same GitHub Action, every 10 minutes) but only
// does its round every 2 hours; its memory lives in seen-updates.json and its
// report under "_events" in feeds-status.json.
const SEEN_FILE = path.join(__dirname, '..', 'seen-updates.json');
const STATUS_FILE = path.join(__dirname, '..', 'feeds-status.json');
const loadJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fb; } };
let SEEN = new Set(), STATUS = {};
const EVERY_MS = Number(process.env.EVENTS_EVERY_MIN || 120) * 60 * 1000;
const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; ChutznikEvents/1.0; +https://www.chutznik.org) community events feed; low-rate', 'Accept-Language': 'en,he;q=0.8' };
const fp = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24);
const strip = (h) => cheerio.load('<div>' + (h || '') + '</div>')('div').text().replace(/\s+/g, ' ').trim();
const hasHebrew = (t) => /[\u0590-\u05FF]/.test(t || '');
const snippet = (t, re) => { const s = String(t || ''); if (re) { const m = s.match(re); if (m) return s.slice(Math.max(0, m.index - 300), m.index + 1500); } return s.slice(0, 1800); };

async function get(url, opts) {
  const r = await fetch(url, { headers: Object.assign({}, UA, (opts && opts.headers) || {}), redirect: 'follow' });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text, ct: r.headers.get('content-type') || '' };
}
async function translate(text) {
  const q = String(text || '').slice(0, 450); if (!q) return '';
  try { const r = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) + '&langpair=he|en', { headers: UA }); const j = await r.json();
    const out = j && j.responseData && j.responseData.translatedText ? String(j.responseData.translatedText) : '';
    return out && !hasHebrew(out) && !/MYMEMORY|QUOTA|INVALID/i.test(out) ? out.trim() : ''; } catch (e) { return ''; }
}
const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
// a date in free text → Date (this year or next), or null
function dateIn(text) {
  const t = String(text || '');
  let m = t.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i);
  if (m) { const y = m[3] ? Number(m[3]) : new Date().getFullYear(); const d = new Date(y, MONTHS[m[1].toLowerCase()], Number(m[2])); if (!m[3] && d.getTime() < Date.now() - 45 * 864e5) d.setFullYear(y + 1); return d; }
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?),?\s*(\d{4})?/i);
  if (m) { const y = m[3] ? Number(m[3]) : new Date().getFullYear(); const d = new Date(y, MONTHS[m[2].toLowerCase()], Number(m[1])); if (!m[3] && d.getTime() < Date.now() - 45 * 864e5) d.setFullYear(y + 1); return d; }
  m = t.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/);
  if (m) { let y = Number(m[3]); if (y < 100) y += 2000; const d = new Date(y, Number(m[2]) - 1, Number(m[1])); if (!isNaN(d)) return d; }
  m = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}
const niceDate = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
function timeIn(text) { const m = String(text || '').match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i) || String(text || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/); return m ? m[0] : ''; }

// ── the sources ─────────────────────────────────────────────────────────────
// each returns [{ title, link, desc, date (Date|null), time, place, published }]
const SOURCES = [
  { name: 'Reconnect Shiurim', group: 'Reconnect Shiurim', types: ['Events', 'Spiritual'], area: 'Jerusalem & Surrounding', datedOnly: true,
    async collect() {
      // WooCommerce: the product feed (each shiur is a product, its date is in the name)
      const tries = ['https://reconnectshiurim.com/?post_type=product&feed=rss2', 'https://reconnectshiurim.com/product/feed/', 'https://reconnectshiurim.com/feed/'];
      let items = [], last = '';
      for (const u of tries) {
        const r = await get(u); last = r.text;
        if (!r.ok) continue;
        const $ = cheerio.load(r.text, { xmlMode: true });
        $('item').each((i, el) => { const $e = $(el); const title = strip($e.find('title').first().text()); const link = $e.find('link').first().text().trim();
          const desc = strip($e.find('description').first().text() || $e.find('content\\:encoded').first().text()); const pub = Date.parse($e.find('pubDate').first().text()) || Date.now();
          if (title && link) items.push({ title, link, desc, date: dateIn(title) || dateIn(desc), time: timeIn(desc), place: '', published: pub }); });
        if (items.length) { STATUS[this.name] = 'ok via ' + u + ' (' + items.length + ')'; return items; }
      }
      // the Store API as a fallback
      try {
        const r = await get('https://reconnectshiurim.com/wp-json/wc/store/v1/products?per_page=20&orderby=date&order=desc');
        if (r.ok) { const arr = JSON.parse(r.text); for (const p of arr) { const title = strip(p.name); const desc = strip(p.short_description || p.description || '');
          items.push({ title, link: p.permalink, desc: desc + (p.prices && p.prices.price ? ' Price: ' + (Number(p.prices.price) / Math.pow(10, p.prices.currency_minor_unit || 2)) + ' ' + (p.prices.currency_code || '') : ''), date: dateIn(title) || dateIn(desc), time: timeIn(desc), place: '', published: Date.now() }); }
          if (items.length) { STATUS[this.name] = 'ok via store API (' + items.length + ')'; return items; } last = r.text; }
      } catch (e) { last = String(e); }
      STATUS[this.name] = 'nothing parsed · ' + snippet(last);
      return [];
    } },
  { name: 'The Kotel', group: 'Western Wall Heritage Foundation', types: ['Events', 'Spiritual'], area: 'Jerusalem & Surrounding', datedOnly: true,
    eventWords: /\b(event|ceremony|celebration|gathering|prayer service|selichot|slichot|birkat|birkas|kohanim|hakhel|priestly|tour|concert|festival|lighting|hachnasat|siyum|tefilla|tefillah|program|programme|evening|night of|register|registration|tickets?|join us|invited|will take place|will be held)\b/i,
    async collect() {
      const tries = ['https://thekotel.org/en/tag/%D7%90%D7%99%D7%A8%D7%95%D7%A2%D7%99%D7%9D-en/feed/', 'https://thekotel.org/en/feed/'];
      let items = [], last = '';
      for (const u of tries) {
        const r = await get(u); last = r.text; if (!r.ok) continue;
        const $ = cheerio.load(r.text, { xmlMode: true });
        $('item').each((i, el) => { const $e = $(el); const title = strip($e.find('title').first().text()); const link = $e.find('link').first().text().trim();
          const desc = strip($e.find('description').first().text()); const pub = Date.parse($e.find('pubDate').first().text()) || Date.now();
          if (title && link) items.push({ title, link, desc, date: dateIn(title) || dateIn(desc), time: timeIn(desc), place: 'The Kotel', published: pub }); });
        if (items.length) { STATUS[this.name] = 'ok via ' + u + ' (' + items.length + ')'; return items; }
      }
      try { const r = await get('https://thekotel.org/en/wp-json/wp/v2/posts?per_page=10&_fields=title,link,date,excerpt'); if (r.ok) { for (const p of JSON.parse(r.text)) { const title = strip(p.title && p.title.rendered); const desc = strip(p.excerpt && p.excerpt.rendered);
        items.push({ title, link: p.link, desc, date: dateIn(title) || dateIn(desc), time: timeIn(desc), place: 'The Kotel', published: Date.parse(p.date) || Date.now() }); }
        if (items.length) { STATUS[this.name] = 'ok via wp-json (' + items.length + ')'; return items; } } last = r.text; } catch (e) { last = String(e); }
      STATUS[this.name] = 'nothing parsed · ' + snippet(last);
      return [];
    } },
  { name: 'Jerusalem Municipality', group: 'Jerusalem Municipality (Iriya)', types: ['Events', 'Community'], area: 'Jerusalem & Surrounding',
    async collect() {
      const tries = ['https://www.jerusalem.muni.il/he/experience/events/', 'https://www.jerusalem.muni.il/en/experience/events/', 'https://www.jerusalem.muni.il/he/newsandarticles/events/'];
      let last = '';
      for (const u of tries) {
        let r; try { r = await get(u); } catch (e) { last = String(e); continue; }
        last = r.text; if (!r.ok) { last = 'HTTP ' + r.status + ' ' + r.text.slice(0, 300); continue; }
        const $ = cheerio.load(r.text); const items = [];
        // JSON-LD events, if the page has them
        $('script[type="application/ld+json"]').each((i, el) => { try { const j = JSON.parse($(el).text()); const arr = Array.isArray(j) ? j : (j['@graph'] || [j]);
          for (const e of arr) if (e && /Event/i.test(String(e['@type']))) items.push({ title: strip(e.name), link: e.url || u, desc: strip(e.description), date: e.startDate ? new Date(e.startDate) : null, time: e.startDate && /T\d\d:\d\d/.test(e.startDate) ? e.startDate.slice(11, 16) : '', place: e.location && (e.location.name || e.location.address && e.location.address.streetAddress) || '', published: Date.now() }); } catch (e) {} });
        if (!items.length) {
          // cards: any link whose block has a date
          $('a[href*="/events/"], a[href*="/event/"]').each((i, el) => { const $a = $(el); const href = $a.attr('href') || ''; const block = $a.closest('article, li, div'); const text = strip(block.text() || $a.text()); const title = strip($a.attr('title') || $a.find('h2,h3,h4').first().text() || $a.text()).slice(0, 140);
            if (!title || title.length < 4) return; let link = href; try { link = new URL(href, u).href; } catch (e) {} if (link === u || items.some((x) => x.link === link)) return;
            items.push({ title, link, desc: text.slice(0, 400), date: dateIn(text), time: timeIn(text), place: '', published: Date.now() }); });
        }
        if (items.length) { STATUS[this.name] = 'ok via ' + u + ' (' + items.length + ')'; return items.slice(0, 15); }
        STATUS[this.name] = 'page read but no events found · ' + snippet(r.text, /events|אירוע/i);
      }
      if (!STATUS[this.name]) STATUS[this.name] = 'unreachable · ' + snippet(last);
      return [];
    } },
  { name: 'iTravelJerusalem', group: 'iTravelJerusalem (city events calendar)', types: ['Events', 'Community'], area: 'Jerusalem & Surrounding', datedOnly: true,
    async collect() {
      const u = 'https://www.itraveljerusalem.com/list/events';
      let r; try { r = await get(u); } catch (e) { STATUS[this.name] = 'unreachable ' + e; return []; }
      if (!r.ok) { STATUS[this.name] = 'HTTP ' + r.status; return []; }
      const $ = cheerio.load(r.text); const items = [];
      // 1) Next.js data island: the listing cards (Strapi events), page by page
      const nd = $('#__NEXT_DATA__').text();
      const occurrence = (arr) => {   // the next occurrence from an event's date entries
        const now = Date.now(); let best = null, bestTime = '';
        const day = (v) => String(v || '').slice(0, 10);   // "2026-09-08" or "2026-09-08T14:00:00.000Z" → the day
        const hm = (v) => { const m = String(v || '').match(/(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, '0') + ':' + m[2] + ':00' : ''; };
        for (const d of (Array.isArray(arr) ? arr : [])) { if (!d || typeof d !== 'object' || !d.startDate) continue;
          const st = new Date(day(d.startDate) + 'T' + (hm(d.startTime) || '00:00:00')); if (isNaN(st)) continue;
          const en = d.endDate ? new Date(day(d.endDate) + 'T' + (hm(d.endTime) || '23:59:00')) : new Date(st.getTime() + 3 * 3600e3);
          if (en.getTime() < now - 864e5) continue;
          if (en.getTime() - st.getTime() > 4 * 864e5 || (d.repeats && d.repeats !== 'no')) continue;   // a run or a weekly repeat is an attraction
          const cand = st.getTime() < now - 864e5 ? new Date(new Date().setHours(0, 0, 0, 0)) : st;
          if (!best || cand < best) { best = cand; bestTime = hm(d.startTime).slice(0, 5); } }
        return { date: best, time: bestTime && bestTime !== '00:00' ? bestTime : '' };
      };
      const cardsOf = (j) => { const pp = (j && j.props && j.props.pageProps) || {}; const lc = pp.listingCards; return Array.isArray(lc) ? lc : (lc && Array.isArray(lc.data) ? lc.data : []); };
      if (nd) { try {
        const j = JSON.parse(nd); let cards = cardsOf(j); const pp = (j.props && j.props.pageProps) || {}; const pg = pp.listingCardsPagination || {};
        // the other pages
        for (let p = 2; p <= Math.min(Number(pg.pageCount) || 1, 4); p++) {
          try { const rr = await get('https://www.itraveljerusalem.com/_next/data/' + j.buildId + '/en/list/events.json?page=' + p); let jj = null;
            if (rr.ok && rr.text.trim().startsWith('{')) jj = JSON.parse(rr.text);
            else { const r2 = await get('https://www.itraveljerusalem.com/list/events?page=' + p); const t2 = cheerio.load(r2.text)('#__NEXT_DATA__').text(); if (t2) jj = JSON.parse(t2); }
            if (jj) { const jjn = jj.pageProps ? { props: { pageProps: jj.pageProps } } : jj; cards = cards.concat(cardsOf(jjn)); }
          } catch (e) {}
          await sleep(400);
        }
        STATUS[this.name + ' hints'] = cards.length + ' cards · card keys: ' + Object.keys(cards[0] || {}).join(',').slice(0, 400) + ' · buildId ' + j.buildId;
        let fetched = 0;
        const seenPath = new Set();
        for (const c of cards.slice(0, 60)) {
          const title = strip(c.name || c.title); if (!title) continue;
          const pathOrSlug = c.urlPath || c.slug || (c.listing && c.listing.slug) || '';
          const link = /^https?:/.test(c.url || '') ? c.url : (pathOrSlug ? new URL(pathOrSlug.startsWith('/') ? pathOrSlug : '/events/' + pathOrSlug, 'https://www.itraveljerusalem.com').href : '');
          if (!link || seenPath.has(link)) continue; seenPath.add(link);
          const slug = link.split('/').filter(Boolean).pop();
          const key = 'ev2_' + fp(link + '|' + title); if (SEEN.has(key)) { continue; }
          // the card carries its own dates (startDate/endDate/startTime/endTime); older cards had a date array
          let arr = Array.isArray(c.date) ? c.date : (c.startDate ? [{ startDate: c.startDate, endDate: c.endDate || '', startTime: c.startTime || '', endTime: c.endTime || '', repeats: 'no' }] : null);
          let desc = strip(c.excerpt || c.body || ''), place = strip(c.address || (c.location && (c.location.name || c.location.title || (typeof c.location === 'string' ? c.location : ''))) || '');
          if (!arr && fetched < 12) {   // the card has no dates: read the event's own page
            fetched++;
            try { const rr = await get(link); const t = cheerio.load(rr.text)('#__NEXT_DATA__').text(); if (t) { const jj = JSON.parse(t); let ev = null;
              (function walk(o, depth) { if (ev || !o || depth > 10) return; if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; } if (typeof o !== 'object') return; if (Array.isArray(o.date) && (o.name || o.title) && (o.slug === slug || !slug)) { ev = o; return; } for (const k of Object.keys(o)) walk(o[k], depth + 1); })(jj, 0);
              if (ev) { arr = ev.date; desc = desc || strip(ev.excerpt || ev.body || ''); place = place || strip(ev.address || ''); } } } catch (e) {}
            await sleep(400);
          }
          if (!arr) continue;                       // could not read its dates this time: try again next round
          const occ = occurrence(arr);
          // not for this community: anything on Shabbos, and nightlife
          if (occ.date && occ.date.getDay() === 6) { SEEN.add(key); continue; }
          if (/\b(saturday|shabbat market|pride|nightclub|club night|dj set|bar crawl|cocktail|beer festival|wine tasting)\b/i.test(title + ' ' + desc)) { SEEN.add(key); continue; }
          items.push({ title, link, desc: desc.slice(0, 500), date: occ.date, time: occ.time, place, published: Date.now(), _raw: (arr ? arr.length + ' dates; first ' + JSON.stringify(arr[0]).slice(0, 160) : 'no dates on card') });
        }
        if (items.length) { STATUS[this.name] = 'ok via listing cards (' + items.length + ' new of ' + cards.length + ')'; return items; }
        if (cards.length) { STATUS[this.name] = cards.length + ' cards, nothing new (' + seenPath.size + ' distinct)'; return []; }
      } catch (e) { STATUS[this.name] = '__NEXT_DATA__ unreadable: ' + e; } }
      // 2) JSON-LD
      $('script[type="application/ld+json"]').each((i, el) => { try { const j = JSON.parse($(el).text()); const arr = Array.isArray(j) ? j : (j['@graph'] || [j]);
        for (const e of arr) if (e && /Event/i.test(String(e['@type']))) items.push({ title: strip(e.name), link: e.url || u, desc: strip(e.description), date: e.startDate ? new Date(e.startDate) : null, time: e.startDate && /T\d\d:\d\d/.test(e.startDate) ? e.startDate.slice(11, 16) : '', place: e.location && (e.location.name || '') || '', published: Date.now() }); } catch (e) {} });
      if (items.length) { STATUS[this.name] = 'ok via JSON-LD (' + items.length + ')'; return items; }
      // 3) event links on the page
      const links = new Set(); $('a[href*="/events/"]').each((i, el) => { const h = $(el).attr('href') || ''; try { links.add(new URL(h, u).href); } catch (e) {} });
      if (links.size) {
        for (const link of [...links].slice(0, 12)) {
          try { const rr = await get(link); if (!rr.ok) continue; const $$ = cheerio.load(rr.text); let got = false;
            $$('script[type="application/ld+json"]').each((i, el) => { try { const j = JSON.parse($$(el).text()); const arr = Array.isArray(j) ? j : (j['@graph'] || [j]); for (const e of arr) if (e && /Event/i.test(String(e['@type']))) { got = true; items.push({ title: strip(e.name), link, desc: strip(e.description), date: e.startDate ? new Date(e.startDate) : null, time: e.startDate && /T\d\d:\d\d/.test(e.startDate) ? e.startDate.slice(11, 16) : '', place: e.location && (e.location.name || '') || '', published: Date.now() }); } } catch (e) {} });
            if (!got) { const title = strip($$('h1').first().text() || $$('title').text()); const text = strip($$('main').text() || $$('body').text()).slice(0, 1500); if (title) items.push({ title, link, desc: strip($$('meta[name="description"]').attr('content') || text.slice(0, 300)), date: dateIn(text), time: timeIn(text), place: '', published: Date.now() }); }
          } catch (e) {}
          await sleep(500);
        }
        if (items.length) { STATUS[this.name] = 'ok via event pages (' + items.length + ' of ' + links.size + ' links)'; return items; }
        STATUS[this.name] = links.size + ' event links but none parsed · ' + snippet(r.text, /\/events\//);
      } else STATUS[this.name] = (STATUS[this.name] || 'no events found') + ' · scripts: ' + $('script[src]').map((i, el) => $(el).attr('src')).get().filter((s) => /chunks\/(pages|app)|list/.test(s)).slice(0, 6).join(' ') + ' · ' + snippet(r.text, /<main|<body/i);
      return [];
    } },
];

async function forward(item) {
  try {
    const res = await fetch(process.env.INGEST_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': process.env.INGEST_KEY }, body: JSON.stringify({ file: 'updates', item }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.added) { log('  PUBLISHED: [' + item.group + '] "' + item.title.slice(0, 60) + '"'); return true; }
    if (res.ok) { log('  duplicate: "' + item.title.slice(0, 50) + '"'); return true; }
    log('  ingest error ' + res.status + ': ' + (j.error || '')); return false;
  } catch (e) { log('  could not reach Chutznik: ' + e.message); return false; }
}

async function run(seenSet, statusObj, force) {
  SEEN = seenSet; STATUS = statusObj;
  const prev = (loadJSON(STATUS_FILE, {}) || {}).orgs || {}; const prevEv = prev._events || {};
  if (!force && prevEv.lastRun && Date.now() - Date.parse(prevEv.lastRun) < EVERY_MS) { statusObj._events = prevEv; return 0; }
  let sent = 0; const samples = {};
  for (const src of SOURCES) {
    let raws = [];
    try { raws = await src.collect(); } catch (e) { STATUS[src.name] = 'failed: ' + (e && e.message); }
    samples[src.name] = raws.slice(0, 5).map((r) => ({ title: r.title, date: r.date && !isNaN(r.date) ? r.date.toISOString().slice(0, 10) : null, time: r.time, link: r.link, raw: r._raw }));
    for (const r of raws) {
      if (!r.title || !r.link) continue;
      const key = 'ev2_' + fp(r.link + '|' + r.title); if (SEEN.has(key)) continue;
      const d = r.date && !isNaN(r.date) ? r.date : null;
      if (d && d.getTime() < Date.now() - 2 * 864e5) { SEEN.add(key); continue; }        // already over
      // an article, a recording, a dvar Torah: not an event — only things with a
      // date (and, for a news feed, event words) reach the site
      if (src.datedOnly && !d) { SEEN.add(key); continue; }
      if (src.eventWords && !src.eventWords.test(r.title + ' ' + (r.desc || ''))) { SEEN.add(key); continue; }
      let title = r.title, desc = r.desc || '';
      if (hasHebrew(title)) { const t = await translate(title); if (t) title = t; }
      if (hasHebrew(desc)) { const t = await translate(desc.slice(0, 400)); desc = t || ''; }
      const when = d ? ('📅 ' + niceDate(d) + (r.time ? ' · ' + r.time : '')) : '';
      const memo = [desc.slice(0, 600), when, r.place ? '📍 ' + r.place : '', '🔗 ' + r.link].filter(Boolean).join('\n\n');
      const item = { source: 'events', group: src.group, author: src.group, title: title.slice(0, 150), memo: memo.slice(0, 1500),
        types: src.types, area: src.area, communities: [], contactWebsite: r.link, created: Math.min(Date.now(), r.published || Date.now()),
        status: d ? 'public' : 'pending', dedupeKey: key, _event: !!d };
      const ok = await forward(item); if (ok) { SEEN.add(key); sent++; }
      await sleep(400);
    }
    await sleep(600);
  }
  const report = { lastRun: new Date().toISOString(), sent, sources: {}, samples };
  for (const k of Object.keys(STATUS)) if (SOURCES.some((src) => k.startsWith(src.name))) { report.sources[k] = STATUS[k]; delete STATUS[k]; }
  for (const src of SOURCES) if (!report.sources[src.name]) report.sources[src.name] = '—';
  statusObj._events = report;
  log('=== events sync done — ' + sent + ' new ===');
  return sent;
}
module.exports = { run, SOURCES, VERSION: 'ev-2026-09-08e' };

if (require.main === module) {
  // standalone: node events-sync.js  (needs INGEST_URL / INGEST_KEY)
  if (!process.env.INGEST_URL || !process.env.INGEST_KEY) { console.error('Missing INGEST_URL/INGEST_KEY'); process.exit(1); }
  const seen = new Set(loadJSON(SEEN_FILE, [])); const st = loadJSON(STATUS_FILE, { orgs: {} }); st.orgs = st.orgs || {};
  run(seen, st.orgs, true).then(() => { fs.writeFileSync(SEEN_FILE, JSON.stringify(Array.from(seen).slice(-30000))); st.lastRun = new Date().toISOString(); fs.writeFileSync(STATUS_FILE, JSON.stringify(st, null, 2)); });
}
