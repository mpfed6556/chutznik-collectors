// ── Chaim V'Chesed's information centre, as Chutznik posts (Miriam, 7 Oct 2026) ──
// "create a bunch of posts each with the topic as the subject line and a summary of what
// Chaim V'Chesed says, and then a direct link to the article on their site. everything!!"
// The site's pages are found through its sitemap (or by walking its links), each article's
// text is read, the site's reader writes a faithful summary, and the post goes live with the
// link. Runs again later and only adds what is new. Polite: one page at a time, paused.
'use strict';
const crypto = require('crypto');
const cheerio = require('cheerio');

const ORG = "Chaim V'Chesed";
const HOME = 'https://chaimvchesed.org';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; ChutznikReader/1.0; +https://www.chutznik.org) summaries with a link back; low-rate', 'Accept-Language': 'en' };
const fp = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKIP_PATH = /\/(tag|category|author|feed|wp-json|wp-content|wp-admin|page\/\d+|search|cart|checkout|my-account|login|register|donat|contact|privacy|terms|disclaimer|thank|staff|team|board|careers|jobs?-at|newsletter|subscribe|sitemap|press|media-kit|volunteer|sponsor|shop|product|events?\/\d|\d{4}\/\d{2}\/\d{2}\/?$)/i;

async function get(url) {
  const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : '', ct: r.headers.get('content-type') || '', url: r.url || url };
}
const sameSite = (u) => { try { const h = new URL(u).hostname.replace(/^www\./, ''); return h === 'chaimvchesed.org'; } catch (e) { return false; } };
const clean = (u) => { try { const x = new URL(u); x.hash = ''; x.search = ''; let s = x.toString(); if (!/\.\w{2,5}$/.test(s) && !s.endsWith('/')) s += '/'; return s.replace(/^http:/, 'https:').replace('://www.', '://'); } catch (e) { return ''; } };

// every page the site lists: its sitemaps first, then its own links
async function discover(log) {
  const urls = new Set();
  const fromSitemap = async (u, depth) => {
    try { const r = await get(u); if (!r.ok || !/xml|text/.test(r.ct)) return;
      const locs = [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].trim());
      if (/sitemapindex/i.test(r.text) && depth < 2) { for (const l of locs) { if (!/image|video|attachment|tag|category|author/i.test(l)) await fromSitemap(l, depth + 1); } }
      else for (const l of locs) if (sameSite(l)) urls.add(clean(l));
    } catch (e) {}
  };
  for (const sm of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/post-sitemap.xml', '/page-sitemap.xml']) await fromSitemap(HOME + sm, 0);
  if (log) log('📚 ' + ORG + ': ' + urls.size + ' page(s) in the sitemaps');
  if (urls.size < 15) {
    // no usable sitemap: walk the site from the home page, two levels deep
    const seen = new Set(), queue = [[HOME + '/', 0]];
    while (queue.length && seen.size < 400) {
      const [u, d] = queue.shift(); const cu = clean(u); if (!cu || seen.has(cu)) continue; seen.add(cu);
      try { const r = await get(cu); if (!r.ok || !/html/.test(r.ct)) continue; urls.add(clean(r.url || cu));
        const $ = cheerio.load(r.text);
        $('a[href]').each((i, a) => { const h = $(a).attr('href') || ''; let abs = ''; try { abs = new URL(h, cu).toString(); } catch (e) { return; } if (!sameSite(abs)) return; const c = clean(abs); if (c && !seen.has(c) && d < 2 && !SKIP_PATH.test(c)) queue.push([c, d + 1]); });
      } catch (e) {}
      await sleep(700);
    }
    if (log) log('📚 ' + ORG + ': ' + urls.size + ' page(s) after walking the site');
  }
  return [...urls].filter((u) => u && !SKIP_PATH.test(u) && !/\.(jpg|jpeg|png|gif|webp|pdf|mp4|mp3|zip)$/i.test(u) && u !== HOME + '/');
}

