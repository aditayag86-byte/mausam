// Mausam views — Today, Forecast, Map, Air & UV, Locations.
import { iconSvg, wmoInfo, aqiCategory, uvCategory, moonPhase, monsoonStatus, deriveAlerts,
  timeInZone, REDUCED_MOTION, f0, f1, POLLUTANT_ORDER, POLLUTANT_LABEL, clamp } from './util.js';

/* ---------- tiny DOM helpers ---------- */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return el;
}

/* ---------- wall-clock in the viewed location's zone ----------
   Open-Meteo returns naive local ISO strings; we compare them against
   Date.now() + utcOffset (both "location wall time"), and format via UTC getters. */
export function wallParse(s) { return Date.parse(s.length <= 16 ? s + ':00Z' : s.endsWith('Z') ? s : s + 'Z'); }
export function wallNow(offsetSec) { return Date.now() + offsetSec * 1000; }
export function hhmm(wallTs) { const d = new Date(wallTs); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }
export function hourLabel(wallTs) { const d = new Date(wallTs); const hr = d.getUTCHours(); return hr === 0 ? '12am' : hr <= 12 ? hr + (hr === 12 ? 'pm' : 'am') : (hr - 12) + 'pm'; }

/* ---------- is a given hour daytime at this location? ---------- */
function dayBounds(daily, dateStr) {
  const row = daily.find(d => d.date === dateStr);
  return row && row.sunrise && row.sunset ? [wallParse(row.sunrise), wallParse(row.sunset)] : null;
}

/* ---------- alert banners (IMD colours, never color-alone; PRD 6.9) ---------- */
export function alertBanners(t, payload) {
  const alerts = deriveAlerts(payload.daily);
  const wrap = h('div');
  for (const a of alerts) {
    const desc = t('ad_' + a.type, { max: f0(payload.daily[a.dayIndex]?.highC), min: f0(payload.daily[a.dayIndex]?.lowC), mm: f0(payload.daily[a.dayIndex]?.precipMm), gust: f0(payload.daily[a.dayIndex]?.gustKmh || payload.current.gustKmh) });
    wrap.appendChild(h('button', {
      class: `alert sev-${a.severity}`, 'aria-expanded': 'false', onclick: (e) => {
        const b = e.currentTarget; b.setAttribute('aria-expanded', b.getAttribute('aria-expanded') !== 'true');
      },
    },
      h('span', { class: 'ahead' },
        h('span', { class: 'sevword' }, t('sev_' + a.severity)),
        h('span', {}, '⚠ ', t('at_' + a.type))),
      h('span', { class: 'adesc' }, desc)));
  }
  if (!alerts.length) {
    wrap.appendChild(h('div', { class: 'card', style: 'text-align:center;padding:8px' }, '✔ ', t('alert_none')));
  }
  wrap.appendChild(h('p', { class: 'mono-note' }, t('alert_derived_note')));
  return wrap;
}

/* ---------- hourly strip (shared Today / day-detail) ---------- */
export function hourlyStrip(payload, t, fmtTemp, fromWall, hours = 24) {
  const cells = payload.hourly.filter(r => r.time >= fromWall - 30 * 60000).slice(0, hours);
  const strip = h('div', { class: 'hourly', role: 'list' });
  cells.forEach((r, i) => {
    const wt = r.time;
    strip.appendChild(h('div', { class: 'hcell' + (i === 0 ? ' now' : ''), role: 'listitem' },
      h('span', { class: 'htime' }, i === 0 ? t('now') : hourLabel(wt)),
      h('span', { class: 'htemp' }, fmtTemp(r.tempC)),
      h('span', { html: iconSvg(r.code, isDayHour(payload, wt)), class: '' }),
      r.precipProb != null && r.precipProb > 5 ? h('span', { class: 'pp' }, f0(r.precipProb) + '%') : null));
  });
  return strip;
}
function isoOf(d) { return d.toISOString().slice(0, 16); }
function isDayHour(payload, wallTs) {
  const b = dayBounds(payload.daily, new Date(wallTs).toISOString().slice(0, 10));
  if (!b) return true;
  return wallTs >= b[0] && wallTs <= b[1];
}

