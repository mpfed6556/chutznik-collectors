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
  // a group invite link with no words of its own is not a post (Miriam, 5 Oct 2026)
  const bare = t.replace(/https?:\/\/\S+/g, ' ').replace(/whatsapp group invite|group invite|join (?:the |our )?group|invite link/gi, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (/chat\.whatsapp\.com\//i.test(t) && bare.split(' ').filter(Boolean).length < 6) return 'chatter';
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
  // a home, not "rent a pack n play" / "rock climbing equipment for renting" (Miriam, 25 Sep 2026)
  if (kind==='rental' || (/\b(apartment|apt|flat|dira|dirot|studio|penthouse|cottage|duplex|sublet|sublease|vacation rental|rooms? for rent|house for rent)\b|דירה|להשכרה/.test(t) && /rent|sublet|lease|available|looking for|seeking|wanted/.test(t))) add('Rental');
  if (/\b(jobs?|hiring|position|work from home|salary|employ(?:er|ee|ment)?)\b|דרוש/.test(t)) add('Jobs');
  if (/\b(doctors?|dr\.|clinics?|dentists?|therapists?|therapy|pediatric\w*|health ?care|medical|physiotherap\w*|nurse|pharmacy)\b|רופא|קופת/.test(t)) add('Healthcare');   // whole words only (13 Nov 2026: a shiur came out as Healthcare)
  if (/\b(schools?|gan|ganim|teachers?|tutors?|tutoring|classes|class|courses?|camps?)\b|מורה|בית ספר|חוג/.test(t)) add('Education');
  if (/babysit|cleaner|cleaning lady|handyman|plumber|electrician|sheitel|macher|driver|מטפלת|עוזרת/.test(t)) add('Person');
  // an attraction is somewhere to go: whole words only ("parking" is not a park), and not a home with a pool, a flat facing the
  // park, a pool for sale, a thing found in the park or a hotel's rates (Miriam, 25 Nov 2026: "These aren't attractions!")
  const placeWord = /\b(parks?|playgrounds?|museums?|zoo|aquarium|trips?|tiyul(?:im)?|hik(?:e|es|ing)|attractions?|tzimmer\w*|pools?)\b|בריכה|טיול/.test(t);
  const notGoing = cats.has('Rental') || cats.has('Jobs') || /\b(for sale|selling|giving away|giveaway|found|lost|apartments?|bedrooms?|\d[\d.]* ?rooms?|sqm|real estate|boarding)\b|למכירה|להשכרה/.test(t);
  if (placeWord && !notGoing) add('Place');
  if (/\b(stores?|shops?|business(?:es)?|company|restaurants?|catering|bakery)\b|חנות|עסק/.test(t)) add('Company');
  // a recorded talk is a talk, whatever its title mentions (Miriam, 25 Nov 2026: a lecture link whose title named a mikva was filed
  // under Mikva and offered "Is this your mikva? Claim it"); and a shop that lists a mikva among the places it sells in is not one
  const talk = /torahanytime\.com|mytat\.me|torahanytime links/.test(t);
  const sellsAt = /\b(?:sold|available|stocked|find (?:us|it|them)) (?:in|at)\b[\s\S]{0,200}mikva/.test(t);
  if (/mikva|mikvah|מקווה/.test(t) && !talk && !sellsAt) add('Mikva');
  if (/gemach|גמ"ח|גמח|chesed|loan|donate|bikur cholim/.test(t)) add('Chesed');
  if (/shul|minyan|shiur|rebbetzin|tehillim|davening|שיעור|בית כנסת/.test(t)) add('Spiritual');
  if (/sale|selling|for sale|buy|giveaway|free to a good home|למכירה/.test(t)) add('Items / Questions');
  if (kind==='question' && !talk) add('Items / Questions');   // a talk's title ending in a question mark is not somebody asking
  if (talk) add('Spiritual');
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
