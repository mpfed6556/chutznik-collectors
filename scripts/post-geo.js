// ── Every post with an address, on the Buildings map (Miriam, 6 Nov 2026: "put all posts from past and future Chutznik that
//    have an address show on the map"). The droplet knows every building's address from the squares it handed the site; it
//    reads the posts, finds a street and number that really exist ("Shamgar 12", "12 Panim Meirot", "שמגר 12") and hands the
//    site where each post belongs. Only an address that matches a real building counts — a bare street or a guess never does.
'use strict';
const SITE = (process.env.INGEST_URL || 'https://chutznik.org/api/ingest-whatsapp').replace(/\/api\/.*/, '');
const KEY = process.env.INGEST_KEY || '';
let LOG = (s) => console.log(s);
const ROWS = 16, COLS = 14;

const normHe = (s) => String(s || '').replace(/["'״׳`]/g, '').replace(/^(?:רחוב|רח|שדרות|שד)\s+/, '').replace(/\s+/g, ' ').trim();
const normEn = (s) => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/\b(?:st|street|str|rd|road|rechov|rehov|blvd|ave|avenue)\b\.?/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const skel = (s) => normEn(s).replace(/\bha\s*/g, '').replace(/tz|ts|z/g, 'z').replace(/ch|kh|h/g, 'h').replace(/v|w/g, 'v').replace(/k|q|c/g, 'k').replace(/[aeiouy ]/g, '').replace(/(.)\1+/g, '$1');

// the address book: Hebrew street → number → place; and every English spelling the map knows for that street
function buildIndex(tiles, cityNames) {
  const addr = new Map();
  for (const t of tiles) {
    if (!t || !Array.isArray(t.b) || !Array.isArray(t.o)) continue;
    const o = t.o, sc = t.sc || 1e5;
    for (const x of t.b) {
      const a = String(x[3] || ''); if (a.indexOf('|') < 0) continue;
      const [st, numS] = a.split('|'); const k = normHe(st); if (!k || !numS) continue;
      let y = 0, xx = 0, cy = 0, cx = 0, n = 0; for (let q = 4; q + 1 < x.length; q += 2) { y += x[q]; xx += x[q + 1]; cy += y; cx += xx; n++; }
      if (!n) continue;
      const lat = +(o[0] + cy / n / sc).toFixed(6), lon = +(o[1] + cx / n / sc).toFixed(6);
      const m = addr.get(k) || new Map(); addr.set(k, m);
      const parts = String(numS).split(/[–\-,]/).map((p) => p.trim()).filter(Boolean);
      const nums = new Set([String(numS).trim()]);
      for (const p of parts) { nums.add(p); const d = (p.match(/^\d+/) || [])[0]; if (d) nums.add(d); }
      if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) && +parts[1] > +parts[0] && +parts[1] - +parts[0] <= 8) for (let v = +parts[0]; v <= +parts[1]; v++) nums.add(String(v));
      for (const v of nums) if (!m.has(v)) m.set(v, [lat, lon, st + ' ' + numS]);
    }
  }
  const en = new Map(), sk = new Map(), enName = new Map();
  for (const nm of cityNames || []) {
    const e = nm && nm[0], h = nm && nm[1]; if (!e || !h) continue; const hk = normHe(h); if (!addr.has(hk)) continue;
    // Yaffo, never Jaffa, on every address this writes (27 Nov 2026); 'jaffa' stays below as a way people write it
    en.set(normEn(e), hk); enName.set(hk, String(e).replace(/\bJaffa\b/g, 'Yaffo'));
    const s = skel(e); if (s.length >= 3) { if (sk.has(s) && sk.get(s) !== hk) sk.set(s, null); else sk.set(s, hk); }
  }
  // spellings people use that the map does not ("Touval 7" is the map's Tuval 7: 26 Nov 2026, the Meuchedet clinic that moved there)
  for (const [alias, he] of [['touval', 'תובל'], ['tuval', 'תובל']]) { const hk = normHe(he); if (addr.has(hk) && !en.has(alias)) en.set(alias, hk); }
  // "Sderot Eshkol" is Levi Eshkol, the boulevard of Ramat Eshkol — not the one-house HaEshkol lane the bare word finds (Miriam,
  // 26 Nov 2026, a sale at "10 Sderot Eshkol": "why doesn't it have a map icon with the address")
  // Jaffa Road the way people here write it (27 Nov 2026: "Yaffo 180", "Yaffo 208" stood nowhere)
  for (const alias of ['yaffo', 'yafo', 'jaffa', 'jaffa road', 'rechov yaffo', 'derech yaffo']) { const hk = normHe('יפו'); if (addr.has(hk) && !en.has(alias)) en.set(alias, hk); }
  for (const [alias, he] of [['chaggai', 'חגי'], ['chagai', 'חגי'], ['shpitzer', 'שפיצר'], ['spitzer', 'שפיצר'], ['pitchiya', 'פתחיה'], ['pesachya', 'פתחיה'], ['alkabetz', 'אלקבץ']]) { const hk = normHe(he); if (addr.has(hk) && !en.has(alias)) en.set(alias, hk); }
  for (const alias of ['sderot eshkol', 'sderos eshkol', 'shderot eshkol', 'sd eshkol', 'sderot levi eshkol', 'sderos levi eshkol', 'shderot levi eshkol', 'sd levi eshkol']) { const hk = normHe('לוי אשכול'); if (addr.has(hk)) en.set(alias, hk); }
  return { addr, en, sk, enName };
}

