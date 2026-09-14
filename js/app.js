// Mausam app controller — store, routing, geolocation, search, unit/language toggles.
import { makeT } from './i18n.js';
import { UNITS, skyMood, f0, f1, monsoonStatus, REDUCED_MOTION } from './util.js';
import { fetchBundle, geocode } from './api.js';
import { renderSky } from './sky.js';
import * as V from './views.js';

const LS_KEY = 'mausam:v1';
const REFRESH_MS = 15 * 60000; // data older than this is refreshed on view change

const store = Object.assign({ lang: 'en', units: 'metric', locations: [], activeId: null, data: {} },
  JSON.parse(localStorage.getItem(LS_KEY) || 'null') || {});
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch { /* private mode */ } }

const $ = (s) => document.querySelector(s);
const viewEl = $('#view');
let t = makeT(store.lang);
const toastEl = $('#toast');
let toastTimer;
function toast(msg, ms = 4000) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

/* ---------- formatting (single canonical store, client-side conversion — PRD §8) ---------- */
const U = () => UNITS[store.units];
const fmtTemp = (c) => (c == null ? '—' : Math.round(U().temp(c)) + '°');
const ctx = {
  get t() { return makeT(store.lang); },
  get lang() { return store.lang; },
  get units() { return U(); },
  get store() { return store; },
  get payload() { return store.activeId ? store.data[store.activeId] : null; },
  fmtTemp, openSearch: () => openSearch(), setActive: setActive, moveLoc, removeLoc,
  addPointLocation,
};

/* ---------- sky + header ---------- */
function updateSky() {
  const p = ctx.payload;
  if (!p) return;
  const cur = p.current;
  const mono = monsoonStatus(Date.now(), p.loc.lat);
  const recentPrecip = p.nowcast ? p.nowcast.reduce((s, r) => s + (r.mm || 0), 0) : (p.hourly.find(r => r.time >= V.wallNow(p.utcOffset) - 3600000)?.precipMm ?? 0);
  const mood = skyMood(cur.code, cur.isDay, cur.tempC, recentPrecip, mono.status === 'active' || mono.status === 'onset', cur.humidityPct);
  renderSky(mood, cur.isDay ? 1 : 0);
  $('#loc-name').textContent = p.loc.name;
  $('#loc-temp').textContent = fmtTemp(cur.tempC);
  document.title = `${p.loc.name} · ${fmtTemp(cur.tempC)} — Mausam मौसम`;
}
function applyLang() {
  document.documentElement.lang = store.lang;
  $('#lang-btn').textContent = store.lang === 'en' ? 'हिं' : 'EN';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  const si = $('#search-input');
  if (si) si.placeholder = t('search_placeholder');
  const ms = $('#map-search');
  if (ms) ms.placeholder = t('map_search_ph');
}

/* ---------- data loading (cache-first, never a blank screen — PRD §9) ----------
   `fetching` is supersede-able: selecting a new location while any request is in
   flight starts a fetch for the NEW location instead of being swallowed. */
let fetching = null; // { locId, promise }
async function ensureActive({ force = false } = {}) {
  const loc = store.locations.find(l => l.id === store.activeId);
  if (!loc) return;
  const cached = store.data[store.activeId];
  const fresh = cached && Date.now() - cached.fetchedAt < REFRESH_MS;
  if (cached && (!force && fresh)) { route(); updateSky(); return; }
  if (cached) { route(); updateSky(); showStale(cached.fetchedAt); }
  if (fetching && fetching.locId === loc.id && !force) return fetching.promise;
  if (!cached) renderLoading(true); // switching to a place with no cache yet -> explicit loading
  const promise = (async () => {
    try {
      const payload = await fetchBundle(loc);
      payload.utcOffset = payload.utcOffset ?? 19800;
      store.data[loc.id] = payload;
      save();
      hideStale();
      if (store.activeId === loc.id) { route(); updateSky(); }
    } catch (err) {
      console.warn('fetch failed for', loc.id, err);
      const cachedNow = store.data[loc.id];
      if (cachedNow) {
        showStale(cachedNow.fetchedAt);
        toast(t('net_fail'));
        if (store.activeId === loc.id) { route(); updateSky(); }
      } else if (store.activeId === loc.id) {
        viewEl.replaceChildren(V.h('div', { class: 'loading' }, '⚠ ', t('net_fail'),
          V.h('div', { style: 'margin-top:14px' }, V.h('button', { class: 'pillbtn', onclick: () => ensureActive({ force: true }) }, t('retry')))));
      }
    } finally {
      if (fetching && fetching.promise === promise) fetching = null;
    }
  })();
  fetching = { locId: loc.id, promise };
  return promise;
}
function showStale(fetchedAt) {
  const p = ctx.payload;
  $('#stale-bar').hidden = false;
  $('#stale-msg').textContent = t('stale_banner', { time: V.hhmm(fetchedAt + (p?.utcOffset ?? 19800) * 1000) });
}
function hideStale() { $('#stale-bar').hidden = true; }
function renderLoading() {
  if (ctx.payload) return;
  viewEl.replaceChildren(V.h('div', { class: 'loading' }, t('loading'), V.h('div', { class: 'px' }, '▓▓▓')));
}

