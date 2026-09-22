// ── Matches (Miriam, 22 Sep 2026) ────────────────────────────────────────────
// People looking for an apartment meet the apartments on offer, and owners
// meet the people looking; people looking for work meet the jobs, and
// employers meet the job-seekers; anyone asking for something meets the
// posts that answer it (a babysitter, a sukkah builder, a piano teacher),
// and a business meets the people asking — from posts at most three days
// old — and a note in Miriam's voice carries the links. Used by the bridge
// (the WhatsApp note to a poster) and by the jerusaguide mailer.
//
//   const RM = require('./scripts/rental-match.js');
//   const recent = await RM.fetchRecent(SITE);        // rentals ≤ 3 days old, both files
//   const matches = RM.findMatches(item, recent);      // the other side, best first (≤ 5)
//   const text = RM.message(item, matches, SITE);      // the note
//
//   node scripts/rental-match.js --updates official-updates.json --posts all-posts.json   (rehearsal on local files)
'use strict';
const DAYS = 3, MAX = 5;
const HOODS = ['Ramat Eshkol','Sanhedria Murchevet','Sanhedria','Maalot Dafna','Givat Hamivtar','Ramat Shlomo','Ramot','Har Nof','Bayit Vegan','Kiryat Moshe','Givat Shaul','Romema','Sorotzkin','Mattersdorf','Kiryat Belz','Unsdorf','Geula','Mea Shearim','Bar Ilan','Ezrat Torah','Mekor Baruch','Zichron Moshe','Nachlaot','Rechavia','Shaarei Chesed','Talbiya','Mamila','City Center','Old City','Musrara','Baka','German Colony','Katamon','Talpiot','Arnona','Beit Hakerem','Nayot','Kiryat Yovel','Malha','French Hill','Pisgat Zev','Neve Yaakov','Gilo','Har Homa','Givat Zev',"Ma'ale Adumim",'Efrat','Beitar Illit','Mevaseret Zion','Telz-Stone','Ramat Bet Shemesh','Bet Shemesh','Beit Shemesh','Tel Aviv','Bnei Brak','Modi\'in','Netanya','Tiberias','Tzfas','Haifa','Ashdod','Elad'];
const SEEK_RE = /\b(looking for|seeking|searching for|in search of|iso\b|wanted|need(?:s|ed)? (?:a|an|to find)|anyone (?:know|have|renting)|does anyone|is there|any(?:body|one) (?:looking|renting)|want(?:s|ed)? to rent|interested in renting)\b/i;
const OFFER_RE = /\b(available|avail\b|for rent|to rent out|renting out|sublet available|for sublet|now available|to let)\b/i;
const RENT_RE = /\b(apartment|apt|flat|dira|rental|sublet|bdrm|bedroom|bedrooms|studio|penthouse|unit)\b/i;
const JOB_RE = /\b(job|jobs|position|hiring|employment|vacancy|full[- ]?time|part[- ]?time|salary|resume|cv|work from home|secretary|looking for work|seeking work)\b/i;
const JOB_SEEK_RE = /\b(looking for (?:a |any |some |more |part[- ]?time |full[- ]?time |cleaning |babysitting |extra )?(?:job|jobs|work|position|employment|hours|clients|shifts)|seeking (?:a |an )?(?:job|work|employment|position)|available for (?:work|jobs?|hire|babysitting|cleaning)|i (?:can|do|offer|give|teach|am available)|(?:sem(?:inary)? girl|student|bochur|woman|girl|lady|guy|man|mother|nurse|teacher|cleaner) (?:looking|available|seeking|offering))\b/i;
const SKIP_IDS = /^(wa_BABYSIT|wa_CLEANERS|900001)$/;
const STOP = new Set('the a an and or for to in of on at with from by is are was be this that these those it its my our your their his her we you they i me us them any some all very much more most just only also not no yes please pls thanks thank looking seeking wanted need needed needs want wants anyone anybody someone somebody does know knows have has had there here who what when where which how avail available offer offering post posted message info details call text whatsapp number phone email contact area near around jerusalem israel city center day days week weeks month months year years time hour hours morning evening night today tomorrow tonight great good nice best new old big small large full price prices shekel shekels nis per each about into over under after before between during without within until while still than then them because chag sukkos sukkot yom tov holiday'.split(' '));
const kindOf = (p) => isRental(p) ? 'rental' : ((p.types || []).some((t) => /^jobs?$/i.test(String(t))) ? 'job' : 'general');
const stem = (w) => w.replace(/^'+|'+$/g, '').replace(/(ings?|ers?|ies|es|s)$/, (m) => (m === 'ies' ? 'y' : ''));
function wordsOf(text) { const out = new Set(); for (const w of String(text || '').toLowerCase().replace(/[^a-z\u0590-\u05ff0-9' ]+/g, ' ').split(/\s+/)) { const x = stem(w); if (x.length >= 4 && !STOP.has(x) && !STOP.has(w) && !/^\d+$/.test(x)) out.add(x); } return out; }
function keywords(p) { return wordsOf(String(p.title || '') + ' ' + cleanMemo(p).slice(0, 500)); }
function shared(a, b) { let n = 0; for (const w of a) if (b.has(w)) n++; return n; }

// the words of a post, without the magazine's own footer line
const cleanMemo = (p) => String(p.memo || '').replace(/\(From the Romema Door 2 Door magazine[^)]*\)/gi, ' ').replace(/[📞✉️🌐]\s*\S+/g, ' ');
const textOf = (p) => String(p.title || '') + '\n' + cleanMemo(p);
const isAd = (p) => /^(magazine|aptitem|events)$/i.test(String(p.source || ''));   // an advert or a listing feed is never someone asking
function isRental(p) { return (p.types || []).some((t) => /rental/i.test(String(t))) || RENT_RE.test(textOf(p)); }
function isWanted(p) {
  const title = String(p.title || ''), t = textOf(p);
  if (/^\s*(?:wanted|seeking|looking for)\b/i.test(title)) return true;   // said plainly in the title, advert or not
  if (kindOf(p) === 'job') return !isAd(p) && JOB_SEEK_RE.test(t);   // jobs run the other way: the person looking for work is the one asking
  if (isAd(p)) return false;
  if (/\?\s*$/.test(title.trim()) && !OFFER_RE.test(title)) return true;   // a question is a request
  if (OFFER_RE.test(title)) return false;
  const head = t.split('\n').slice(0, 3).join('\n');
  if (SEEK_RE.test(head) && !OFFER_RE.test(head)) return true;
  if (!SEEK_RE.test(head) && !OFFER_RE.test(head)) return SEEK_RE.test(t) && !OFFER_RE.test(t);
  return false;
}
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
function facts(p) {
  const low = textOf(p).toLowerCase().replace(/\s+/g, ' ');
  const out = { beds: null, term: '', price: null, hoods: [], area: String(p.area || '') };
  if (typeof p.beds === 'number') out.beds = p.beds;
  else { let m; if (/\bstudio\b/.test(low)) out.beds = 0; else if ((m = low.match(/(\d+(?:\.5)?)\s*\+?\s*(?:bdrm|bdrms|bedrooms?|beds?\b|br\b)/))) out.beds = Math.round(parseFloat(m[1])); else if ((m = low.match(/\b(one|two|three|four|five|six)\s*(?:bdrm|bedrooms?|beds?\b|br\b)/))) out.beds = NUMW[m[1]]; }
  if (p.term === 'short' || p.term === 'long') out.term = p.term;
  else { const isLong = /\blong[- ]?term\b|\byearly\b|\bannual\b|\blease\b|\bunfurnished\b|\bfor the year\b|\bper month\b|\/\s*month\b/.test(low); const isShort = /\bshort[- ]?term\b|\bsukk?o[st]\b|\bsucc?o[st]\b|\bpesach\b|\bchagim\b|\bchag\b|\btishrei\b|\bvacation\b|\bweekend\b|\bshabbo?s\b|\bper night\b|\/\s*night\b|\bnightly\b/.test(low); out.term = isLong && !isShort ? 'long' : (isShort && !isLong ? 'short' : ''); }
  const pr = Number(String(p.price || '').replace(/[^\d]/g, '')); if (pr >= 100 && pr <= 200000) out.price = pr;
  const set = new Set((p.communities || []).map(String).filter((h) => h && h !== 'Jerusalem'));
  for (const h of HOODS) if (low.indexOf(h.toLowerCase()) > -1) set.add(h);
  out.hoods = [...set];
  return out;
}
function regionOf(f) { const a = f.area.toLowerCase(); if (/bet shemesh|beit shemesh/.test(a) || f.hoods.some((h) => /shemesh/i.test(h))) return 'bs'; if (/jerusalem/.test(a) || f.hoods.some((h) => !/shemesh|tel aviv|bnei brak|modi|netanya|tiberias|tzfas|haifa|ashdod|elad/i.test(h))) return 'jlm'; return a ? a.slice(0, 12) : ''; }
// how well an offer answers a request; -1 = not at all
function score(seek, offer) {
  const a = facts(seek), b = facts(offer);
  let s = 0;
  const ra = regionOf(a), rb = regionOf(b);
  if (ra && rb && ra !== rb) return -1;
  if (a.term && b.term) { if (a.term !== b.term) return -1; s += 2; } else s += 1;
  if (a.beds != null && b.beds != null) { const d = Math.abs(a.beds - b.beds); if (d > 1) return -1; s += d ? 1 : 2; } else s += 1;
  if (a.hoods.length && b.hoods.length) { if (a.hoods.some((h) => b.hoods.includes(h))) s += 3; else s += 0; } else s += 1;
  if (a.price && b.price && (a.term === b.term || !a.term || !b.term)) { if (b.price > a.price * 1.5) return -1; if (b.price <= a.price * 1.25) s += 2; }
  return s;
}
const fresh = (p) => (Number(p.created) || 0) >= Date.now() - DAYS * 24 * 3600 * 1000;
const phoneKey = (p) => String(p.contactPhone || '').replace(/\D/g, '').slice(-9);
// a job or anything else: the words they share decide (and, for the rest, a category in common)
function scoreWords(seek, offer, kind) {
  const ks = keywords(seek), ko = keywords(offer);
  const n = shared(ks, ko);
  const inTitle = shared(ks, wordsOf(offer.title));   // the request's words in the answer's own title count most
  if (kind === 'job') return (n >= 1 && inTitle >= 1) ? 3 + n * 2 : (n >= 2 ? 4 : -1);
  const cats = (seek.types || []).filter((t) => !/community|questions|person|company/i.test(String(t)) && (offer.types || []).includes(t)).length;
  if (inTitle >= 1 && n >= 2) return n * 2 + inTitle + (cats ? 2 : 0);
  if (inTitle >= 1 && cats) return 4;
  return -1;
}
function findMatches(item, recent) {
  const kind = kindOf(item);
  if (SKIP_IDS.test(String(item.id))) return [];
  const wanted = isWanted(item);
  const mine = phoneKey(item), me = String(item.author || '').trim().toLowerCase();
  const out = [];
  for (const p of recent || []) {
    if (!p || String(p.id) === String(item.id) || SKIP_IDS.test(String(p.id)) || !fresh(p) || kindOf(p) !== kind || isWanted(p) === wanted) continue;
    if ((mine && phoneKey(p) === mine) || (me && me !== 'chutznik' && String(p.author || '').trim().toLowerCase() === me)) continue;   // her own posts
    const seek = wanted ? item : p, offer = wanted ? p : item;
    const s = kind === 'rental' ? score(seek, offer) : scoreWords(seek, offer, kind);
    if (s >= 4) out.push({ p, s });
  }
  out.sort((x, y) => y.s - x.s || (Number(y.p.created) || 0) - (Number(x.p.created) || 0));
  return out.slice(0, MAX).map((x) => x.p);
}
function link(p, SITE) { return (SITE || 'https://chutznik.org') + '/post/' + (p._kind === 'up' ? 'up_' + encodeURIComponent(String(p.id)) : encodeURIComponent(String(p.slug || p.id))); }
// what she asked for or offered, in a few words, out of the title
function topic(item) {
  let t = String(item.title || '').replace(/^\s*(?:wanted|job|jobs|iso):?\s*/i, '').replace(/^\s*(?:looking for|seeking|searching for|in search of|iso|need(?:ed)?|does anyone (?:know|have)(?: of| a| an)?|anyone (?:know|have)(?: of| a| an)?|is there(?: a| an)?|any(?:body|one)|recommendations? for|recs? for)\s*/i, '').replace(/[?!.]+$/, '').trim();
  t = t.replace(/\s+[—–-]\s+.*$/, '').trim();
  const w = t.split(/\s+/).slice(0, 7).join(' ');
  return (w && /^[A-Z][a-z]/.test(w)) ? w.charAt(0).toLowerCase() + w.slice(1) : w;
}
function describe(item) {
  const f = facts(item);
  let what = f.beds === 0 ? 'a studio' : (f.beds ? 'a ' + f.beds + ' bedroom apartment' : 'an apartment');
  if (f.term) what += ' ' + (f.term === 'short' ? 'short term' : 'long term');
  if (f.hoods.length) what += ' in ' + f.hoods[0];
  return what;
}
function message(item, matches, SITE) {
  const wanted = isWanted(item), kind = kindOf(item);
  const lines = ['hi it\'s Miriam from chutznik'];
  if (kind === 'rental') {
    const what = describe(item);
    lines.push(wanted ? 'I see you\'re looking for ' + what : 'I see you\'re renting out ' + what.replace(/^an? /, 'your '));
    lines.push(wanted ? 'I found some apartments for what you posted:' : 'I found some people looking for what you posted:');
  } else if (kind === 'job') {
    const tp = topic(item);
    lines.push(wanted ? 'I see you\'re looking for work' + (tp ? ' (' + tp + ')' : '') : 'I see you\'re hiring' + (tp ? ' — ' + tp : ''));
    lines.push(wanted ? 'I found some jobs for what you posted:' : 'I found some people looking for work:');
  } else {
    const tp = topic(item) || 'that';
    lines.push(wanted ? 'I see you\'re looking for ' + tp : 'I see you posted about ' + tp);
    lines.push(wanted ? 'I found some posts that might help:' : 'I found some people looking for that:');
  }
  const t = (p) => '"' + String(p.title || '(untitled)').replace(/\s+/g, ' ').slice(0, 80) + '"';
  if (matches.length <= 2) {
    lines.push('here\'s one about ' + t(matches[0])); lines.push(link(matches[0], SITE));
    if (matches[1]) { lines.push('and another about ' + t(matches[1])); lines.push(link(matches[1], SITE)); }
  } else {
    lines.push('here\'s a few links:');
    for (const p of matches) lines.push('• ' + t(p) + '\n' + link(p, SITE));
  }
  lines.push('hatzlachah!');
  return lines.join('\n');
}
function prepare(arr, kind) { return (Array.isArray(arr) ? arr : []).filter((p) => p && (!p.status || p.status === 'public') && fresh(p) && !SKIP_IDS.test(String(p.id))).map((p) => Object.assign({}, p, { _kind: kind })); }
async function fetchRecent(SITE) {
  const base = (SITE || 'https://chutznik.org').replace(/\/$/, '');
  const get = async (q) => { try { const r = await fetch(base + '/api/live-data?type=' + q, { signal: AbortSignal.timeout(20000) }); return r.ok ? await r.json() : []; } catch (e) { return []; } };
  const [ups, posts] = await Promise.all([get('updates'), get('posts')]);
  return prepare(ups, 'up').concat(prepare(posts, 'post'));
}
// a poster we only know by the words of her message (jerusaguide)
function itemFromText(subject, text) { const t = String(subject || '') + '\n' + String(text || ''); const types = RENT_RE.test(t) ? ['Rental'] : (JOB_RE.test(t) ? ['Jobs'] : []); return { id: 'mail', title: String(subject || '').slice(0, 120), memo: String(text || '').slice(0, 3000), types, author: '' }; }

module.exports = { fetchRecent, findMatches, message, isRental, isWanted, kindOf, facts, describe, topic, itemFromText, prepare, link };

if (require.main === module) {
  const fs = require('fs'); const args = process.argv.slice(2); const opt = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : ''; };
  const SITE = opt('--site') || 'https://chutznik.org';
  (async () => {
    let recent;
    if (opt('--updates')) recent = prepare(JSON.parse(fs.readFileSync(opt('--updates'), 'utf8')), 'up').concat(opt('--posts') ? prepare(JSON.parse(fs.readFileSync(opt('--posts'), 'utf8')), 'post') : []);
    else recent = await fetchRecent(SITE);
    const only = opt('--kind');
    const seek = recent.filter(isWanted), offer = recent.filter((p) => !isWanted(p));
    console.log('posts in the last ' + DAYS + ' days: ' + recent.length + ' · asking: ' + seek.length + ' · offering: ' + offer.length + ' · rentals ' + recent.filter((p) => kindOf(p) === 'rental').length + ', jobs ' + recent.filter((p) => kindOf(p) === 'job').length + '\n');
    let n = 0;
    for (const it of recent) { if (only && kindOf(it) !== only) continue; const m = findMatches(it, recent); if (!m.length) continue; n++; console.log('══ ' + kindOf(it).toUpperCase() + ' ' + (isWanted(it) ? 'LOOKING' : 'OFFER') + ' · ' + it.title + '  [' + it._kind + ' ' + it.id + ']'); console.log(message(it, m, SITE).split('\n').map((l) => '   ' + l).join('\n') + '\n'); }
    console.log(n + ' poster(s) would get a note');
  })();
}