/* ---------- precipitation nowcast sentence (omitted entirely if no data — PRD §9) ---------- */
export function nowcastEl(t, payload) {
  if (!payload.nowcast) return null;
  const rows = payload.nowcast;
  const firstWet = rows.findIndex(r => (r.mm ?? 0) > 0.05);
  let text;
  if (firstWet === 0) {
    let last = 0;
    while (last < rows.length && (rows[last].mm ?? 0) > 0.05) last++;
    text = t('rain_ongoing', { n: last * 15 });
  } else if (firstWet > 0) text = t('rain_start_in', { n: firstWet * 15 });
  else {
    let dry = rows.length;
    text = t('dry_next', { n: dry * 15 });
  }
  return h('div', { class: 'card' }, h('h3', {}, '☔ ', t('precip_now')), h('div', { class: 'mval' }, text));
}

/* ---------- count-up hero numeral (single orchestrated moment — PRD 6.8) ---------- */
export function countUp(el, target, suffix, ms = 900) {
  if (REDUCED_MOTION) { el.textContent = target + suffix; return; }
  const t0 = performance.now();
  const step = (now) => {
    const f = clamp((now - t0) / ms, 0, 1);
    el.textContent = Math.round(target * (f * f * (3 - 2 * f))) + suffix;
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- shared metric cards ---------- */
function windCard(t, ctx, payload) {
  const deg = payload.current.windDeg ?? 0;
  const needle = h('g', { class: 'wind-needle' });
  setTimeout(() => needle.setAttribute('style', `transform: rotate(${deg}deg)`), 60);
  const svg = `<svg class="compass" width="100" height="100" viewBox="0 0 100 100" role="img" aria-label="Wind direction">
    <circle cx="50" cy="50" r="44" fill="rgba(0,0,0,.18)" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
    <text x="50" y="16" fill="#fff" font-size="12" text-anchor="middle">N</text>
    <text x="50" y="94" fill="#fff" font-size="12" text-anchor="middle">S</text>
    <text x="12" y="54" fill="#fff" font-size="12" text-anchor="middle">W</text>
    <text x="88" y="54" fill="#fff" font-size="12" text-anchor="middle">E</text>
    <g class="wind-needle" style="transform: rotate(0deg)"><path d="M50 14 L58 54 L50 48 L42 54 Z" fill="#FFD75E"/></g>
  </svg>`;
  return h('div', { class: 'card metric' }, h('h3', {}, t('wind')),
    h('span', { class: 'mval' }, `${f0(ctx.units.speed(payload.current.windKmh))} ${ctx.units.speedKey}`),
    h('span', { class: 'msub' }, `${t('gusts')}: ${f0(ctx.units.speed(payload.current.gustKmh))} ${ctx.units.speedKey}`),
    h('span', { html: svg.replace('<g class="wind-needle" style="transform: rotate(0deg)">', `<g class="wind-needle" style="transform: rotate(${deg}deg)">`) }));
}
function sunArcCard(t, payload) {
  const off = payload.utcOffset;
  const nowW = wallNow(off);
  const b = dayBounds(payload.daily, new Date(nowW).toISOString().slice(0, 10));
  const rise = b ? b[0] : null, set = b ? b[1] : null;
  let frac = null;
  if (rise && set) frac = clamp((nowW - rise) / Math.max(set - rise, 1), 0, 1);
  const A = frac == null ? 0 : Math.PI * (1 - frac);
  const cx = 20 + frac * 80, cy = 78 - Math.sin(Math.PI * frac) * 52;
  const isUp = frac != null && frac > 0 && frac < 1;
  const svg = `<svg class="sunarc" width="180" height="96" viewBox="0 0 180 96" role="img" aria-label="Sun arc">
    <path d="M10 78 A80 66 0 0 1 170 78" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="2" stroke-dasharray="4 5"/>
    <path d="M10 78 H170" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
    ${isUp ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" fill="#FFD75E" stroke="#fff" stroke-width="2"/>` : `<circle cx="10" cy="78" r="5" fill="#8892a8"/><circle cx="170" cy="78" r="5" fill="#8892a8"/>`}
  </svg>`;
  return h('div', { class: 'card metric' }, h('h3', {}, '☀ ' + t('sunrise') + ' / ' + t('sunset')),
    h('span', { class: 'mval' }, rise ? hhmm(rise) : '—', ' · ', set ? hhmm(set) : '—'),
    h('span', { html: svg }));
}
function pressureCard(t, ctx, payload) {
  const nowW = wallNow(payload.utcOffset);
  const past = payload.hourly.filter(r => r.time <= nowW && r.pressureHpa != null).slice(-4);
  const recent = payload.hourly.filter(r => r.time >= nowW - 3 * 3600000 && r.time <= nowW + 60 * 60000 && r.pressureHpa != null).slice(0, 4);
  const series = past.length >= 2 ? past : recent;
  let trendKey = 'trend_steady', dP = 0;
  if (series.length >= 2) {
    dP = series[series.length - 1].pressureHpa - series[0].pressureHpa;
    trendKey = dP > 0.6 ? 'trend_rising' : dP < -0.6 ? 'trend_falling' : 'trend_steady';
  }
  let spark = '';
  if (series.length >= 2) {
    const vals = series.map(s => s.pressureHpa);
    const min = Math.min(...vals) - 0.4, max = Math.max(...vals) + 0.4;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${40 - ((v - min) / (max - min || 1)) * 36}`).join(' ');
    spark = `<svg class="spark" viewBox="0 0 100 44" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#9FD0FF" stroke-width="2.5"/></svg>`;
  }
  return h('div', { class: 'card metric' }, h('h3', {}, t('pressure')),
    h('span', { class: 'mval' }, f0(ctx.units.press(payload.current.pressureHpa)) + ' ' + ctx.units.pressKey),
    h('span', { class: 'msub' }, (dP > 0.6 ? '↗ ' : dP < -0.6 ? '↘ ' : '→ ') + t(trendKey)),
    h('span', { html: spark }));
}
function aqiChip(t, payload) {
  const a = payload.aqi && payload.aqi.computed;
  if (!a) return h('div', { class: 'card metric' }, h('h3', {}, t('aqi')), h('span', { class: 'msub' }, t('aqi_unavailable')));
  return h('div', { class: 'card metric' }, h('h3', {}, t('aqi')),
    h('span', { class: 'badge', style: `background:${a.color}` }, f0(a.aqi) + ' ' + t(a.key)),
    h('span', { class: 'msub' }, `${t('aqi_dominant')}: ${POLLUTANT_LABEL[a.dominant] || a.dominant}`));
}

