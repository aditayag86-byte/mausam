// Mausam utilities: condition mapping, CPCB AQI, units, alerts, monsoon, icons.
export const REDUCED_MOTION = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
export function lerp(a, b, f) { return a + (b - a) * f; }

/* --- WMO weather codes -> {mood, labelKey} --- */
const WMO = {
  0: ['clear', 'cond_clear'], 1: ['clear', 'cond_clear'], 2: ['partly', 'cond_partly'], 3: ['overcast', 'cond_overcast'],
  45: ['fog', 'cond_fog'], 48: ['fog', 'cond_fog'],
  51: ['rain', 'cond_rain'], 53: ['rain', 'cond_rain'], 55: ['rain', 'cond_rain'],
  56: ['rain', 'cond_rain'], 57: ['rain', 'cond_rain'],
  61: ['rain', 'cond_rain'], 63: ['rain', 'cond_rain'], 65: ['rain', 'cond_rain'],
  66: ['rain', 'cond_rain'], 67: ['rain', 'cond_rain'],
  71: ['snow', 'cond_snow'], 73: ['snow', 'cond_snow'], 75: ['snow', 'cond_snow'], 77: ['snow', 'cond_snow'],
  80: ['rain', 'cond_rain'], 81: ['rain', 'cond_rain'], 82: ['rain', 'cond_rain'],
  85: ['snow', 'cond_snow'], 86: ['snow', 'cond_snow'],
  95: ['thunder', 'cond_thunder'], 96: ['thunder', 'cond_thunder'], 99: ['thunder', 'cond_thunder'],
};
export function wmoInfo(code) {
  const [mood, labelKey] = WMO[code] || ['partly', 'cond_partly'];
  return { mood, labelKey };
}
/* Living-sky mood: condition + India-specific monsoon / heat-haze overrides (PRD 6.1) */
export function skyMood(code, isDay, tempC, recentPrecipMm, monsoonActive, humidity) {
  const { mood } = wmoInfo(code);
  if (monsoonActive && (mood === 'rain' || mood === 'thunder') && (recentPrecipMm ?? 0) >= 2.5) return 'monsoon';
  if ((mood === 'clear' || mood === 'partly') && tempC >= 38 && (humidity ?? 50) < 45) return 'haze';
  return mood;
}

/* --- Moon phase --- */
const SYNODIC = 29.53058867;
export function moonPhase(date) {
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  const days = date.getTime() / 86400000 - ref;
  let frac = ((days / SYNODIC) % 1 + 1) % 1;
  const names = ['moon_new', 'moon_waxc', 'moon_fq', 'moon_waxg', 'moon_full', 'moon_wang', 'moon_lq', 'moon_wanc'];
  return { frac, key: names[Math.round(frac * 8) % 8] };
}

/* --- CPCB National AQI (India) — official breakpoints, linear interpolation --- */
const CPCB_BP = {
  pm2_5: [[0, 30, 0, 50], [30, 60, 51, 100], [60, 90, 101, 200], [90, 120, 201, 300], [120, 250, 301, 400], [250, 380, 401, 500]],
  pm10: [[0, 50, 0, 50], [50, 100, 51, 100], [100, 250, 101, 200], [250, 350, 201, 300], [350, 430, 301, 400], [430, 510, 401, 500]],
  no2: [[0, 40, 0, 50], [40, 80, 51, 100], [80, 180, 101, 200], [180, 280, 201, 300], [280, 400, 301, 400], [400, 510, 401, 500]],
  o3: [[0, 50, 0, 50], [50, 100, 51, 100], [100, 168, 101, 200], [168, 208, 201, 300], [208, 748, 301, 400], [748, 1000, 401, 500]],
  co: [[0, 1, 0, 50], [1, 2, 51, 100], [2, 10, 101, 200], [10, 17, 201, 300], [17, 34, 301, 400], [34, 50, 401, 500]],
  so2: [[0, 40, 0, 50], [40, 80, 51, 100], [80, 380, 101, 200], [380, 800, 201, 300], [800, 1600, 301, 400], [1600, 2000, 401, 500]],
  nh3: [[0, 200, 0, 50], [200, 400, 51, 100], [400, 800, 101, 200], [800, 1200, 201, 300], [1200, 1800, 301, 400], [1800, 2400, 401, 500]],
};
function subIndex(conc, pollutant) {
  if (conc == null || isNaN(conc)) return null;
  const bands = CPCB_BP[pollutant];
  let out = 500;
  for (const [cLo, cHi, iLo, iHi] of bands) {
    if (conc <= cHi) { out = lerp(iLo, iHi, clamp((conc - cLo) / (cHi - cLo || 1), 0, 1)); break; }
  }
  return clamp(Math.round(out), 0, 500);
}
export function aqiCategory(aqi) {
  if (aqi <= 50) return { key: 'aqi_good', color: 'var(--aqi-good)' };
  if (aqi <= 100) return { key: 'aqi_satisfactory', color: 'var(--aqi-satisfactory)' };
  if (aqi <= 200) return { key: 'aqi_moderate', color: 'var(--aqi-moderate)' };
  if (aqi <= 300) return { key: 'aqi_poor', color: 'var(--aqi-poor)' };
  if (aqi <= 400) return { key: 'aqi_very_poor', color: 'var(--aqi-very-poor)' };
  return { key: 'aqi_severe', color: 'var(--aqi-severe)' }; // >400 (incl. out-of-range) -> Severe, no clipping
}
/* pollutants: {pm2_5, pm10, no2, o3, so2, co(µg/m³), nh3} (concentrations in µg/m³ except co mg/m³) */
export function cpcbAqi(pollutants) {
  const subs = {};
  let aqi = 0, dominant = null;
  for (const p of Object.keys(CPCB_BP)) {
    let conc = pollutants[p];
    if (p === 'co' && conc != null) conc = conc / 1000; // µg/m³ -> mg/m³ per CPCB CO breakpoints
    const s = subIndex(conc, p);
    if (s == null) continue;
    subs[p] = { conc, sub: s };
    if (s > aqi) { aqi = s; dominant = p; }
  }
  if (dominant == null) return null;
  return { aqi, dominant, subs, ...aqiCategory(aqi) };
}
export const POLLUTANT_LABEL = { pm2_5: 'PM2.5', pm10: 'PM10', no2: 'NO₂', o3: 'O₃', so2: 'SO₂', co: 'CO', nh3: 'NH₃' };
// PM2.5 / PM10 first — dominant pollutants in Indian cities (PRD 6.6)
export const POLLUTANT_ORDER = ['pm2_5', 'pm10', 'o3', 'no2', 'so2', 'co', 'nh3'];

