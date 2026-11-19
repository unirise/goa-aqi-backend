const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false
}));

app.use(express.json());

// Default place: Panaji, Goa
const DEFAULT_PLACE = { lat: 15.4909, lon: 73.8278, country_code: 'IN', name: 'Panaji, Goa' };

// Locations are rounded to 0.1 degree (about 11 km) before any outside service sees them.
// This protects a child's exact location, and air data is no finer than this anyway.
const ROUND_DEG = 0.1;

// Only accept monitoring stations within this distance of the chosen place
const MAX_STATION_DISTANCE_KM = 80;

// Countries where the European Air Quality Index is the familiar local scale
const EUROPE = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'CH', 'GB'];

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = function (d) { return d * Math.PI / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function roundDeg(x) {
  return Math.round(x / ROUND_DEG) * ROUND_DEG;
}

// Read and check the place sent by the app; fall back to Panaji
function readPlace(body) {
  const lat = Number(body.lat), lon = Number(body.lon);
  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || (body.lat === undefined && body.lon === undefined)) {
    return { lat: DEFAULT_PLACE.lat, lon: DEFAULT_PLACE.lon, country_code: DEFAULT_PLACE.country_code, name: DEFAULT_PLACE.name };
  }
  const cc = typeof body.country_code === 'string' && /^[A-Za-z]{2}$/.test(body.country_code) ? body.country_code.toUpperCase() : null;
  const name = typeof body.place_name === 'string' ? body.place_name.slice(0, 80) : null;
  return { lat: Number(roundDeg(lat).toFixed(1)), lon: Number(roundDeg(lon).toFixed(1)), country_code: cc, name: name };
}

// === Alert messages for each purple shade (4 levels of AQI) ===
const shadeAlerts = {
  purpleMIND: [
    'Keep indoor play calm; monitor irritability.',
    'Avoid loud/exhaust areas; maintain hydration.',
    'Use air purifier; reduce sensory triggers.',
    'Strict indoor rest; pollution mask indoors.'
  ],
  purpleVISION: [
    'Use tactile markers indoors; avoid dusty spaces.',
    'Increase indoor lighting and airflow.',
    'Stay indoors, keep environment ventilated.',
    'Full indoor restriction; ensure caregiver supervision.'
  ],
  purpleHEAR: [
    'Encourage mask use outdoors.',
    'Limit outdoor group activities.',
    'Indoor-only communication; stay hydrated.',
    'Alert teachers/caregivers of indoor isolation.'
  ],
  purpleVOICE: [
    'Avoid shouting or exertion.',
    'Keep water nearby; avoid dusty air.',
    'No outdoor communication tasks.',
    'Only communicate indoors; use humidifiers if available.'
  ],
  purpleID: [
    'Gentle reminders to avoid running outside.',
    'Continuous supervision advised; indoor games.',
    'Strict indoor hours; ensure cool environment.',
    'Indoor-only with hydration; rest frequently.'
  ],
  purpleLD: [
    'Short outdoor exposure only.',
    'Prefer classroom-based activities.',
    'Limit movement between rooms.',
    'Stay in one room with clean air filtration.'
  ],
  purplePHYSICAL: [
    'Stay hydrated; monitor for fatigue.',
    'Avoid prolonged wheelchair use outside.',
    'Indoors, stretch and relax limbs periodically.',
    'Full indoor rest; maintain temperature control.'
  ]
};

function generateAlertMessage(shade, aqi) {
  const list = shadeAlerts[shade];
  if (!list) return 'Monitor air quality and follow school guidance.';
  if (aqi <= 200) return list[0];
  if (aqi <= 300) return list[1];
  if (aqi <= 400) return list[2];
  return list[3];
}

// === India National AQI (CPCB) breakpoints, used for India's local scale and as the advice yardstick everywhere ===
// [conc_low, conc_high, index_low, index_high] in ug/m3 (24-hour)
const NAQI_BP = {
  pm2_5: [[0, 30, 0, 50], [31, 60, 51, 100], [61, 90, 101, 200], [91, 120, 201, 300], [121, 250, 301, 400], [251, 500, 401, 500]],
  pm10: [[0, 50, 0, 50], [51, 100, 51, 100], [101, 250, 101, 200], [251, 350, 201, 300], [351, 430, 301, 400], [431, 800, 401, 500]]
};
const NAQI_BANDS = [[50, 'Good'], [100, 'Satisfactory'], [200, 'Moderately polluted'], [300, 'Poor'], [400, 'Very poor'], [Infinity, 'Severe']];
const US_BANDS = [[50, 'Good'], [100, 'Moderate'], [150, 'Unhealthy for sensitive groups'], [200, 'Unhealthy'], [300, 'Very unhealthy'], [Infinity, 'Hazardous']];
const EU_BANDS = [[20, 'Good'], [40, 'Fair'], [60, 'Moderate'], [80, 'Poor'], [100, 'Very poor'], [Infinity, 'Extremely poor']];

function bandFor(bands, index) {
  for (let i = 0; i < bands.length; i++) {
    if (index <= bands[i][0]) return bands[i][1];
  }
  return bands[bands.length - 1][1];
}