/* ================= TODAY ================= */
export function renderToday(el, ctx) {
  const p = ctx.payload, t = ctx.t;
  el.classList.remove('solid');
  const cur = p.current;
  const condLabel = t(wmoInfo(cur.code).labelKey);
  const d0 = p.daily[0];
  const mono = monsoonStatus(Date.now(), p.loc.lat);

  const tempEl = h('div', { class: 'temp' }, '--°');
  const hero = h('section', { class: 'hero', 'aria-label': t('nav_today') },
    h('span', { html: iconSvg(cur.code, cur.isDay) }),
    tempEl,
    h('div', { class: 'cond' }, condLabel),
    h('div', { class: 'sub' }, `${t('feels_like')} ${ctx.fmtTemp(cur.feelsLikeC)}`),
    h('div', { class: 'hl' }, `${t('h_label')}:${ctx.fmtTemp(d0?.highC)}  ${t('l_label')}:${ctx.fmtTemp(d0?.lowC)}`));
  const root = h('div');
  root.append(hero);
  const nc = nowcastEl(t, p);
  if (nc) root.append(nc);

  // IMD-style alerts — above the fold
  root.append(alertBanners(t, p));

  // Monsoon status (PRD: visible without hunting, during season)
  const monoKey = { not_yet_arrived: 'monsoon_not_yet_arrived', onset: 'monsoon_onset', active: 'monsoon_active', withdrawing: 'monsoon_withdrawing', withdrawn: 'monsoon_withdrawn', offseason: 'monsoon_offseason' }[mono.status];
  root.append(h('div', { class: 'card', style: 'margin-bottom:10px' },
    h('h3', {}, '🌧 ', t('monsoon_title')),
    h('span', { class: 'badge', style: `background:${mono.status === 'active' ? 'var(--aqi-good)' : mono.status === 'offseason' ? '#b7c2cc' : 'var(--aqi-moderate)'}` }, t(monoKey))));

  // Hourly (0–24h, 24–48h)
  root.append(h('div', { class: 'card' }, h('h3', {}, t('hourly_next48')), hourlyStrip(p, t, ctx.fmtTemp, wallNow(p.utcOffset), 24)));
  root.append(h('div', { class: 'card', style: 'margin-top:10px' },
    h('h3', {}, '24–48h'), hourlyStrip(p, t, ctx.fmtTemp, wallNow(p.utcOffset) + 24 * 3600000, 24)));

  // Metric grid
  const uv = uvCategory(cur.uv);
  const mp = moonPhase(new Date(wallNow(p.utcOffset)));
  const grid = h('div', { class: 'grid', style: 'margin-top:10px' },
    windCard(t, ctx, p),
    h('div', { class: 'card metric' }, h('h3', {}, t('uv_index')),
      uv ? h('span', { class: 'badge', style: `background:${uv.color}` }, f1(cur.uv) + ' · ' + t(uv.key)) : h('span', { class: 'msub' }, '—'),
      uv ? h('span', { class: 'msub' }, t('uv_guideline_' + uv.key.split('_')[1])) : null),
    aqiChip(t, p),
    sunArcCard(t, p),
    h('div', { class: 'card metric' }, h('h3', {}, t('humidity')),
      h('span', { class: 'mval' }, f0(cur.humidityPct) + '%'),
      h('span', { class: 'msub' }, `${t('dew_point')}: ${ctx.fmtTemp(cur.dewPointC)}`)),
    pressureCard(t, ctx, p),
    h('div', { class: 'card metric' }, h('h3', {}, t('visibility')),
      h('span', { class: 'mval' }, cur.visibilityKm != null ? f1(cur.visibilityKm) + ' km' : '—')),
    h('div', { class: 'card metric' }, h('h3', {}, t('moon')),
      h('span', { class: 'mval', style: 'font-size:14px' }, t(mp.key)),
      h('span', { class: 'msub' }, Math.round(mp.frac * 100) + '%')));
  root.append(grid);

  // AQI prominence for polluted days (PRD 6.6) + 10-day preview
  const a = p.aqi && p.aqi.computed;
  if (a && a.aqi > 200) {
    root.prepend(h('div', { class: `alert sev-${a.aqi > 300 ? 'red' : 'orange'}` },
      h('span', { class: 'ahead' }, h('span', { class: 'sevword' }, t(a.key)), h('span', {}, t('aqi') + ': ' + f0(a.aqi)))));
  }
  root.append(h('div', { class: 'card', style: 'margin-top:10px' },
    h('h3', {}, t('daily_10')),
    p.daily.slice(0, 3).map((d, i) => dayRow(t, ctx, p, d, i, false)),
    h('a', { href: '#/forecast', class: 'pillbtn', style: 'display:inline-block;margin-top:8px;text-decoration:none' }, t('daily_view_full'))));

  root.append(h('p', { class: 'updated' }, `${t('updated')}: ${hhmm(p.fetchedAt + p.utcOffset * 1000)}`));
  el.replaceChildren(root);
  countUp(tempEl, Math.round(ctx.units.temp(cur.tempC)), ctx.units.tempKey);
}

