// areas.js — the Jewish-area allowlist for the rental aggregator.
// ONLY listings whose location text matches one of these get forwarded to
// Chutznik. Anything not recognized here is silently skipped — including
// Arab, mixed, or East Jerusalem neighborhoods, which are deliberately NOT
// listed. When a listing's area can't be confidently matched to this list,
// it is SKIPPED (never guessed) — better to miss one than post something wrong.
//
// Add more neighborhoods here any time; each entry is [canonical name, regex
// of ways it's written/spelled].

module.exports.JEWISH_AREAS = [
  ['Romema', /\brome+ma\b/i],
  ['Ramat Eshkol', /\bramat\s*eshkol\b/i],
  ['Sanhedria', /\bsanhedria\b(?!\s*murchevet)/i],
  ['Sanhedria Murchevet', /\bsanhedria\s*murchevet\b/i],
  ['Givat Shaul', /\bgiv[a']?at\s*shaul\b/i],
  ['Har Nof', /\bhar\s*nof\b/i],
  ['Bayit Vegan', /\bbayit\s*vegan\b/i],
  ['Ezras Torah', /\bezr[ao]s\s*torah\b/i],
  ['Kiryat Belz', /\b(kiryat\s*belz|belz)\b/i],
  ['Geula', /\bge'?ula\b/i],
  ['Mekor Baruch', /\bmekor\s*baruch\b/i],
  ['Unsdorf', /\bunsdorf\b/i],
  ['Mattersdorf', /\bmattersdorf\b/i],
  ['Kiryat Sanz', /\b(kiryat\s*sanz|sanz)\b/i],
  ['Nachlaot', /\bnachla?ot\b/i],
  ['City Center', /\b(city\s*center|city\s*centre|ben\s*yehuda)\b/i],
  ['Rechavia', /\brechavia\b/i],
  ['Katamon', /\b(katamon|old\s*katamon)\b/i],
  ['Baka', /\bbaka\b/i],
  ['Talpiot', /\btalpi?ot\b/i],
  ['German Colony', /\bgerman\s*colony\b/i],
  ['Arnona', /\barnona\b/i],
  ['Gilo', /\bgilo\b/i],
  ['Ramot', /\bramot\b/i],
  ['Neve Yaakov', /\bneve\s*ya'?a?kov\b/i],
  ['Pisgat Zeev', /\bpisgat\s*ze'?ev\b/i],
  ['French Hill', /\bfrench\s*hill\b/i],
  ['Givat Mordechai', /\bgiv[a']?at\s*mordechai\b/i],
  ['Kiryat Moshe', /\bkiryat\s*moshe\b/i],
  ['Ramat Beit Shemesh', /\b(rbs|ramat\s*beit\s*shemesh)\b/i],
  ['Beit Shemesh', /\bbeit\s*shemesh\b/i],
  // Add more of your recognized Jewish areas below as needed:
  // ['Neighborhood Name', /\bpattern\b/i],
];

// Returns the canonical area name(s) found in the given text, or [] if none
// of the allowed Jewish areas are recognized (meaning: SKIP this listing).
function detectJewishAreas(text) {
  const found = [];
  for (const [name, re] of module.exports.JEWISH_AREAS) {
    if (re.test(text) && !found.includes(name)) found.push(name);
  }
  if (found.includes('Sanhedria Murchevet')) {
    const i = found.indexOf('Sanhedria');
    if (i >= 0) found.splice(i, 1);
  }
  return found;
}
module.exports.detectJewishAreas = detectJewishAreas;