function naqiSubIndex(pollutant, conc) {
  if (typeof conc !== 'number' || isNaN(conc) || conc < 0) return null;
  const c = Math.round(conc);
  const table = NAQI_BP[pollutant];
  for (let i = 0; i < table.length; i++) {
    const bp = table[i];
    if (c <= bp[1]) {
      return Math.round((bp[3] - bp[2]) / (bp[1] - bp[0]) * (c - bp[0]) + bp[2]);
    }
  }
  return 500;
}

function average(values) {
  const v = values.filter(function (x) { return typeof x === 'number' && !isNaN(x); });
  if (v.length === 0) return null;
  return v.reduce(function (a, b) { return a + b; }, 0) / v.length;
}

// Open-Meteo: modelled pollutant levels (Copernicus CAMS), worldwide; free for non-commercial use, no key
async function fetchOpenMeteo(place) {
  const url = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + place.lat + '&longitude=' + place.lon +
    '&current=pm2_5,pm10,us_aqi,european_aqi&hourly=pm2_5,pm10&past_days=1&forecast_days=1&timezone=auto';
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.error || !data.current) {
    throw new Error((data && data.reason) || 'No data returned');
  }
  const now = data.current.time;
  let pm25_24h = null, pm10_24h = null, hours = 0;
  if (data.hourly && Array.isArray(data.hourly.time)) {
    const idx = [];
    for (let i = 0; i < data.hourly.time.length; i++) {
      if (data.hourly.time[i] <= now) idx.push(i);
    }
    const last24 = idx.slice(-24);
    const pm25s = last24.map(function (i) { return data.hourly.pm2_5[i]; });
    const pm10s = last24.map(function (i) { return data.hourly.pm10[i]; });
    hours = pm25s.filter(function (x) { return typeof x === 'number'; }).length;
    pm25_24h = average(pm25s);
    pm10_24h = average(pm10s);
  }
  // Use the 24-hour average when at least 18 hours are available; otherwise the latest hour
  const use24 = hours >= 18 && pm25_24h !== null && pm10_24h !== null;
  const pm25 = use24 ? pm25_24h : data.current.pm2_5;
  const pm10 = use24 ? pm10_24h : data.current.pm10;
  const sub25 = naqiSubIndex('pm2_5', pm25);
  const sub10 = naqiSubIndex('pm10', pm10);
  if (sub25 === null && sub10 === null) throw new Error('No PM2.5 or PM10 values');
  const naqi = Math.max(sub25 === null ? 0 : sub25, sub10 === null ? 0 : sub10);
  return {
    naqi: naqi,
    basis: use24 ? '24-hour average' : 'latest hour only',
    pm25_now: data.current.pm2_5,
    pm10_now: data.current.pm10,
    us_aqi: data.current.us_aqi,
    european_aqi: data.current.european_aqi,
    time: now,
    timezone: data.timezone || null
  };
}

// One remembered answer per area, for 10 minutes
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;
  if (hit) cache.delete(key);
  return null;
}

function cacheSet(key, data) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), data: data });
}

app.get('/', function (req, res) {
  res.json({
    status: 'ok',
    message: 'Saaf Saans API Server Running',
    version: '1.4.0'
  });
});