/* ================= FORECAST ================= */
function dayRow(t, ctx, p, d, i, expandable = true) {
  const wt = wallParse(d.date + 'T12:00');
  const dname = i === 0 ? t('today') : t('day_' + new Date(wt).getUTCDay());
  const row = h('button', { class: 'dayrow', 'aria-expanded': 'false' },
    h('span', { class: 'dname' }, dname),
    h('span', { html: iconSvg(d.code, true) }),
    h('span', { class: 'dhi' }, ctx.fmtTemp(d.highC) + ' / ' + ctx.fmtTemp(d.lowC)),
    h('span', { class: 'rangebar' }, h('span', { class: 'fill' })),
    h('span', { class: 'pp' }, d.precipProb != null ? f0(d.precipProb) + '%' : ''));
  if (!expandable) {
    row.setAttribute('disabled', '');
    row.style.cursor = 'default';
    row.style.gridTemplateColumns = '88px 40px 110px 1fr 52px';
    return row;
  }
  const detail = h('div', { class: 'daydetail', hidden: true });
  row.addEventListener('click', () => {
    const open = detail.hidden;
    detail.hidden = !open;
    row.setAttribute('aria-expanded', String(open));
    if (open && detail.childElementCount === 0) detail.append(hourlyStrip(p, ctx.t, ctx.fmtTemp, wallParse(d.date + 'T00:00'), 24));
  });
  return h('div', {}, row, detail);
}
export function renderForecast(el, ctx) {
  const p = ctx.payload, t = ctx.t;
  el.classList.remove('solid');
  const root = h('div');
  root.append(alertBanners(t, p));
  const card = h('div', { class: 'card' }, h('h3', {}, t('daily_10')), h('p', { class: 'mono-note' }, t('tap_expand')));
  const lo = Math.min(...p.daily.map(d => d.lowC ?? 999)), hi = Math.max(...p.daily.map(d => d.highC ?? -999));
  p.daily.forEach((d, i) => {
    const node = dayRow(t, ctx, p, d, i);
    const fill = node.querySelector('.fill');
    if (fill && d.lowC != null && d.highC != null) {
      fill.style.left = ((d.lowC - lo) / (hi - lo || 1)) * 100 + '%';
      fill.style.right = 100 - ((d.highC - lo) / (hi - lo || 1)) * 100 + '%';
    }
    card.append(node);
  });
  root.append(card, h('p', { class: 'updated' }, `${t('updated')}: ${hhmm(p.fetchedAt + p.utcOffset * 1000)}`));
  el.replaceChildren(root);
}