const HE_RE = /([\u05d0-\u05ea][\u05d0-\u05ea"'׳״\- ]{1,30}?)\s+(\d{1,3}[\u05d0-\u05ea]?)(?![\d:\/.]\d|\s*(?:ש"ח|שח|₪|%|שקל|דקות|שעות|חדרים|קומה))/g;
const EN_A = /\b([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,3})\s+(?:St\.?|Street|Rd\.?|Road)?\s*#?(\d{1,3}[a-zA-Z]?)\b(?![:\/.,]?\d|\s*(?:am|pm|nis|₪|%|shekel|rooms?|bdrm|bedrooms?|years?|yrs|min|minutes|hours?|kg|cm|m2|sqm|people|kids|children|floor|th\b|st\b|nd\b|rd\b))/g;
const EN_B = /(?:^|[^\d₪$:\/.])(\d{1,3}[a-zA-Z]?)\s+([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,3})/g;

const NOT_STREET = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday|shabbos|shabbat|day|week|room|rooms|bus|line|floor|apt|apartment|age|ages|grade|size|page|chapter|kislev|tishrei|cheshvan|teves|tevet|shevat|adar|nissan|iyar|sivan|tammuz|av|elul)$/;
function lookupStreet(ix, words, he) {
  for (let k = Math.min(4, words.length); k >= 1; k--) {
    const cand = words.slice(-k).join(' ');
    if (he) { const h = normHe(cand); if (ix.addr.has(h)) { lookupStreet.k = k; return h; } const h2 = h.replace(/^[בלמה]/, ''); if (h2 !== h && ix.addr.has(h2)) { lookupStreet.k = k; return h2; } continue; }
    const e = normEn(cand); if (!e || NOT_STREET.test(e)) continue;   // "Nov 6" is a date, though Jerusalem has a Nov Street
    if (ix.en.has(e)) { lookupStreet.k = k; return ix.en.get(e); }
    const s = skel(cand); if (s.length >= 4 && ix.sk.get(s)) { lookupStreet.k = k; return ix.sk.get(s); }
    // the Ashkenazi way of saying it (26 Nov 2026: "Ponim Meiros 16", "Reishis Chochmah" found no street): a closing s is a t
    const a = skel(cand.replace(/s\b/gi, 't').replace(/\b(?:bais|beis)\b/gi, 'beit').replace(/oi|oy/gi, 'o')); if (a !== s && a.length >= 4 && ix.sk.get(a)) { lookupStreet.k = k; return ix.sk.get(a); }
    // a closing h that the map does not write (27 Nov 2026: "Imrei Binah 19", "Reishis Chochmah 23")
    for (const v of [s, a]) { const b = v.replace(/h$/, ''); if (b !== v && b.length >= 4 && ix.sk.get(b)) { lookupStreet.k = k; return ix.sk.get(b); } }
  }
  return null;
}
function aboutSpot(m, num) {
    const n = parseInt(String(num), 10); if (!(n >= 1) || /^0/.test(String(num))) return null;
    let lo = null, hi = null;
    for (const [k, g] of m) { if (!/^\d+$/.test(k)) continue; const v = +k; if ((v - n) % 2 !== 0) continue; if (v < n && n - v <= 12 && (!lo || v > lo.v)) lo = { v, g }; if (v > n && v - n <= 12 && (!hi || v < hi.v)) hi = { v, g }; }
    if (lo && hi) { const f = (n - lo.v) / (hi.v - lo.v); const d = Math.hypot((hi.g[0] - lo.g[0]) * 111000, (hi.g[1] - lo.g[1]) * 94000); if (d < 400) return [lo.g[0] + (hi.g[0] - lo.g[0]) * f, lo.g[1] + (hi.g[1] - lo.g[1]) * f]; }
    let best = null; for (const [k, g] of m) { if (!/^\d+$/.test(k)) continue; const d = Math.abs(+k - n); if (d && d <= 2 && (!best || d < best.d)) best = { d, g }; }
    if (best) return [best.g[0], best.g[1]];
    const one = lo || hi; return one && Math.abs(one.v - n) <= 4 ? [one.g[0], one.g[1]] : null;
  }