/* ---------- router ---------- */
let mapCleanup = null;
const ROUTES = { today: V.renderToday, forecast: V.renderForecast, air: V.renderAir, locations: V.renderLocations };
function route() {
  const name = (location.hash.replace('#/', '') || 'today').split('?')[0];
  if (!ROUTES[name] && name !== 'map') { location.hash = '#/today'; return; }
  document.querySelectorAll('.navitem').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
  if (mapCleanup) { mapCleanup(); mapCleanup = null; }
  if (name === 'map') {
    V.renderMap(viewEl, ctx, (fn) => { mapCleanup = fn; });
    return;
  }
  viewEl.hidden = false;
  const p = ctx.payload;
  if (!p) { renderLoading(); ensureActive(); return; }
  ROUTES[name](viewEl, { ...ctx, t: makeT(store.lang), payload: p });
}
window.addEventListener('hashchange', route);

/* ---------- location management ---------- */
function locId(lat, lon) { return `${(+lat).toFixed(3)},${(+lon).toFixed(3)}`; }
function upsertLoc(loc, { activate = true } = {}) {
  const id = loc.id || locId(loc.lat, loc.lon);
  const existing = store.locations.find(l => l.id === id);
  if (existing) Object.assign(existing, loc, { id });
  else store.locations.push({ ...loc, id });
  if (activate) store.activeId = id;
  save();
  ensureActive({ force: true });
}
function setActive(id) {
  if (!store.locations.find(l => l.id === id)) return;
  store.activeId = id;
  save();
  updateSky();
  ensureActive();
}
function moveLoc(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= store.locations.length) return;
  [store.locations[i], store.locations[j]] = [store.locations[j], store.locations[i]];
  save(); route();
}
function removeLoc(id) {
  store.locations = store.locations.filter(l => l.id !== id);
  delete store.data[id];
  if (store.activeId === id) store.activeId = store.locations[0]?.id ?? null;
  save(); updateSky(); route();
  if (!store.activeId) openSearch();
}
/* map popup "View full details" — ad-hoc coordinate location */
function addPointLocation(lat, lon, name) {
  upsertLoc({ id: locId(lat, lon), name, region: '', lat, lon, timezone: 'Asia/Kolkata', isCurrentLocation: false });
}
/* per-location small payload for the Locations list */
async function prefetch(loc) {
  if (store.data[loc.id] && Date.now() - store.data[loc.id].fetchedAt < REFRESH_MS) return;
  try { store.data[loc.id] = await fetchBundle(loc); save(); } catch { /* offline ok */ }
}

/* ---------- search overlay (debounced autocomplete, whole-country — PRD 6.7) ---------- */
const overlay = $('#search-overlay');
const searchInput = $('#search-input');
const searchResults = $('#search-results');
const searchHint = $('#search-hint');
let deb = null;
const searchIndex = new Map(); // stable key -> geocode result

function resultKey(r) { return r.id || `${(+r.lat).toFixed(4)},${(+r.lon).toFixed(4)}`; }

function openSearch() {
  overlay.hidden = false;
  searchInput.value = '';
  searchResults.replaceChildren();
  searchHint.textContent = t('search_hint_empty');
  searchInput.focus();
}
function closeSearch() { overlay.hidden = true; }
searchInput.addEventListener('input', () => {
  clearTimeout(deb); deb = setTimeout(() => doSearch(searchInput.value.trim()), 350); // PRD §8 debounce
});
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(searchInput.value.trim()); });
$('#search-close').addEventListener('click', closeSearch);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSearch(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) closeSearch(); });