/* ================= AIR & UV ================= */
export function renderAir(el, ctx) {
  const p = ctx.payload, t = ctx.t;
  el.classList.remove('solid');
  const root = h('div');
  root.append(alertBanners(t, p));
  const a = p.aqi && p.aqi.computed;
  const aqiCard = h('div', { class: 'card' },
    h('h3', {}, '◍ ' + t('aqi')),
    a
      ? h('div', { class: 'aqi-hero' },
          h('span', { class: 'aqi-num', style: `background:${a.color}` }, f0(a.aqi)),
          h('div', {},
            h('div', { style: 'font-size:26px' }, t(a.key)),
            h('div', { class: 'msub' }, `${t('aqi_dominant')}: ${POLLUTANT_LABEL[a.dominant] || a.dominant}`)))
      : h('p', { class: 'msub' }, t('aqi_unavailable')),
    a ? h('p', { class: 'mono-note' }, 'CPCB National AQI · computed from CAMS pollutant concentrations') : null);
  const pollCard = h('div', { class: 'card' }, h('h3', {}, t('aqi_dominant') + 's'));
  if (a) {
    POLLUTANT_ORDER.forEach(k => {
      const s = a.subs[k];
      if (!s) {
        pollCard.append(h('div', { class: 'pollut' }, h('span', {}, POLLUTANT_LABEL[k]), h('span', { class: 'pbar' }), h('span', {}, t('aqi_na'))));
        return;
      }
      const cat = aqiCategory(s.sub);
      pollCard.append(h('div', { class: 'pollut' },
        h('span', {}, POLLUTANT_LABEL[k]),
        h('span', { class: 'pbar' }, h('span', { class: 'pfill', style: `width:${clamp((s.sub / 500) * 100, 2, 100)}%;background:${cat.color}` })),
        h('span', { style: `color:${cat.color};font-weight:bold` }, f0(s.sub))));
    });
    pollCard.append(h('p', { class: 'mono-note' }, t('aqi') + ': ' + POLLUTANT_ORDER.map(k => POLLUTANT_LABEL[k] + ' ' + f0(a.subs[k]?.sub ?? NaN).replace('NaN', '—')).join(' · ')));
  }
  const uvNow = uvCategory(p.current.uv);
  const uvCard = h('div', { class: 'card' }, h('h3', {}, '☀ ' + t('uv_index')),
    uvNow
      ? h('div', { class: 'aqi-hero' },
          h('span', { class: 'aqi-num', style: `background:${uvNow.color}` }, f1(p.current.uv)),
          h('div', {}, h('div', { style: 'font-size:26px' }, t(uvNow.key))))
      : h('p', { class: 'msub' }, '—'),
    h('div', { class: 'uv-scale' }, ['var(--aqi-good)', 'var(--aqi-satisfactory)', 'var(--aqi-moderate)', 'var(--aqi-poor)', 'var(--aqi-very-poor)', 'var(--aqi-severe)'].map(c => h('i', { style: `background:${c}` }))),
    uvNow ? h('p', { class: 'msub' }, t('uv_guideline_' + uvNow.key.split('_')[1])) : null);
  // 3-day AQI/UV strip from CAMS hourly PM2.5 sub-index + forecast UV
  const strip = h('div', { class: 'card' }, h('h3', {}, t('air_forecast')));
  const perDay = new Map();
  if (p.aqi && p.aqi.forecastHours) {
    for (const row of p.aqi.forecastHours) {
      if (row.aqiSub == null) continue;
      const day = row.time.slice(0, 10);
      const cur = perDay.get(day) || { pm: 0, uv: 0 };
      cur.pm = Math.max(cur.pm, row.aqiSub);
      if (row.uv != null) cur.uv = Math.max(cur.uv, row.uv);
      perDay.set(day, cur);
    }
  }
  [...perDay.entries()].slice(0, 3).forEach(([day, v]) => {
    const sub = cpcbSubOf(v.pm);
    const cat = aqiCategory(sub);
    const uvc = uvCategory(v.uv);
    strip.append(h('div', { class: 'locrow' },
      h('span', { class: 'dname' }, day.slice(5)),
      h('span', { class: 'badge', style: `background:${cat.color}` }, f0(sub) + ' ' + t(cat.key)),
      h('span', { class: 'ltemp' }, 'UV ' + (v.uv != null ? f1(v.uv) + (uvc ? ' ' + t(uvc.key) : '') : '—'))));
  });
  if (!perDay.size) strip.append(h('p', { class: 'msub' }, t('aqi_unavailable')));
  root.append(aqiCard, pollCard, uvCard, strip,
    h('p', { class: 'updated' }, `${t('updated')}: ${hhmm(p.fetchedAt + p.utcOffset * 1000)}`));
  el.replaceChildren(root);
}
function cpcbSubOf(pm25Max) { // PM2.5 24h max -> CPCB sub-index (worst band used conservatively)
  if (pm25Max == null) return 0;
  const BP = [[15, 50], [30, 100], [90, 200], [120, 300], [250, 400], [500, 500]];
  for (const [c, i] of BP) if (pm25Max <= c) return i;
  return 500;
}