// one page: its title, its text, its date
async function readPage(url) {
  const r = await get(url); if (!r.ok || !/html/.test(r.ct)) return null;
  const $ = cheerio.load(r.text);
  const meta = (n) => $('meta[property="' + n + '"], meta[name="' + n + '"]').attr('content') || '';
  const title = (meta('og:title') || $('h1').first().text() || $('title').text() || '').replace(/\s*[|–-]\s*Chaim\s*V['’]?Chesed.*$/i, '').replace(/\s+/g, ' ').trim();
  $('script, style, noscript, nav, header, footer, aside, form, iframe, svg, .menu, .nav, .sidebar, .widget, .comments, .comment, .share, .social, .breadcrumb, .related, .elementor-location-header, .elementor-location-footer, [role="navigation"], [role="banner"], [role="contentinfo"]').remove();
  let main = $('article').first(); if (!main.length || main.text().trim().length < 300) main = $('main, .entry-content, .elementor-widget-theme-post-content, .post-content, .page-content, .single-content, #content, .content').first(); if (!main.length || main.text().trim().length < 300) main = $('body');
  const text = main.text().replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const published = Date.parse(meta('article:published_time') || meta('article:modified_time') || $('time[datetime]').first().attr('datetime') || '') || 0;
  return { url: clean(r.url || url), title, text, published };
}

async function run({ SITE, KEY, log, limit }) {
  const H = { 'Content-Type': 'application/json', 'x-ingest-key': KEY, 'User-Agent': 'chutznik-reader' };
  const say = (m) => { if (log) log(m); };
  let have = new Set();
  try { const r = await fetch(SITE + '/api/live-data?type=updates&queue=1&t=' + Date.now(), { signal: AbortSignal.timeout(60000) }); const all = r.ok ? await r.json() : []; for (const u of (Array.isArray(all) ? all : [])) if (u && u.source === 'cvc') have.add(String(u.id)); } catch (e) {}
  const urls = await discover(log);
  const todo = urls.filter((u) => !have.has('cvc_' + fp(u)));
  say('📚 ' + ORG + ': ' + urls.length + ' page(s), ' + have.size + ' already on Chutznik, ' + todo.length + ' to read');
  let added = 0, skipped = 0, failed = 0, n = 0;
  for (const url of todo) {
    if (limit && n >= limit) break; n++;
    try {
      const page = await readPage(url);
      if (!page || page.text.length < 350) { skipped++; continue; }
      const r = await fetch(SITE + '/api/live-data?type=summarize', { method: 'POST', headers: H, body: JSON.stringify({ org: ORG, title: page.title, url: page.url, text: page.text.slice(0, 9000) }), signal: AbortSignal.timeout(120000) });
      const j = await r.json().catch(() => ({}));
      if (!j || !j.ok) { failed++; say('   ✍️ ' + (j && j.error || 'HTTP ' + r.status) + ' — ' + url); if (/No reader key|429/.test(String(j && j.error))) break; await sleep(8000); continue; }
      if (j.skip) { skipped++; await sleep(2000); continue; }
      const item = { id: 'cvc_' + fp(url), source: 'cvc', group: ORG, title: j.title, memo: j.summary + '\n\n📖 Read the full article on ' + ORG + '’s site:\n' + page.url,
        types: j.types, area: 'Jerusalem & Surrounding', communities: [], author: ORG, contactPhone: '', contactWebsite: page.url, created: page.published || Date.now(), status: 'public', attachments: [], dedupeKey: 'cvc|' + fp(url), verified: true };
      const w = await fetch(SITE + '/api/ingest-whatsapp?file=updates', { method: 'POST', headers: H, body: JSON.stringify({ file: 'updates', items: [item] }), signal: AbortSignal.timeout(120000) });
      const wj = await w.json().catch(() => ({}));
      if (w.ok && wj.added) { added++; say('   📚 ' + j.title); } else if (w.ok) { skipped++; } else { failed++; say('   📚 could not save: HTTP ' + w.status); }
    } catch (e) { failed++; say('   📚 ' + url + ': ' + (e && e.message)); }
    await sleep(7000);   // the reader's free tier, and good manners toward their server
  }
  return ORG + ': ' + added + ' new post(s), ' + skipped + ' skipped, ' + failed + ' failed, ' + (urls.length - have.size - n) + ' left for next time';
}
module.exports = { run, discover, readPage, ORG };

if (require.main === module) {
  run({ SITE: process.env.SITE || 'https://chutznik.org', KEY: process.env.INGEST_KEY || '', log: console.log, limit: Number(process.argv[2]) || 0 }).then(console.log).catch((e) => { console.error(e); process.exit(1); });
}