async function doSearch(q) {
  if (q.length < 2) return;
  searchHint.textContent = '…';
  try {
    const found = await geocode(q, store.lang);
    found.sort((a, b) => b.population - a.population);
    searchIndex.clear();
    found.forEach(r => searchIndex.set(resultKey(r), r));
    // Each row embeds its own coordinates in data-* attributes, so a selection
    // works even if this list is rebuilt mid-click by a debounced re-search.
    searchResults.replaceChildren(...found.map(r => {
      const key = resultKey(r);
      return V.h('li', {}, V.h('button', {
        type: 'button', role: 'option', 'data-key': key,
        'data-lat': r.lat, 'data-lon': r.lon, 'data-name': r.name,
        'data-region': r.region || '', 'data-tz': r.timezone || '',
      },
        V.h('span', {}, r.name), V.h('span', { class: 'rsub' }, r.region)));
    }));
    searchHint.textContent = found.length ? '' : t('search_none_at_all');
  } catch (err) {
    console.warn('search failed', err);
    searchHint.textContent = t('net_fail');
  }
}

/* Event delegation: ONE listener on the list — always fires for any row,
   current or freshly rebuilt (click + keyboard). */
searchResults.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-key]');
  if (btn) selectResult(btn.dataset.key, btn);
});
searchResults.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const btn = e.target.closest('button[data-key]');
  if (!btn) return;
  e.preventDefault();
  selectResult(btn.dataset.key, btn);
});

/* Selection: (1) close modal, (2) resolve coords/id, (3) fetch via upsertLoc ->
   ensureActive(force), (4) dashboard re-renders on arrival (route + updateSky). */
function selectResult(key, btn) {
  const r = searchIndex.get(key) || (btn && {
    key, lat: +btn.dataset.lat, lon: +btn.dataset.lon,
    name: btn.dataset.name, region: btn.dataset.region, timezone: btn.dataset.tz,
  });
  if (!r || r.lat == null || isNaN(r.lat)) return;
  closeSearch();
  upsertLoc({
    id: key, name: r.name, region: r.region, lat: r.lat, lon: r.lon,
    timezone: r.timezone || 'Asia/Kolkata', isCurrentLocation: false,
  });
  if (!location.hash.startsWith('#/today')) location.hash = '#/today';
  else route(); // same hash -> no hashchange event, so re-render explicitly
  toast(r.name);
}

/* ---------- unit / language toggles (instant, no reload — PRD acceptance 6) ---------- */
$('#unit-btn').addEventListener('click', () => {
  store.units = store.units === 'metric' ? 'imperial' : 'metric';
  $('#unit-btn').textContent = store.units === 'metric' ? '°C' : '°F';
  save(); route(); updateSky();
});
$('#lang-btn').addEventListener('click', () => {
  store.lang = store.lang === 'en' ? 'hi' : 'en';
  t = makeT(store.lang);
  save(); applyLang(); route(); updateSky();
});
$('#refresh-btn').addEventListener('click', () => { fetching = null; ensureActive({ force: true }); });
$('#stale-retry').addEventListener('click', () => { fetching = null; hideStale(); ensureActive({ force: true }); });
$('#loc-btn').addEventListener('click', openSearch);

/* ---------- geolocation boot (graceful, never a dead end — PRD §9) ---------- */
function detectLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err), { timeout: 10000, maximumAge: 600000 });
  });
}
async function reverseName(lat, lon) {
  // lightweight nearest-place naming via geocoding (coordinates search fallback: label)
  return `${(+lat).toFixed(2)}°N, ${(+lon).toFixed(2)}°E`;
}
async function boot() {
  $('#unit-btn').textContent = store.units === 'metric' ? '°C' : '°F';
  applyLang();
  if (store.activeId && store.locations.find(l => l.id === store.activeId)) {
    updateSky(); route(); ensureActive();
    store.locations.forEach(l => { if (l.id !== store.activeId) prefetch(l); });
    return;
  }
  route(); // loading screen
  try {
    const { lat, lon } = await detectLocation();
    // India check — worldwide coords still work, but the v1 promise is India (PRD §3)
    const inIndia = lat > 5.5 && lat < 38.5 && lon > 67 && lon < 98;
    const name = inIndia ? await guessName(lat, lon) : await reverseName(lat, lon);
    upsertLoc({ name, region: '', lat, lon, timezone: 'Asia/Kolkata', isCurrentLocation: true });
  } catch (err) {
    toast(err && err.code === 1 ? t('geo_denied') : t('geo_failed'));
    renderLoading();
    openSearch(); // immediate non-blocking fallback — PRD acceptance 1
  }
}
async function guessName(lat, lon) {
  // nearest well-known place via a coarse geocode by coordinates is not supported by
  // Open-Meteo geocoding; label with coordinates unless a saved name exists.
  return reverseName(lat, lon);
}
boot();
// periodic silent refresh while open (keeps alerts/nowcast current)
setInterval(() => { if (document.visibilityState === 'visible' && ctx.payload) ensureActive({ force: true }); }, REFRESH_MS);