/* ================= LOCATIONS ================= */
export function renderLocations(el, ctx) {
  const t = ctx.t;
  el.classList.remove('solid');
  const root = h('div');
  root.append(h('div', { class: 'card', style: 'margin-bottom:10px' },
    h('button', { class: 'pillbtn', onclick: () => ctx.openSearch(), style: 'width:100%' }, '🔍 ' + t('loc_add_first'))));
  const list = h('div', { class: 'card' });
  const locs = ctx.store.locations;
  if (!locs.length) list.append(h('p', { class: 'msub' }, t('loc_empty')));
  locs.forEach((loc, i) => {
    const cached = ctx.store.data[loc.id];
    const cur = cached && cached.current;
    const row = h('div', { class: 'locrow' + (loc.id === ctx.store.activeId ? ' cur' : '') },
      h('div', { class: 'lname', onclick: () => { ctx.setActive(loc.id); location.hash = '#/today'; } },
        h('div', { style: 'font-size:22px' }, loc.name,
          loc.isCurrentLocation ? h('span', { class: 'badge', style: 'background:var(--sky-accent);margin-left:8px' }, t('loc_current')) : null),
        h('div', { class: 'lsub' }, loc.region || `${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°`),
        cur ? h('div', { class: 'lsub' }, t(wmoInfo(cur.code).labelKey)) : null),
      cur ? h('span', { html: iconSvg(cur.code, cur.isDay) }) : h('span', { class: 'ltemp' }, '…'),
      cur ? h('span', { class: 'ltemp' }, ctx.fmtTemp(cur.tempC)) : null,
      h('div', { class: 'locbtns' },
        h('button', { class: 'minibtn', 'aria-label': t('loc_up'), disabled: i === 0 ? '' : null, onclick: () => ctx.moveLoc(i, -1) }, '▲'),
        h('button', { class: 'minibtn', 'aria-label': t('loc_down'), disabled: i === locs.length - 1 ? '' : null, onclick: () => ctx.moveLoc(i, +1) }, '▼'),
        h('button', { class: 'minibtn danger', 'aria-label': t('loc_remove'), onclick: () => ctx.removeLoc(loc.id) }, '✕')));
    list.append(row);
  });
  root.append(list, h('p', { class: 'mono-note' }, `${t('updated')}: ${locs.length ? hhmm((ctx.store.data[ctx.store.activeId]?.fetchedAt ?? Date.now()) + (ctx.payload?.utcOffset ?? 19800) * 1000) : '—'}`));
  el.replaceChildren(root);
}