function findAddress(ix, text) {
  const t = String(text || '').replace(/<[^>]+>/g, ' ').slice(0, 6000);
  // A number the map's address book does not carry (26 Nov 2026, Miriam: "there's literally a Meuchedet right next door" — the
  // clinic is at Yirmiyahu 19; the book has 18 and 20 but no 19, so it stood nowhere). The spot is then worked out from the
  // street's own numbers: halfway between the nearest numbers on the same side (13 and 25 → 19), or beside the house one or
  // two numbers away. Never further than that, and the label says "about".
  const about = aboutSpot;
  const hit = (hk, num) => { const m = ix.addr.get(hk); if (!m) return null; const n = String(num).replace(/[a-z]$/i, ''); const g = m.get(String(num)) || m.get(n); if (g) return { lat: g[0], lon: g[1], label: (ix.enName.get(hk) || hk) + ' ' + num };
    const a = about(m, n); return a ? { lat: +a[0].toFixed(6), lon: +a[1].toFixed(6), label: 'about ' + (ix.enName.get(hk) || hk) + ' ' + num, about: true } : null; };
  let m, soft = null;
  const CUE = /📍|\baddress\b|\blocat(?:ed|ion)\b|\bstreet\b|\bst\.?(?=\s|,|$)|\bre[ck]?hov\b|\bcorner of\b|רחוב|רח['׳]|כתובת|מיקום/i;
  const lineAt = (i) => { const a = t.lastIndexOf('\n', i - 1) + 1; let b = t.indexOf('\n', i); if (b < 0) b = t.length; return t.slice(a, b); };
  const take = (g) => { if (g && !g.about) return g; if (g && !soft && m && CUE.test(lineAt(m.index))) soft = g; return null; };
  HE_RE.lastIndex = 0; while ((m = HE_RE.exec(t))) { const words = m[1].trim().split(/\s+/); const hk = lookupStreet(ix, words, true); if (hk) { const g = take(hit(hk, m[2])); if (g) return g; } }
  EN_A.lastIndex = 0; while ((m = EN_A.exec(t))) { const words = m[1].trim().split(/\s+/); const hk = lookupStreet(ix, words, false); if (hk) { const g = take(hit(hk, m[2])); if (g) return g; } }
  EN_B.lastIndex = 0; while ((m = EN_B.exec(t))) { const words = m[2].trim().split(/\s+/); for (let k = Math.min(4, words.length); k >= 1; k--) { const hk = lookupStreet(ix, words.slice(0, k), false); if (hk) { const g = take(hit(hk, m[1])); if (g) return g; break; } } }
  return soft;
}
// Every address a post's own words name, each with the words exactly as written (Miriam, 27 Nov 2026: "show each mention of an
// address as mini green ones"). Only a street and a number that really stand in the address book: never a worked-out spot.
function findAll(ix, text) {
  const t = String(text || '').replace(/<[^>]+>/g, ' ').slice(0, 9000); const out = []; const seen = new Set(); let m;
  const hit = (hk, num) => { const b = ix.addr.get(hk); if (!b) return null; const n = String(num).replace(/[a-z]$/i, ''); const g = b.get(String(num)) || b.get(n); if (g) return { lat: g[0], lon: g[1], label: (ix.enName.get(hk) || hk) + ' ' + num };
    const a = aboutSpot(b, n); return a ? { lat: +a[0].toFixed(6), lon: +a[1].toFixed(6), label: 'about ' + (ix.enName.get(hk) || hk) + ' ' + num } : null; };
  const add = (g, raw) => { raw = String(raw || '').trim(); if (!g || raw.length < 4 || raw.length > 60 || /\n/.test(raw) || seen.has(raw)) return; seen.add(raw); out.push([raw, g.lat, g.lon, g.label.slice(0, 60)]); };
  // the last k words of a run, as they stand in the text
  const tailFrom = (run, k) => { const re = /\S+/g; const at = []; let w; while ((w = re.exec(run))) at.push(w.index); return at.length >= k ? at[at.length - k] : 0; };
  const headTo = (run, k) => { const re = /\S+/g; let w, n = 0, end = run.length; while ((w = re.exec(run))) { n++; if (n === k) { end = w.index + w[0].length; break; } } return end; };
  HE_RE.lastIndex = 0; while ((m = HE_RE.exec(t)) && out.length < 12) { const words = m[1].trim().split(/\s+/); lookupStreet.k = 0; const hk = lookupStreet(ix, words, true); if (!hk) continue; const g = hit(hk, m[2]); if (!g) continue; const lead = m[1].length - m[1].trimStart().length; const run = m[1].trim(); add(g, t.slice(m.index + lead + tailFrom(run, lookupStreet.k || words.length), m.index + m[0].length)); }
  EN_A.lastIndex = 0; while ((m = EN_A.exec(t)) && out.length < 12) { const words = m[1].trim().split(/\s+/); lookupStreet.k = 0; const hk = lookupStreet(ix, words, false); if (!hk) continue; const g = hit(hk, m[2]); if (!g) continue; add(g, t.slice(m.index + tailFrom(m[1], lookupStreet.k || words.length), m.index + m[0].length)); }
  EN_B.lastIndex = 0; while ((m = EN_B.exec(t)) && out.length < 12) { const words = m[2].trim().split(/\s+/); let hk = null, kk = 0; for (let k = Math.min(4, words.length); k >= 1; k--) { lookupStreet.k = 0; const h = lookupStreet(ix, words.slice(0, k), false); if (h && lookupStreet.k === k) { hk = h; kk = k; break; } } if (!hk) continue; const g = hit(hk, m[1]); if (!g) continue;
    const s0 = m.index + m[0].indexOf(m[1]); const w0 = m.index + m[0].lastIndexOf(m[2]); add(g, t.slice(s0, w0 + headTo(m[2], kk))); }
  return out;
}
function allAddresses(ix, updates, posts) {
  const out = {};
  const each = (p, key) => { if (!p || p.deleted || (p.status && p.status !== 'public')) return; const L = findAll(ix, [p.memo, p.memoHTML].filter(Boolean).join('\n')); if (L.length) out[key] = L; };
  for (const u of updates || []) each(u, 'up_' + u.id);
  for (const p of posts || []) if (p && !p._ad && !p._cfg) each(p, String(p.id));
  return out;
}
// ── A post held at a well-known place (Miriam, 15 Nov 2026, a flyer reading "ALL @ TACHANA RISHONA": "should show on map,
//    all such instances"). A post with no street address that names one of these places as where it happens is put there.
//    Each place's spot is its own on OpenStreetMap (looked up 15 Nov 2026); three are found by their address in the map's
//    own address book. "Near the shuk" or "5 minutes from Mamilla" is not "at": a place counts only when the words before it
//    say so (@, 📍, at, in, Location:, ב…) or it stands at the head of a line — and never on a rental.
const VENUES = [
  ['The First Station', /\bfirst station\b|\btachana\s+(?:ha)?rishona\b|התחנה הראשונה/i, 31.766333, 35.224783],
  ['Beit Avi Chai', /\bbeit avi cha?i\b|בית אבי חי/i, 31.777427, 35.215856],
  ['Pardes Institute', /\bpardes\b(?!\s+(?:chana|hanna|hana|katz))/i, 31.754384, 35.214799],
  ['Israel Museum', /\bisrael museum\b|מוזיאון ישראל/i, 31.771888, 35.203387],
  ['Ramot Mall', /\bramot mall\b|קניון רמות/i, 31.817516, 35.194487],
  ['Binyanei HaUma', /\bbinyanei ha'?uma\b|בנייני האומה|\binternational convention cent(?:er|re)\b/i, 31.786256, 35.20264],
  ['Cinema City', /\bcinema city\b|סינמה סיטי/i, 31.782675, 35.203903],
  ['Jerusalem Theatre', /\bjerusalem theat(?:re|er)\b|תיאטרון ירושלים/i, 31.768918, 35.215517],
  ['Heichal Shlomo', /\bheichal shlomo\b|היכל שלמה/i, 31.775668, 35.217006],
  ['Great Synagogue', /\bgreat synagogue\b(?!\s+of\s+belz)|בית הכנסת הגדול(?!\s*(?:של|ד)?\s*בעלז)/i, 31.775766, 35.216598],
  ['Pais Arena', /\bpais arena\b|\bjerusalem arena\b|פיס ארנה/i, 31.751277, 35.194106],
  ['Teddy Stadium', /\bteddy stadium\b|אצטדיון טדי/i, 31.75112, 35.190833],
  ['Sacher Park', /\bsacher park\b|\bgan sacher\b|גן סאקר/i, 31.779868, 35.207583],
  ['Liberty Bell Park', /\bliberty bell park\b|\bgan hapa'?amon\b|גן הפעמון/i, 31.770045, 35.223178],
  ['Mamilla Mall', /\bmamilla (?:mall|avenue)\b|קניון ממילא/i, 31.777653, 35.223874],
  ['Malha Mall', /\bmal[ck]?ha mall\b|קניון מלחה/i, 31.75166, 35.18739],
  ['Machane Yehuda Market', /\bma[ck]?hane yehuda\b|שוק מחנה יהודה/i, 31.784806, 35.212372],
  ['Tower of David', /\btower of david\b|מגדל דוד/i, 31.776039, 35.228302],
  ['Bible Lands Museum', /\bbible lands museum\b|מוזיאון ארצות המקרא/i, 31.774909, 35.202449],
  ['Bloomfield Science Museum', /\bscience museum\b|מוזיאון המדע/i, 31.77838, 35.200232],
  ['Biblical Zoo', /\bbiblical zoo\b|גן החיות התנ"?כי/i, 31.746483, 35.176463],
  ['Botanical Gardens', /\bbotanical gardens?\b|הגן הבוטני/i, 31.770053, 35.199969],
  ['Ammunition Hill', /\bammunition hill\b|גבעת התחמושת/i, 31.798159, 35.22784],
  ['Friends of Zion Museum', /\bfriends of zion\b/i, 31.780134, 35.220184],
  ['Waldorf Astoria', /\bwaldorf astoria\b/i, 31.777351, 35.221518],
  ['King David Hotel', /\bking david hotel\b|מלון המלך דוד/i, 31.774348, 35.222516],
  ['Inbal Hotel', /\binbal (?:jerusalem )?hotel\b|מלון ענבל/i, 31.77052, 35.221899],
  ['Begin Heritage Center', /\bbegin (?:heritage )?cent(?:er|re)\b|מרכז (?:מורשת )?(?:מנחם )?בגין/i, 31.769269, 35.225438],
  ['Cinematheque', /\bcinematheque\b|סינמטק/i, 31.769878, 35.226015],
  ['Khan Theatre', /\bkhan theat(?:re|er)\b|תיאטרון החאן/i, 31.768412, 35.224836],
  ['Hansen House', /\bhansen house\b|בית הנסן/i, 31.767681, 35.216801],
  ['Gerard Behar Center', /\bgerard be[ch]+ar\b|ז'?ראר בכר/i, 31.780661, 35.212812],
  ['Safra Square', /\bsafra square\b|\bkikar safra\b|כיכר ספרא/i, 31.780321, 35.223731],
  ['Zion Square', /\bzion square\b|\bkikar t?zion\b|כיכר ציון/i, 31.781965, 35.219567],
  ['Hadar Mall', /\bhadar mall\b|קניון הדר/i, 31.753353, 35.213477],
  ['Yad Vashem', /\byad vashem\b|יד ושם/i, 31.774069, 35.174915],
  ['Mount Herzl', /\b(?:har|mount|mt\.?) herzl\b|הר הרצל/i, 31.772361, 35.181634],
  ['Nishmat', /\bnishmat\b/i, 31.748765, 35.20248],
  ['Ohr Somayach', /\bohr som[ae]y?ach\b/i, 31.793917, 35.225732],
  ['Hurva Synagogue', /\bhurva\b|בית הכנסת החורבה/i, 31.775333, 35.231344],
  ['Museum of Tolerance', /\bmuseum of tolerance\b|מוזיאון הסובלנות/i, 31.779131, 35.220072],
  ["Sultan's Pool", /\bsultan'?s pool\b|בריכת הסולטן/i, 31.771786, 35.226253],
  ['Haas Promenade', /\bhaas promenade\b|טיילת האס/i, 31.754737, 35.231248],
  ['Independence Park', /\bindependence park\b|\bgan ha'?atzma'?ut\b|גן העצמאות/i, 31.777408, 35.21853],
  ['Train Theater', /\btrain theat(?:re|er)\b|תיאטרון הקרון/i, 31.768439, 35.2225],
  ["Mishkenot Sha'ananim", /\bmishkenot sha'?ananim\b|משכנות שאננים/i, 31.770863, 35.224919],
  ['YMCA', /\bymca\b|ימק"?א/i, 31.774287, 35.221463],
  ['Shaare Zedek', /\bsha'?are[iy]? [tz]+edek\b|שערי צדק/i, 31.773036, 35.185597],
  ['Nitzanim Shul', /\bnitzanim (?:shul|synagogue)\b/i, 31.759042, 35.216244],
  // these three by their address in the map's own book
  ['OU Israel Center', /\bou israel cent(?:er|re)\b/i, 'קרן היסוד', '22'],
  ['Kivun Center', /\bkivun cent(?:er|re)\b|מרכז כיוון/i, 'הצבי', '5'],
  ['Romema Community Center', /\bromema community (?:cent(?:er|re)|council|administration)\b|מי?נהל ה?קהילתי רוממה|\b02[-\s]?313[-\s]?2275\b/i, 'זכרון יעקב', '5'],
];
// a place that runs its own events (Miriam, 15 Nov 2026, an event of the Romema community centre that only named it as the
// organiser: no "View on map"): on an event, its name anywhere is enough — the organiser's own hall is where it is held
const V_HOSTS = new Set(['Romema Community Center', 'OU Israel Center', 'Beit Avi Chai', 'Pardes Institute', 'Nishmat', 'Kivun Center', 'Begin Heritage Center', 'Israel Museum', 'Bible Lands Museum', 'Bloomfield Science Museum',
  'Tower of David', 'Friends of Zion Museum', 'Botanical Gardens', 'Biblical Zoo', 'Cinematheque', 'Khan Theatre', 'Jerusalem Theatre', 'Train Theater', 'Hansen House', 'Museum of Tolerance', 'Yad Vashem']);
const V_NEAR = /(?:\bnear(?:by)?|\bclose to|\bnext to|\bsteps? (?:from|to|away)|\bwalk(?:ing)?(?: distance)?(?: from| to)?|\bmin(?:ute)?s?\.? (?:from|to|walk|away)|\bacross from|\bopposite|\bbehind|\bbeside|\bby the|\btoward|\bview of|\boverlooking|\bbetween|\bdeliver\w*(?: to)?|ליד|קרוב|סמוך|מול|דקות|הליכה|משלוח\w*)[^\n.!?]{0,40}$/i;
const V_AT = /(?:@|📍|\bat|\bin|\binside|\bvenue|\blocation|\bwhere|\bplace|\bmeet(?:ing)? (?:at|in)|מיקום|מקום|כתובת|איפה)\s*[:\-–]?\s*(?:the\s+|ה)?(?:new\s+|beautiful\s+|famous\s+)?[*_"“]*$|(?:^|[\s(])[בל]ה?$/i;
const V_RENTAL = /rent|apartment|sublet|real estate|housing|דירה|השכרה/i;
function findVenue(ix, p) {
  if (!p || V_RENTAL.test([].concat(p.types || [], p.category || []).join(' '))) return null;
  const t = [p.title, p.memo, p.picText].filter(Boolean).join('\n').replace(/<[^>]+>/g, ' ').slice(0, 6000);
  const titleLen = String(p.title || '').length;
  // a trip or tour is held somewhere else than its organiser's hall or the office that takes the bookings: only a place in its title counts
  const isTour = /\b(?:tours?|trips?|outing|hike|excursion)\b|טיול|סיור|נסיעה/i.test(String(p.title || '') + ' ' + String(p.memo || '').slice(0, 400));
  const isEvent = /event/i.test([].concat(p.types || [], p.category || []).join(' '));
  for (const v of VENUES) {
    const re = new RegExp(v[1].source, 'gi'); let m;
    while ((m = re.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 60), m.index); const line = before.slice(before.lastIndexOf('\n') + 1);
      if (V_NEAR.test(line)) continue;
      const atHead = /^[\s*_•·\-–—:|]*$/.test(line);
      const inTitle = m.index < titleLen, host = isEvent && V_HOSTS.has(v[0]);
      if (isTour && !inTitle) continue;
      if (/^[\d\s-]+$/.test(m[0]) ? !host : !(V_AT.test(line) || atHead || inTitle || host)) continue;   // a phone number alone says who runs it, not where: only for a host's own event
      if (typeof v[2] === 'number') return { lat: v[2], lon: v[3], label: v[0] };
      const book = ix && ix.addr && ix.addr.get(normHe(v[2])); const g = book && book.get(String(v[3]));
      if (g) return { lat: g[0], lon: g[1], label: v[0] };
      break;
    }
  }
  return null;
}
// a health fund's branch, named by its street: "Meuchedet clinic - Yirmiyahu 19", "at the Meuchedet Yirmiyahu clinic"
const FUND = '(meu[c]?hedet|maccabi|clalit|leumit)';
const BRANCH_A = new RegExp('\\b' + FUND + '\\s+((?:[A-Z][A-Za-z\'’-]+\\s+){1,3})(?:clinic|branch|center|centre)\\b', 'i');
const BRANCH_B = new RegExp('\\b' + FUND + '\\b[^\\n]{0,24}?\\b(?:clinic|branch)\\s*[-–—:,]\\s*((?:[A-Z][A-Za-z\'’-]+\\s*){1,3})\\b', 'i');
function branchKey(text) { const t = String(text || ''); const m = BRANCH_A.exec(t) || BRANCH_B.exec(t); if (!m) return ''; const st = skel(m[2].replace(/s\b/gi, 't')); return st.length >= 3 ? m[1].toLowerCase().replace('meuhedet', 'meuchedet') + '|' + st : ''; }
function geocodePosts(ix, updates, posts) {
  const out = {}; const later = []; const branches = new Map();
  const each = (p, key) => {
    if (!p || p.deleted || (p.status && p.status !== 'public')) return;
    // the title and the address field are addresses by their place: marked, so a number the map lacks may be worked out there
    const text = [p.title ? '📍 ' + p.title : '', p.memo, p.contactAddress ? '📍 ' + p.contactAddress : '', p.picText].filter(Boolean).join('\n');
    const g = findAddress(ix, text) || findVenue(ix, p);   // a street address first; failing that, the place it is held at
    if (g) { out[key] = [g.lat, g.lon, g.label.slice(0, 60)]; const bk = branchKey(String(p.title || '')); if (bk && !branches.has(bk)) branches.set(bk, out[key]); }
    else later.push([p, key, text]);
  };
  for (const u of updates || []) each(u, 'up_' + u.id);
  for (const p of posts || []) if (p && !p._ad && !p._cfg) each(p, String(p.id));
  // whoever works at a branch that is on the map stands where the branch stands
  for (const [p, key, text] of later) { const bk = branchKey(text); const g = bk && branches.get(bk); if (g) out[key] = [g[0], g[1], String(g[2]).slice(0, 60)]; }
  return out;
}

async function getJson(url) { try { const r = await fetch(url, { headers: { 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' }, signal: AbortSignal.timeout(120000) }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
let _running = false, _ix = null, _ixAt = 0, _lastSig = '';
async function run() {
  if (_running) return; _running = true;
  try {
    // the address book is read once a day (224 squares); between readings only the posts are read, so a new post is on the map
    // within the hour instead of three (26 Nov 2026)
    if (!_ix || Date.now() - _ixAt > 24 * 3600 * 1000) {
      const city = await getJson(SITE + '/api/live-data?type=buildings&part=city');
      const tiles = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const t = await getJson(SITE + '/api/live-data?type=buildings&part=tile&t=' + r + '_' + c); if (t && Array.isArray(t.b) && t.b.length) tiles.push(t); }
      if (!tiles.length) { LOG('📍 post map: no building squares yet'); return; }
      _ix = buildIndex(tiles, city && city.names); _ixAt = Date.now();
    }
    const ix = _ix;
    const [ups, posts] = await Promise.all([getJson(SITE + '/api/live-data?type=updates&t=' + Date.now()), getJson(SITE + '/api/live-data?type=posts&t=' + Date.now())]);
    if (!Array.isArray(ups)) { LOG('📍 post map: could not read the posts'); return; }
    const map = geocodePosts(ix, ups, Array.isArray(posts) ? posts : []);
    const n = Object.keys(map).length;
    let all = {}; try { all = allAddresses(ix, ups, Array.isArray(posts) ? posts : []); } catch (e) { all = {}; }
    const sig = JSON.stringify([map, all]); if (sig === _lastSig) return;   // nothing moved since the last save: no write
    // the save is tried again when the site is busy (15 Nov 2026: a save lost to a busy moment left the map three hours behind)
    let r = null;
    for (let a = 0; a < 4; a++) {
      try { r = await fetch(SITE + '/api/live-data?type=buildings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-key': KEY, 'User-Agent': 'chutznik-bridge' }, body: JSON.stringify({ postgeo: { at: Date.now(), map, all } }), signal: AbortSignal.timeout(60000) }); } catch (e) { r = null; }
      if (r && r.ok) { _lastSig = sig; break; }
      await new Promise((ok) => setTimeout(ok, 45000 * (a + 1)));
    }
    LOG('📍 post map: ' + n + ' posts with an address placed (' + ix.addr.size + ' streets known)' + (r && r.ok ? '' : ' — the site answered ' + (r ? r.status : 'nothing') + ', after four tries'));
  } catch (e) { LOG('📍 post map: ' + (e && e.message)); } finally { _running = false; }
}
function start(log) { if (log) LOG = log; setTimeout(() => run().catch(() => {}), 8 * 60 * 1000); setInterval(() => run().catch(() => {}), 45 * 60 * 1000); }
module.exports = { start, run, buildIndex, findAddress, findAll, allAddresses, findVenue, VENUES, geocodePosts, normEn, normHe, skel };
