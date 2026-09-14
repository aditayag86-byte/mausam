# Mausam · मौसम — a nationwide weather app for India

A fully responsive, no-build weather web app built to the Mausam PRD v1.0: living-sky
condition backgrounds, CPCB-scale air quality, IMD-style colour-coded alerts, monsoon
tracking, minute-level nowcasting, and a nationwide interactive map — with full
English ⇄ हिन्दी UI translation and pixel-art typography (Press Start 2P + VT323;
Noto Sans Devanagari renders Hindi cleanly as the fallback).

## Run it

```bash
node server.mjs        # → http://localhost:8123   (zero dependencies)
# or any static server, e.g.: npx http-server -p 8123 -c-1 .
npm test               # live API validation of every endpoint used
```

No build step, no API keys. Open http://localhost:8123 and allow geolocation
(or search — the fallback is immediate and non-blocking).

## Data provider — Open-Meteo (selected after India-coverage evaluation)

| Need (PRD §7) | Used endpoint | Notes |
|---|---|---|
| Current conditions, hourly 48 h, daily 10 d, UV, wind/gusts, pressure, visibility, dew point | `api.open-meteo.com/v1/forecast` | Best-match model per location; strong Tier-2/3 resolution. One request returns all of it. |
| Minute-level precipitation nowcast | `minutely_15` variables, `forecast_minutely_15=8` | 15-minute resolution; element is omitted entirely where unavailable (PRD §9). |
| AQI + pollutant breakdown | `air-quality-api.open-meteo.com` (CAMS) | Raw concentrations (PM2.5, PM10, NO₂, SO₂, O₃, CO). **CPCB National AQI is computed client-side** from official CPCB breakpoints (`js/util.js`) — never the US EPA scale. NH₃ is Europe-only in CAMS and shows as "—" outside it. |
| Nationwide search (cities/towns/districts) | `geocoding-api.open-meteo.com/v1/search` | `countryCode=IN` filter + `language=hi` for Hindi place names; results re-filtered to `country_code === 'IN'`. |
| Map layers | Same forecast API, **one batched request** for ~930 grid points (6.5–36.5°N × 68.5–96.5°E, ≤1000-location limit) | Leaflet canvas circle markers recoloured per layer. |
| Severe alerts (IMD Green/Yellow/Orange/Red) | **Derived** from the daily forecast (`js/util.js: deriveAlerts`) | Thresholds follow IMD conventions: heatwave ≥40/45/47 °C, cold-wave ≤10/4 °C, heavy rain ≥64.5/115.6/204.5 mm·day⁻¹, thunderstorm codes 95–99. Every alert banner pairs the colour with the severity *word* and plain-language advice. No free real-time IMD bulletin feed exists, so alerts are forecast-derived and labelled as such in the UI. |
| Monsoon progress | **Derived proxy** from the typical IMD onset/withdrawal calendar (onset line ~8°N Jun 1 → ~35°N Jul 15; withdrawal retreats Sep 17 → Dec 15) | Powers the Today-view status chip and the dashed map line, hidden outside the season. |
| Cyclones | Not available from a keyless feed | The layer shows an explicit "no active cyclones" state instead of an empty/broken UI (PRD §9). |

### Rate limits & caching (public Open-Meteo tier)

- ~10 000 calls/day, ~600/min per IP. Per-location bundle = **2 calls** (forecast + air quality),
  refreshed at most every 15 min while the app is open; the map grid is a single call cached 30 min.
  Typical usage stays far under limits.
- Attribution: Open-Meteo (forecast), CAMS Ensemble (air quality), OpenStreetMap + CARTO
  (tiles) — shown in the in-app footer.

### Persistence & offline handling

- `localStorage` (`mausam:v1`): saved locations, active location, unit + language preference,
  and the last full data payload per location (canonical units °C/km/h/mm/hPa; all display
  conversions are client-side, so switching back and forth loses nothing).
- On refresh failure the app renders the cached payload under a yellow
  "last updated <time> · Retry" bar — never a blank screen or raw error (PRD §9).

## Architecture

```
index.html            shell, nav, search overlay (fonts + Leaflet via CDN)
css/styles.css        design tokens, living-sky moods & animations, pixel UI
js/app.js             store (localStorage), hash router, geolocation boot, search, toggles
js/api.js             Open-Meteo calls + normalization (all times = wall-clock ms)
js/util.js            WMO mapping, CPCB AQI math, UV bands, alerts, monsoon proxy, SVG icons
js/i18n.js            full EN/HI string tables (English fallback per string — PRD §9)
js/sky.js             living-sky layer renderer (stars/clouds/rain/lightning/haze/fog)
js/views.js           Today, Forecast, Map, Air & UV, Locations renderers
test/api-test.mjs     live endpoint validation (npm test)
```

Key implementation notes:

- **Timezones**: Open-Meteo returns naive local timestamps. The app compares everything in
  "location wall time" (`Date.now() + utc_offset_seconds`) and formats with UTC getters, so an
  NRI checking weather back home sees correct local times regardless of device timezone.
- **Viewed-location theming**: day/night + condition come from the *viewed* location, not the device.
- **Accessibility**: keyboard-operable everything with visible focus, `prefers-reduced-motion`
  disables all ambient animation, AQI/UV/alert bands always carry text labels, alerts are never
  colour-alone.
- **Adding a language** = one new object in `js/i18n.js`. Adding a region later = the string-table
  and AQI scale are already parameterised.

## Known v1 limitations

- Alerts and monsoon line are derived proxies (documented in-UI), not live IMD bulletins.
- Geolocated point is labelled with coordinates (Open-Meteo has no reverse geocoder); search
  anywhere in the country is the primary location path.
- Live cyclone positions need a keyed feed (IMD/RSMC) and are out of the keyless v1.