/* ================= MAP ================= */
const mapState = { map: null, grid: null, markers: null, layer: 'temp', line: null };

function tempColor(t) { if (t == null) return '#555'; const hue = clamp(250 - ((t + 5) / 55) * 250, 0, 250); return `hsl(${hue},70%,52%)`; }
function precipColor(mm) { if (mm == null || mm <= 0.05) return 'rgba(120,150,170,.25)'; const i = clamp(mm / 25, 0, 1); return `rgba(${Math.round(40 + 60 * i)},${Math.round(160 - 90 * i)},${Math.round(230 - 30 * i)},${0.45 + 0.4 * i})`; }
function cloudColor(p) { if (p == null) return 'rgba(120,120,140,.2)'; return `rgba(255,255,255,${0.12 + (p / 100) * 0.75})`; }
function windColor(v) { if (v == null) return '#555'; const l = clamp(65 - (v / 60) * 35, 30, 70); const hue = clamp(180 - (v / 60) * 180, 0, 180); return `hsl(${hue},65%,${l}%)`; }
const LAYERS = [
  { id: 'temp', color: g => tempColor(g.tempC) },
  { id: 'precip', color: g => precipColor(g.precipMm) },
  { id: 'cloud', color: g => cloudColor(g.cloudPct) },
  { id: 'wind', color: g => windColor(g.windKmh) },
  { id: 'monsoon' }, { id: 'cyclone' },
];

