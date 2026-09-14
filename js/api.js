// Mausam data layer — Open-Meteo (free, no key). Attribution shown in the app footer.
import { cpcbAqi } from './util.js';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';

async function getJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.reason || `HTTP ${res.status}`);
    }
    return await res.json();
  } finally { clearTimeout(timer); }
}

/* Nationwide city/town/district search, filtered to India */
export async function geocode(name, lang = 'en', signal) {
  const u = `${GEO}?name=${encodeURIComponent(name)}&count=20&language=${lang}&format=json&countryCode=IN`;
  const data = await getJson(u, 8000);
  const results = (data.results || []).filter(r => r.country_code === 'IN');
  return results.map(r => ({
    id: String(r.id), name: r.name, region: r.admin1 || '', country: 'IN',
    lat: r.latitude, lon: r.longitude, timezone: r.timezone, population: r.population || 0,
  }));
}

const CUR = ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day', 'weather_code',
  'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'dew_point_2m'].join(',');
const HR = ['temperature_2m', 'weather_code', 'precipitation_probability', 'precipitation', 'pressure_msl',
  'visibility', 'uv_index', 'cloud_cover', 'wind_speed_10m', 'wind_gusts_10m'].join(',');
const DY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
  'precipitation_probability_max', 'uv_index_max', 'sunrise', 'sunset'].join(',');
const M15 = 'precipitation,precipitation_probability';

/* Full bundle for one location: weather + air quality (air failure tolerated). */
export async function fetchBundle(loc) {
  const wf = `${FORECAST}?latitude=${loc.lat}&longitude=${loc.lon}&current=${CUR}` +
    `&minutely_15=${M15}&forecast_minutely_15=8&hourly=${HR}&daily=${DY}` +
    `&timezone=auto&forecast_days=10&past_hours=6&forecast_hours=48`;
  const af = `${AIR}?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide` +
    `&hourly=pm2_5,pm10,uv_index&timezone=auto&forecast_days=3`;
  const [weather, air] = await Promise.all([
    getJson(wf), getJson(af).catch(err => ({ error: true, reason: String(err.message || err) })),
  ]);
  if (weather.error) throw new Error(weather.reason || 'weather request failed');
  return normalize(loc, weather, air);
}

function normalize(loc, w, air) {
  const cur = w.current || {};
  const h = w.hourly || {};
  const d = w.daily || {};
  const m15 = w.minutely_15 || {};
  const now = Date.now();
  const hourly = (h.time || []).map((t, i) => ({
    time: wall(t), tempC: h.temperature_2m?.[i], code: h.weather_code?.[i],
    precipProb: h.precipitation_probability?.[i], precipMm: h.precipitation?.[i],
    pressureHpa: h.pressure_msl?.[i], visibilityKm: h.visibility?.[i] != null ? h.visibility[i] / 1000 : null,
    uv: h.uv_index?.[i], cloud: h.cloud_cover?.[i], windKmh: h.wind_speed_10m?.[i], gustKmh: h.wind_gusts_10m?.[i],
  }));
  const daily = (d.time || []).map((t, i) => ({
    date: t, code: d.weather_code?.[i], highC: d.temperature_2m_max?.[i], lowC: d.temperature_2m_min?.[i],
    precipMm: d.precipitation_sum?.[i], precipProb: d.precipitation_probability_max?.[i],
    uvMax: d.uv_index_max?.[i], sunrise: d.sunrise?.[i], sunset: d.sunset?.[i],
  }));
  // precipitation nowcast from minutely_15 (omit element entirely when unavailable — PRD §9)
  let nowcast = null;
  if (m15.time && m15.precipitation) {
    const off = w.utc_offset_seconds * 1000;
    const wallTs = Date.now() + off;
    const rows = m15.time.map((t, i) => ({ t: wall(t), mm: m15.precipitation?.[i], prob: m15.precipitation_probability?.[i] }))
      .filter(r => r.t >= wallTs - 10 * 60000).slice(0, 8);
    if (rows.length) nowcast = rows;
  }
  // AQI on the CPCB National scale (computed client-side from CAMS concentrations)
  const ac = air && !air.error ? (air.current || {}) : null;
  let aqi = null;
  if (ac && ac.pm2_5 != null || ac && ac.pm10 != null) {
    aqi = { computed: cpcbFrom(ac), forecastHours: (air.hourly?.time || []).map((t, i) => ({ time: t, aqiSub: air.hourly.pm2_5?.[i], pm10: air.hourly.pm10?.[i], uv: air.hourly.uv_index?.[i] })) };
  }
  const payload = {
    loc: { ...loc }, fetchedAt: now,
    current: {
      time: cur.time, tempC: cur.temperature_2m, feelsLikeC: cur.apparent_temperature,
      humidityPct: cur.relative_humidity_2m, isDay: cur.is_day === 1 || cur.is_day === true,
      code: cur.weather_code, cloudPct: cur.cloud_cover, pressureHpa: cur.pressure_msl,
      windKmh: cur.wind_speed_10m, windDeg: cur.wind_direction_10m, gustKmh: cur.wind_gusts_10m,
      dewPointC: cur.dew_point_2m,
      uv: nearestHourly(hourly, 'uv', Date.now() + w.utc_offset_seconds * 1000),
      visibilityKm: nearestHourly(hourly, 'visibilityKm', Date.now() + w.utc_offset_seconds * 1000),
    },
    hourly, daily, nowcast, aqi,
    timezone: w.timezone, utcOffset: w.utc_offset_seconds,
  };
  return payload;
}
function nearestHourly(hourly, field, now) {
  let best = null, bestDt = Infinity;
  for (const r of hourly) { const dt = Math.abs(r.time - now); if (r[field] != null && dt < bestDt) { bestDt = dt; best = r[field]; } }
  return best;
}
/* naive local ISO string -> wall-clock ms (compared against Date.now() + utcOffset) */
function wall(s) { return Date.parse(s.length <= 16 ? s + ':00Z' : s.endsWith('Z') ? s : s + 'Z'); }
function cpcbFrom(ac) {
  return cpcbAqi(ac);
}

/* Nationwide grid for the Map view — one batched request, up to 1000 points (PRD §7).
   Caching handled by caller (30 min). */
export async function fetchGrid() {
  const lats = [], lons = [];
  for (let lat = 6.5; lat <= 36.5; lat += 1) for (let lon = 68.5; lon <= 96.5; lon += 1) { lats.push(lat.toFixed(1)); lons.push(lon.toFixed(1)); }
  const u = `${FORECAST}?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
    `&current=temperature_2m,precipitation,cloud_cover,wind_speed_10m,weather_code` +
    `&forecast_days=1&timezone=GMT&cell_selection=nearest`;
  const data = await getJson(u, 30000);
  const arr = Array.isArray(data) ? data : [data];
  return arr.map((d, i) => ({
    lat: +lats[i], lon: +lons[i],
    tempC: d.current?.temperature_2m, precipMm: d.current?.precipitation,
    cloudPct: d.current?.cloud_cover, windKmh: d.current?.wind_speed_10m, code: d.current?.weather_code,
  }));
}
