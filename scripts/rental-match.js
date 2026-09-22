// ── Rental matches (Miriam, 22 Sep 2026) ─────────────────────────────────────
// People looking for an apartment meet the apartments on offer, and owners
// meet the people looking — from posts at most three days old — and a note
// in Miriam's voice carries the links. Used by the bridge (the WhatsApp note
// to a poster) and by the jerusaguide mailer.
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

const textOf = (p) => String(p.title || '') + '\n' + String(p.memo || '');
function isRental(p) { return (p.types || []).some((t) => /rental/i.test(String(t))) || RENT_RE.test(textOf(p)); }
function isWanted(p) {
  const title = String(p.title || ''), t = textOf(p);
  if (/^\s*wanted\b/i.test(title)) return true;
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
function findMatches(item, recent) {
  if (!isRental(item)) return [];
  const wanted = isWanted(item);
  const mine = phoneKey(item), me = String(item.author || '').trim().toLowerCase();
  const out = [];
  for (const p of recent || []) {
    if (!p || String(p.id) === String(item.id) || !fresh(p) || !isRental(p) || isWanted(p) === wanted) continue;
    if ((mine && phoneKey(p) === mine) || (me && me !== 'chutznik' && String(p.author || '').trim().toLowerCase() === me)) continue;   // her own posts
    const s = wanted ? score(item, p) : score(p, item);
    if (s >= 4) out.push({ p, s });
  }
  out.sort((x, y) => y.s - x.s || (Number(y.p.created) || 0) - (Number(x.p.created) || 0));
  return out.slice(0, MAX).map((x) => x.p);
}
function link(p, SITE) { return (SITE || 'https://chutznik.org') + '/post/' + (p._kind === 'up' ? 'up_' + encodeURIComponent(String(p.id)) : encodeURIComponent(String(p.slug || p.id))); }
function describe(item) {
  const f = facts(item);
  let what = f.beds === 0 ? 'a studio' : (f.beds ? 'a ' + f.beds + ' bedroom apartment' : 'an apartment');
  if (f.term) what += ' ' + (f.term === 'short' ? 'short term' : 'long term');
  if (f.hoods.length) what += ' in ' + f.hoods[0];
  return what;
}
function message(item, matches, SITE) {
  const wanted = isWanted(item);
  const what = describe(item);
  const lines = ['hi it\'s Miriam from chutznik'];
  lines.push(wanted ? 'I see you\'re looking for ' + what : 'I see you\'re renting out ' + what.replace(/^an? /, 'your '));
  lines.push(wanted ? 'I found some apartments for what you posted:' : 'I found some people looking for what you posted:');
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
function prepare(arr, kind) { return (Array.isArray(arr) ? arr : []).filter((p) => p && (!p.status || p.status === 'public') && fresh(p) && isRental(p)).map((p) => Object.assign({}, p, { _kind: kind })); }
async function fetchRecent(SITE) {
  const base = (SITE || 'https://chutznik.org').replace(/\/$/, '');
  const get = async (q) => { try { const r = await fetch(base + '/api/live-data?type=' + q, { signal: AbortSignal.timeout(20000) }); return r.ok ? await r.json() : []; } catch (e) { return []; } };
  const [ups, posts] = await Promise.all([get('updates'), get('posts')]);
  return prepare(ups, 'up').concat(prepare(posts, 'post'));
}
// a poster we only know by the words of her message (jerusaguide)
function itemFromText(subject, text) { return { id: 'mail', title: String(subject || '').slice(0, 120), memo: String(text || '').slice(0, 3000), types: [], author: '' }; }

module.exports = { fetchRecent, findMatches, message, isRental, isWanted, facts, describe, itemFromText, prepare, link };

if (require.main === module) {
  const fs = require('fs'); const args = process.argv.slice(2); const opt = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : ''; };
  const SITE = opt('--site') || 'https://chutznik.org';
  (async () => {
    let recent;
    if (opt('--updates')) recent = prepare(JSON.parse(fs.readFileSync(opt('--updates'), 'utf8')), 'up').concat(opt('--posts') ? prepare(JSON.parse(fs.readFileSync(opt('--posts'), 'utf8')), 'post') : []);
    else recent = await fetchRecent(SITE);
    const seek = recent.filter(isWanted), offer = recent.filter((p) => !isWanted(p));
    console.log('rentals in the last ' + DAYS + ' days: ' + recent.length + ' · looking: ' + seek.length + ' · offering: ' + offer.length + '\n');
    let n = 0;
    for (const it of recent) { const m = findMatches(it, recent); if (!m.length) continue; n++; console.log('══ ' + (isWanted(it) ? 'LOOKING' : 'OFFER') + ' · ' + it.title + '  [' + it._kind + ' ' + it.id + ']'); console.log(message(it, m, SITE).split('\n').map((l) => '   ' + l).join('\n') + '\n'); }
    console.log(n + ' poster(s) would get a note');
  })();
}