/* --- UV --- */
export function uvCategory(uv) {
  if (uv == null) return null;
  if (uv < 3) return { key: 'uv_low', color: '#4fcb6b' };
  if (uv < 6) return { key: 'uv_moderate', color: '#e8c13b' };
  if (uv < 8) return { key: 'uv_high', color: '#f2932f' };
  if (uv < 11) return { key: 'uv_vhigh', color: '#e23d3d' };
  return { key: 'uv_extreme', color: '#8c2f6b' }; // >=11 and beyond, no clipping
}

/* --- Units (single canonical store: °C, km/h, mm, hPa) --- */
export const UNITS = {
  metric: { tempKey: '°C', speedKey: 'km/h', precipKey: 'mm', pressKey: 'hPa',
    temp: c => c, speed: v => v, precip: v => v, press: v => v },
  imperial: { tempKey: '°F', speedKey: 'mph', precipKey: 'in', pressKey: 'inHg',
    temp: c => c * 9 / 5 + 32, speed: v => v * 0.621371, precip: v => v / 25.4, press: v => v * 0.02953 },
};
export function f1(v) { return v == null ? '—' : (Math.round(v * 10) / 10).toString(); }
export function f0(v) { return v == null ? '—' : Math.round(v).toString(); }

/* --- IMD-style alerts derived from daily forecast (Green/Yellow/Orange/Red) --- */
const SEV_RANK = { green: 0, yellow: 1, orange: 2, red: 3 };
export function deriveAlerts(daily) {
  const found = new Map();
  const add = (type, sev, idx) => {
    if (!found.has(type) || SEV_RANK[sev] > SEV_RANK[found.get(type).severity]) found.set(type, { type, severity: sev, dayIndex: idx });
  };
  daily.slice(0, 3).forEach((d, i) => {
    const hi = d.highC, lo = d.lowC, mm = d.precipMm || 0, code = d.code;
    if (hi != null) { // IMD heat-wave thresholds (plains): >=40 watch, >=45 orange, >=47 red
      if (hi >= 47) add('heatwave', 'red', i); else if (hi >= 45) add('heatwave', 'orange', i);
      else if (hi >= 40) add('heatwave', 'yellow', i);
    }
    if (lo != null && hi != null && hi < 25) { // IMD cold-wave: min <=10 yellow, <=4 orange (plains)
      if (lo <= 4) add('coldwave', 'orange', i); else if (lo <= 10) add('coldwave', 'yellow', i);
    }
    // IMD rainfall: heavy 64.5–115.5, very heavy 115.6–204.4, extremely heavy >204.4 mm/day
    if (mm >= 204.5) add('heavy_rain', 'red', i); else if (mm >= 115.6) add('heavy_rain', 'orange', i);
    else if (mm >= 64.5) add('heavy_rain', 'yellow', i);
    if ([95, 96, 99].includes(code)) add('thunder', 'yellow', i);
    if ([45, 48].includes(code)) add('fog', 'yellow', i);
  });
  return [...found.values()].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
}

