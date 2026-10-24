// scripts/shabbos.js (the same code as the site's api/_shabbos.js) — nothing goes out on Shabbos (Miriam, 24 Oct 2026: "don't send any emails or whatsapps or
// anything on shabbos, Israel or American time — it's a different time each week").
// The quiet window runs from 40 minutes before Friday's sunset in Jerusalem to 50 minutes after Saturday's
// sunset in New York, so it covers Shabbos wherever the reader is. Sunset is computed here (the standard
// sunrise equation), so nothing is looked up and the window moves with the season on its own.
//   isShabbos(now)      → true inside the window
//   shabbosWindow(now)  → { start, end } (ms UTC) of the window that holds `now`, or the next one
//   quietUntil(now)     → the end of the current window, or 0 when it is not Shabbos
const JLM = { lat: 31.778, lng: 35.235 }, NYC = { lat: 40.713, lng: -74.006 };
const BEFORE = 40 * 60000, AFTER = 50 * 60000;

// sunset (ms UTC) on the civil date given as a UTC-midnight timestamp, at a place
function sunsetUTC(midnightUTC, p) {
  const J = midnightUTC / 86400000 + 2440587.5;
  const n = Math.ceil(J - 2451545.0 + 0.0008 - p.lng / 360);
  const Js = n - p.lng / 360;
  const M = ((357.5291 + 0.98560028 * Js) % 360 + 360) % 360, Mr = M * Math.PI / 180;
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const lam = ((M + C + 180 + 102.9372) % 360 + 360) % 360, lr = lam * Math.PI / 180;
  const Jt = 2451545.0 + Js + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lr);
  const dec = Math.asin(Math.sin(lr) * Math.sin(23.4397 * Math.PI / 180)), phi = p.lat * Math.PI / 180;
  const cosH = (Math.sin(-0.833 * Math.PI / 180) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  const H = Math.acos(Math.max(-1, Math.min(1, cosH))) * 180 / Math.PI;
  return (Jt + H / 360 - 2440587.5) * 86400000;
}
// the UTC midnight of the civil date `days` after the given one
const dayAt = (midnightUTC, days) => midnightUTC + days * 86400000;
const midnightOf = (t) => Math.floor(t / 86400000) * 86400000;
// the window of the week whose Friday is the one on or before the Jerusalem date of `t`
function windowForFriday(fridayMidnightUTC) {
  const start = sunsetUTC(fridayMidnightUTC, JLM) - BEFORE;
  const end = sunsetUTC(dayAt(fridayMidnightUTC, 1), NYC) + AFTER;
  return { start, end };
}
function shabbosWindow(now) {
  const t = Number(now) || Date.now();
  // the Jerusalem civil date, as a UTC midnight (Israel is UTC+2/+3: add 3 h, take the date)
  const jlmMidnight = midnightOf(t + 3 * 3600000);
  const dow = new Date(jlmMidnight).getUTCDay();          // 0 Sunday … 5 Friday, 6 Saturday
  const back = (dow - 5 + 7) % 7;                          // days since the last Friday (0 on Friday)
  let w = windowForFriday(dayAt(jlmMidnight, -back));
  if (t >= w.end) w = windowForFriday(dayAt(jlmMidnight, 7 - back));   // this week's is over: next Friday's
  return w;
}
function isShabbos(now) { const t = Number(now) || Date.now(); const w = shabbosWindow(t); return t >= w.start && t < w.end; }
function quietUntil(now) { const t = Number(now) || Date.now(); const w = shabbosWindow(t); return (t >= w.start && t < w.end) ? w.end : 0; }

module.exports = { sunsetUTC, shabbosWindow, isShabbos, quietUntil };