app.post('/api/aqi', async function (req, res) {
  try {
    const body = req.body || {};
    const iqairKey = body.iqairKey;
    const waqiToken = body.waqiToken;
    const place = readPlace(body);

    const cacheKey = place.lat + ',' + place.lon + ',' + (place.country_code || '');
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json({ success: true, data: Object.assign({}, cached, { location: place.name || cached.location }), cached: true });
    }

    let iqairData = null;
    let waqiData = null;
    let omData = null;
    const errors = [];

    // --- Open-Meteo: modelled pollutant levels for the chosen place ---
    try {
      omData = await fetchOpenMeteo(place);
    } catch (error) {
      errors.push('Open-Meteo: ' + error.message);
    }

    // --- IQAir: nearest city with data (US scale) ---
    if (iqairKey) {
      try {
        const response = await fetch(
          'https://api.airvisual.com/v2/nearest_city?lat=' + place.lat + '&lon=' + place.lon + '&key=' + iqairKey
        );
        const data = await response.json();
        if (response.ok && data.status === 'success' && data.data) {
          iqairData = {
            aqi: data.data.current.pollution.aqius,
            city: [data.data.city, data.data.state, data.data.country].filter(Boolean).join(', '),
            country: data.data.country || null
          };
        } else {
          errors.push('IQAir: ' + ((data.data && data.data.message) || 'Failed to fetch'));
        }
      } catch (error) {
        errors.push('IQAir: ' + error.message);
      }
    }

    // --- WAQI: nearest monitoring station (US scale), used only if within range ---
    if (waqiToken) {
      try {
        const response = await fetch(
          'https://api.waqi.info/feed/geo:' + place.lat + ';' + place.lon + '/?token=' + waqiToken
        );
        const data = await response.json();
        const geo = (data.data && data.data.city && data.data.city.geo) || null;
        const stationName = (data.data && data.data.city && data.data.city.name) || 'Unknown station';
        const km = geo ? distanceKm(place.lat, place.lon, Number(geo[0]), Number(geo[1])) : Infinity;

        if (data.status === 'ok' && data.data && km > MAX_STATION_DISTANCE_KM) {
          errors.push('WAQI: nearest station is ' + stationName + ' (' + Math.round(km) + ' km away) - not used');
        } else if (data.status === 'ok' && data.data && typeof data.data.aqi === 'number') {
          waqiData = { aqi: data.data.aqi, station: stationName, km: Math.round(km) };
        } else {
          errors.push('WAQI: ' + (data.data || 'No data returned'));
        }
      } catch (error) {
        errors.push('WAQI: ' + error.message);
      }
    }

    if (!omData && !iqairData && !waqiData) {
      return res.status(400).json({ success: false, error: 'Failed to fetch data from any source', details: errors });
    }

    // Which country? From the app (saved place or search); otherwise from the place's time zone
    // (Asia/Kolkata covers only India) or from IQAir's answer
    let cc = place.country_code;
    let inEuropeZone = false;
    if (!cc && omData && omData.timezone === 'Asia/Kolkata') cc = 'IN';
    if (!cc && omData && typeof omData.timezone === 'string' && omData.timezone.indexOf('Europe/') === 0) inEuropeZone = true;
    if (!cc && iqairData && iqairData.country) {
      const map = { 'India': 'IN', 'United Kingdom': 'GB', 'USA': 'US', 'United States': 'US', 'UAE': 'AE', 'United Arab Emirates': 'AE' };
      cc = map[iqairData.country] || null;
    }

    // Headline: the familiar local scale
    let headline = null, scale = null, band = null;
    if (omData && cc === 'IN') {
      headline = omData.naqi; scale = 'India AQI (indicative, modelled)'; band = bandFor(NAQI_BANDS, headline);
    } else if (omData && ((cc && EUROPE.indexOf(cc) !== -1) || (!cc && inEuropeZone)) && typeof omData.european_aqi === 'number') {
      headline = Math.round(omData.european_aqi); scale = 'European AQI (modelled)'; band = bandFor(EU_BANDS, headline);
    } else if (omData && typeof omData.us_aqi === 'number') {
      headline = Math.round(omData.us_aqi); scale = 'US AQI (modelled)'; band = bandFor(US_BANDS, headline);
    } else if (iqairData) {
      headline = iqairData.aqi; scale = 'US AQI (IQAir)'; band = bandFor(US_BANDS, headline);
    } else {
      headline = waqiData.aqi; scale = 'US AQI (station)'; band = bandFor(US_BANDS, headline);
    }

    // Advice is based on pollutant levels, the same yardstick everywhere (interim: CPCB breakpoints),
    // so the same child gets the same advice for the same air, wherever they are.
    const adviceIndex = omData ? omData.naqi : null;

    const result = {
      location: place.name || (iqairData ? 'Near ' + iqairData.city : 'Your area (within about 10 km)'),
      lat: place.lat,
      lon: place.lon,
      country_code: cc || null,
      aqi: headline,
      aqi_scale: scale,
      band: band,
      advice_index: adviceIndex,
      advice_basis: adviceIndex === null ? 'No pollutant levels available; advice uses the headline figure' : 'Pollutant levels (PM2.5 and PM10), ' + omData.basis,
      pm25: omData && typeof omData.pm25_now === 'number' ? Math.round(omData.pm25_now * 10) / 10 : 0,
      pm10: omData && typeof omData.pm10_now === 'number' ? Math.round(omData.pm10_now * 10) / 10 : 0,
      timestamp: new Date().toISOString(),
      timezone: omData ? omData.timezone : null,
      sources: {
        openmeteo: omData && scale.indexOf('modelled') !== -1 ? headline : 'N/A',
        iqair: iqairData ? iqairData.aqi : 'N/A',
        iqair_city: iqairData ? iqairData.city : null,
        station: waqiData ? waqiData.aqi : 'N/A',
        station_name: waqiData ? waqiData.station : null,
        station_km: waqiData ? waqiData.km : null,
        cpcb: waqiData ? waqiData.aqi : 'N/A'
      },
      openmeteo: omData ? { basis: omData.basis, us_aqi: omData.us_aqi, european_aqi: omData.european_aqi, data_time: omData.time,
        attribution: 'Open-Meteo, using Copernicus Atmosphere Monitoring Service (CAMS) data' } : null,
      errors: errors.length > 0 ? errors : null
    };

    cacheSet(cacheKey, result);
    res.json({ success: true, data: result, cached: false });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ success: false, error: 'Internal server error', details: error.message });
  }
});

// === Purple-shade alert message for a student ===
app.post('/api/alert', function (req, res) {
  try {
    const studentId = req.body.studentId;
    const shade = req.body.shade;
    const aqi = Number(req.body.aqi) || 0;

    const message = generateAlertMessage(shade, aqi);

    console.log('ALERT TRIGGERED:', { studentId: studentId, shade: shade, aqi: aqi, suggested_action: message });

    res.json({ success: true, shade: shade, aqi_level: aqi, message: message });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, function () {
  console.log('Server running on port ' + PORT);
});