/* --- Monsoon status proxy (dates follow typical IMD onset/withdrawal calendar) --- */
export function monsoonStatus(now, lat) {
  const d = new Date(now);
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  if (md >= 601 && md <= 916) { // onset/advance: line sweeps ~8N (Jun 1) -> ~35N (Jul 15)
    const frac = clamp((dayOfYear - 152) / (196 - 152), 0, 1);
    const lineLat = lerp(8, 35, frac);
    if (lineLat >= lat - 1.5) return { status: 'active', lineLat, phase: 'advance' };
    if (lineLat >= lat - 5) return { status: 'onset', lineLat, phase: 'advance' };
    return { status: 'not_yet_arrived', lineLat, phase: 'advance' };
  }
  if (md >= 917 && md <= 1231 || md <= 1215) { // withdrawal: line retreats ~35N (Sep 17) -> ~8N (Dec 15)
    const end = md >= 917 ? dayOfYear : dayOfYear + 365;
    const frac = clamp((end - 260) / (349 - 260), 0, 1);
    const lineLat = lerp(35, 8, frac);
    if (lat >= lineLat + 2) return { status: 'withdrawn', lineLat, phase: 'withdraw' };
    if (lat >= lineLat - 2) return { status: 'withdrawing', lineLat, phase: 'withdraw' };
    return { status: 'active', lineLat, phase: 'withdraw' };
  }
  return { status: 'offseason', lineLat: null, phase: null };
}

/* --- Location-time helpers (always use the viewed location's zone) --- */
export function timeInZone(date, tz) {
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(date); }
  catch { return date.toISOString().slice(11, 16); }
}
export function dateInZone(date, tz) {
  try { return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(date); }
  catch { return date.toISOString().slice(0, 10); }
}

/* --- Custom SVG weather icons (consistent line style, day/night aware) --- */
const P = {
  sun: '<g stroke="#FFD75E" stroke-width="5" fill="none"><circle cx="50" cy="50" r="18" fill="#FFD75E"/><g stroke-linecap="square"><path d="M50 12v14M50 74v14M12 50h14M74 50h14M23 23l10 10M77 23l-10 10M23 77l10-10M77 77l-10-10"/></g></g>',
  moon: '<path d="M62 18a30 30 0 1 0 20 34 24 24 0 0 1-20-34z" fill="#DCE4FF" stroke="#9DB4FF" stroke-width="4"/>',
  cloud: '<path d="M28 70a16 16 0 0 1 2-32 22 22 0 0 1 42-4 15 15 0 0 1 2 30z" fill="#D7DEE8" stroke="#9AA6B6" stroke-width="4"/>',
  rain: '<path d="M28 56a16 16 0 0 1 2-32 22 22 0 0 1 42-4 15 15 0 0 1 2 30z" fill="#9FB2C4" stroke="#6E8298" stroke-width="4"/><g stroke="#9FD0FF" stroke-width="6" stroke-linecap="square"><path d="M34 66l-4 12M50 66l-4 12M66 66l-4 12"/></g>',
  heavyrain: '<path d="M28 56a16 16 0 0 1 2-32 22 22 0 0 1 42-4 15 15 0 0 1 2 30z" fill="#8299AE" stroke="#5C7288" stroke-width="4"/><g stroke="#BFE3FF" stroke-width="7" stroke-linecap="square"><path d="M32 64l-5 16M48 64l-5 16M64 64l-5 16"/></g>',
  storm: '<path d="M28 54a16 16 0 0 1 2-32 22 22 0 0 1 42-4 15 15 0 0 1 2 30z" fill="#6E7A96" stroke="#49536B" stroke-width="4"/><path d="M48 58l-12 18h10l-6 18 20-24H50l8-12z" fill="#FFD75E" stroke="#C9A82E" stroke-width="2"/>',
  snow: '<path d="M28 56a16 16 0 0 1 2-32 22 22 0 0 1 42-4 15 15 0 0 1 2 30z" fill="#D7DEE8" stroke="#9AA6B6" stroke-width="4"/><g fill="#EAF2FA" stroke="#9FC5E8" stroke-width="2"><rect x="30" y="66" width="8" height="8"/><rect x="46" y="70" width="8" height="8"/><rect x="62" y="66" width="8" height="8"/></g>',
  fog: '<path d="M30 48a14 14 0 0 1 4-27 20 20 0 0 1 38 0 14 14 0 0 1 2 27z" fill="#C4C7CC" stroke="#8D9199" stroke-width="4"/><g stroke="#E9EAEC" stroke-width="6" stroke-linecap="square"><path d="M22 62h56M30 74h40"/></g>',
};
export function iconSvg(code, isDay, cls = 'wicon') {
  const { mood } = wmoInfo(code);
  let body;
  if (mood === 'clear') body = isDay ? P.sun : P.moon;
  else if (mood === 'partly') body = (isDay ? P.sun : P.moon) + P.cloud;
  else if (mood === 'overcast') body = P.cloud;
  else if (mood === 'thunder') body = P.storm;
  else if (mood === 'snow') body = P.snow;
  else if (mood === 'fog') body = P.fog;
  else body = code >= 80 || code === 65 || code === 82 ? P.heavyrain : P.rain;
  return `<svg class="${cls}" viewBox="0 0 100 100" role="img" aria-hidden="true">${body}</svg>`;
}
