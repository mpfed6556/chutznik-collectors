// ── Chutznik bridge brain: pure functions (no WhatsApp deps — unit-testable) ──

const PHONE_RX = /(\+?972[-\s]?|0)(5\d)[-\s]?\d{3}[-\s]?\d{4}/g;
const PRICE_RX = /(₪|nis|shekel|ש"ח|שח)\s?\d|(\d{3,6})\s?(₪|nis|ש"ח|שח)/i;

function phonesIn(text){
  const out = new Set();
  for (const m of String(text||'').matchAll(PHONE_RX)) {
    let p = m[0].replace(/[-\s]/g,'');
    if (p.startsWith('0')) p = '+972' + p.slice(1);
    if (!p.startsWith('+')) p = '+' + p;
    out.add(p);
  }
  return [...out];
}

// What KIND of message is this?
function classify(text, hasMedia){
  const t = String(text||'').trim();
  const lower = t.toLowerCase();
  const phones = phonesIn(t);
  // RENTAL = housing specifically (an apartment/rooms/sublet), not "pool for rent"
  const housing = /\b(apartment|apt|flat|dira|דירה|sublet|להשכרה|basement unit|duplex)\b/i.test(t) || /\b(\d+(\.5)?)\s*(rooms?|bedrooms?|חדרים)\b/i.test(t);
  const rental = housing && (/\b(rent|rental|sublet|available|להשכרה|short term|long term)\b/i.test(t) || PRICE_RX.test(t));
  const salesy = /\b(sale|selling|% ?off|discount|special|order now|delivery|now booking|grand opening|promotion|my business|i sell|we sell)\b/i.test(t);
  const ad = !rental && salesy && (PRICE_RX.test(t) || phones.length>0 || hasMedia);
  const trivia = /\b(what time|when is|candle lighting|shkia|zman|הדלקת נרות)\b/i.test(t) && t.length < 80;
  const question = !trivia && /\?|anyone (know|have|recommend)|looking for|does anyone|can someone|where can i|need a recommendation|רוצה המלצה|מישהי מכירה/i.test(t);
  if (trivia) return 'chatter';
  const answerish = phones.length>0 || /\b(try|call|highly recommend|we used|she('s| is) (great|amazing)|ask for)\b/i.test(t) || /https?:\/\//.test(t);
  const substantial = t.length >= 25 || phones.length>0 || hasMedia;
  if (rental) return 'rental';
  if (ad) return 'ad';
  if (question && substantial) return 'question';
  if (answerish && t.length <= 400) return 'answer';
  if (!substantial) return 'chatter';
  if (/^(thanks|thank you|תודה|amen|amazing|wow|lol|😂|🙏|❤|mazel tov|mazal tov|bh|b"h)/i.test(lower) && t.length<60) return 'chatter';
  return 'info';
}

// Site categories — assign EVERY relevant one (min 1)
function categoriesFor(text, kind){
  const t = String(text||'').toLowerCase();
  const cats = new Set();
  const add = (c)=>cats.add(c);
  if (kind==='rental' || /rent|sublet|apartment|dira|דירה|להשכרה/.test(t)) add('Rental');
  if (/job|hiring|position|work from|salary|employ|דרוש/.test(t)) add('Jobs');
  if (/doctor|dr\.|clinic|dentist|therapist|pediatric|health|medical|רופא|קופת/.test(t)) add('Healthcare');
  if (/school|gan|teacher|tutor|class|course|camp|מורה|בית ספר|חוג/.test(t)) add('Education');
  if (/babysit|cleaner|cleaning lady|handyman|plumber|electrician|sheitel|macher|driver|מטפלת|עוזרת/.test(t)) add('Person');
  if (/pool|park|museum|trip|hike|attraction|hotel|tzimmer|בריכה|טיול/.test(t)) add('Place');
  if (/store|shop|business|company|restaurant|catering|bakery|חנות|עסק/.test(t)) add('Company');
  if (/mikva|mikvah|מקווה/.test(t)) add('Mikva');
  if (/gemach|גמ"ח|גמח|chesed|loan|donate|bikur cholim/.test(t)) add('Chesed');
  if (/shul|minyan|shiur|rebbetzin|tehillim|davening|שיעור|בית כנסת/.test(t)) add('Spiritual');
  if (/sale|selling|for sale|buy|giveaway|free to a good home|למכירה/.test(t)) add('Items / Questions');
  if (kind==='question') add('Items / Questions');
  if (!cats.size) add('Community');
  return [...cats].slice(0,4);
}

// Turn a question into a clean post title: "anyone have a pool number?" → "Pool — recommendations from the community"
function topicTitle(text){
  const t = String(text||'').replace(/\s+/g,' ').trim();
  const stop = new Set(['anyone','know','knows','have','has','a','an','the','for','of','in','on','to','does','can','someone','where','i','need','looking','recommend','recommendation','good','number','numbers','please','tia','urgent','who','with','me','you','is','are','any']);
  const words = t.replace(/[?!.,:;"']/g,' ').split(/\s+/).filter(w=>w && !stop.has(w.toLowerCase()));
  const core = words.slice(0,4).map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');
  return core ? core + ' — recommendations from the community' : 'Community recommendations';
}

// Cluster a chat window: questions absorb their answers → ONE combined post.
// Returns [{kind:'combined'|'single', q, answers[], msgs[]}...]
function clusterWindow(msgs){
  const out=[]; let current=null;
  for (const m of msgs){
    if (m.kind==='chatter') continue;
    if (m.kind==='rental' || m.kind==='ad'){ out.push({kind:'single', msgs:[m]}); current=null; continue; }
    if (m.kind==='question'){ current={kind:'combined', q:m, answers:[]}; out.push(current); continue; }
    if (m.kind==='answer' && current){ current.answers.push(m); continue; }
    if (m.kind==='info'){ out.push({kind:'single', msgs:[m]}); current=null; }
  }
  // a question with no answers still posts (it's a real ask), but as single
  return out.filter(c => c.kind==='single' || c.q);
}

// A stable fingerprint so we never post near-duplicates twice
function fingerprint(text){
  return String(text||'').toLowerCase().replace(/[^a-z0-9א-ת ]/g,'').split(/\s+/)
    .filter(w=>w.length>3).sort().slice(0,12).join('|');
}

module.exports = { phonesIn, classify, categoriesFor, topicTitle, clusterWindow, fingerprint, PHONE_RX };