export function renderMap(host, ctx, onCleanup) {
  const t = ctx.t;
  host.hidden = true;
  const wrap = h('div', { class: 'mapwrap' },
    h('div', { class: 'maptop' },
      ...LAYERS.map(l => h('button', { class: 'layerpill' + (l.id === mapState.layer ? ' on' : ''), 'data-layer': l.id, onclick: (e) => setLayer(l.id) }, t('layer_' + l.id))),
      h('input', { id: 'map-search', class: 'mapsearch', placeholder: t('map_search_ph'), 'aria-label': t('map_search_ph') })),
    h('div', { id: 'map' }),
    h('div', { class: 'maplegend', id: 'maplegend' }));
  host.parentElement.appendChild(wrap);
  const legend = wrap.querySelector('#maplegend');

  if (!mapState.map) {
    const map = L.map('map', { zoomSnap: 0.5, minZoom: 3.5 }).setView([22.5, 82], 4.5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors © CARTO', subdomains: 'abcd', maxZoom: 12,
    }).addTo(map);
    mapState.map = map;
    map.on('zoomend', () => {
      if (!mapState.markers) return;
      const r = Math.max(5, (256 * Math.pow(2, map.getZoom())) / 360 * 0.55);
      mapState.markers.forEach(m => m.setRadius(r));
    });
  }
  const map = mapState.map;
  setTimeout(() => map.invalidateSize(), 50);

  function popupHtml(g) {
    const title = `${g.lat.toFixed(1)}°N, ${g.lon.toFixed(1)}°E`;
    return `<div><b>${title}</b><br>${t('layer_temp')}: ${g.tempC != null ? Math.round(g.tempC) : '—'}°C · ${t('layer_precip')}: ${g.precipMm ?? '—'} mm<br>${t('layer_cloud')}: ${g.cloudPct ?? '—'}% · ${t('layer_wind')}: ${g.windKmh != null ? Math.round(g.windKmh) : '—'} km/h<br>
      <button class="pillbtn map-details" data-lat="${g.lat}" data-lon="${g.lon}" data-name="${title}" style="margin-top:6px">${t('view_full_details')}</button></div>`;
  }
  function drawGrid() {
    if (mapState.markers) mapState.markers.forEach(m => m.remove());
    const renderer = L.canvas({ padding: 0.4 });
    const layer = LAYERS.find(l => l.id === mapState.layer);
    mapState.markers = mapState.grid.map(g => L.circleMarker([g.lat, g.lon], {
      renderer, radius: 10, weight: 0, fillColor: layer.color(g), fillOpacity: 0.75,
    }).addTo(map).bindPopup(popupHtml(g), { maxWidth: 240 }));
    const r = Math.max(5, (256 * Math.pow(2, map.getZoom())) / 360 * 0.55);
    mapState.markers.forEach(m => m.setRadius(r));
  }
  function legendHtml(id) {
    const rows = {
      temp: [['-10°', tempColor(-10)], ['5°', tempColor(5)], ['20°', tempColor(20)], ['35°', tempColor(35)], ['45°+', tempColor(48)]],
      precip: [['0', precipColor(0)], ['2mm', precipColor(2)], ['8mm', precipColor(8)], ['20mm+', precipColor(25)]],
      cloud: [['0%', cloudColor(0)], ['50%', cloudColor(50)], ['100%', cloudColor(100)]],
      wind: [['5', windColor(5)], ['30', windColor(30)], ['60', windColor(60)]],
    }[id];
    return rows.map(([lbl, c]) => `<div class="lg-row"><span class="sw" style="background:${c}"></span>${lbl}</div>`).join('');
  }
  function setLayer(id) {
    mapState.layer = id;
    wrap.querySelectorAll('.layerpill').forEach(b => b.classList.toggle('on', b.dataset.layer === id));
    if (mapState.line) { mapState.line.remove(); mapState.line = null; }
    legend.innerHTML = '';
    if (['temp', 'precip', 'cloud', 'wind'].includes(id)) {
      drawGrid();
      legend.innerHTML = legendHtml(id);
    } else {
      if (mapState.markers) mapState.markers.forEach(m => m.remove());
      if (id === 'monsoon') {
        const now = new Date();
        const m = now.getMonth() + 1, day = now.getDate();
        const inSeason = (m >= 6 && m <= 9) || (m === 10 && day <= 15) || (m === 12 && day >= 15) || m === 11;
        if (inSeason) {
          const status = monsoonStatus(now.getTime(), 20);
          const pts = [];
          for (let lon = 66; lon <= 98; lon += 1) pts.push([status.lineLat, lon]);
          mapState.line = L.polyline(pts, { color: '#7FD4C8', weight: 4, dashArray: '8 8' }).addTo(map)
            .bindTooltip(t('monsoon_line_label'), { sticky: true });
          legend.innerHTML = `<div class="lg-row"><span class="sw" style="background:#7FD4C8"></span>${t('monsoon_line_label')}</div><div class="lg-row">${t('monsoon_' + status.status)}</div>`;
        } else {
          legend.innerHTML = `<div class="lg-row">${t('monsoon_inactive')}</div>`;
        }
      } else if (id === 'cyclone') {
        legend.innerHTML = `<div class="lg-row">${t('cyclone_none')}</div>`;
      }
    }
  }
  mapState.setLayer = setLayer;

  // grid data (cached 30 min, single batched request)
  const GRID_TTL = 30 * 60000;
  (async () => {
    legend.innerHTML = `<div class="lg-row">…</div>`;
    try {
      if (!mapState.grid || Date.now() - (mapState.gridAt || 0) > GRID_TTL) {
        const { fetchGrid } = await import('./api.js');
        mapState.grid = await fetchGrid();
        mapState.gridAt = Date.now();
      }
      setLayer(mapState.layer);
    } catch (err) {
      legend.innerHTML = `<div class="lg-row">⚠ ${t('net_fail')}</div>`;
    }
  })();
  // map search (debounced)
  const si = wrap.querySelector('#map-search');
  let deb;
  si.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(async () => {
    const q = si.value.trim();
    if (q.length < 2) return;
    try {
      const { geocode } = await import('./api.js');
      const res = await geocode(q, ctx.lang);
      if (mapState.searchMarker) { mapState.searchMarker.remove(); mapState.searchMarker = null; }
      if (res.length) {
        const r = res[0];
        mapState.searchMarker = L.circleMarker([r.lat, r.lon], { radius: 9, color: '#FFD75E', weight: 3, fillOpacity: 0 }).addTo(map);
        map.flyTo([r.lat, r.lon], 7);
      }
    } catch { /* keep the map usable */ }
  }, 400); });
  // popup → full details
  mapState.detailsHandler = (e) => {
    const b = e.target.closest && e.target.closest('.map-details');
    if (!b) return;
    ctx.addPointLocation(+b.dataset.lat, +b.dataset.lon, b.dataset.name);
    location.hash = '#/today';
  };
  document.addEventListener('click', mapState.detailsHandler);

  onCleanup(() => {
    document.removeEventListener('click', mapState.detailsHandler);
    wrap.remove();
    if (mapState.map) { mapState.map.remove(); mapState.map = null; }
    mapState.markers = null; mapState.line = null;
    host.hidden = false;
  });
  setLayer(mapState.layer);
}
