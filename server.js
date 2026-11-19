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

// Panaji, Goa coordinates
const LAT = 15.4909;
const LON = 73.8278;

// Only accept stations within this distance of Panaji (covers all of Goa)
const MAX_STATION_DISTANCE_KM = 80;

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = function (d) { return d * Math.PI / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

// === India National AQI (CPCB), indicative, from PM2.5 and PM10 ===
// Breakpoints: [conc_low, conc_high, index_low, index_high] in ug/m3 (24-hour)
const NAQI_BP = {
  pm2_5: [[0, 30, 0, 50], [31, 60, 51, 100], [61, 90, 101, 200], [91, 120, 201, 300], [121, 250, 301, 400], [251, 500, 401, 500]],
  pm10: [[0, 50, 0, 50], [51, 100, 51, 100], [101, 250, 101, 200], [251, 350, 201, 300], [351, 430, 301, 400], [431, 800, 401, 500]]
};
const NAQI_BANDS = [[50, 'Good'], [100, 'Satisfactory'], [200, 'Moderately polluted'], [300, 'Poor'], [400, 'Very poor'], [500, 'Severe']];

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

function naqiBand(index) {
  for (let i = 0; i < NAQI_BANDS.length; i++) {
    if (index <= NAQI_BANDS[i][0]) return NAQI_BANDS[i][1];
  }
  return 'Severe';
}

function average(values) {
  const v = values.filter(function (x) { return typeof x === 'number' && !isNaN(x); });
  if (v.length === 0) return null;
  return v.reduce(function (a, b) { return a + b; }, 0) / v.length;
}

// Open-Meteo: modelled PM2.5/PM10 (Copernicus CAMS); free for non-commercial use, no key
async function fetchOpenMeteo() {
  const url = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + LAT + '&longitude=' + LON +
    '&current=pm2_5,pm10,us_aqi&hourly=pm2_5,pm10&past_days=1&forecast_days=1&timezone=Asia%2FKolkata';
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
    band: naqiBand(naqi),
    basis: use24 ? '24-hour average' : 'latest hour only',
    pm25_now: data.current.pm2_5,
    pm10_now: data.current.pm10,
    us_aqi: data.current.us_aqi,
    time: now
  };
}

let cache = {
  data: null,
  timestamp: null,
  ttl: 10 * 60 * 1000 // 10 minutes
};

app.get('/', function (req, res) {
  res.json({
    status: 'ok',
    message: 'Goa AQI API Server Running',
    version: '1.3.0'
  });
});

app.post('/api/aqi', async function (req, res) {
  try {
    const iqairKey = req.body.iqairKey;
    const waqiToken = req.body.waqiToken;

    if (cache.data && cache.timestamp && (Date.now() - cache.timestamp < cache.ttl)) {
      return res.json({ success: true, data: cache.data, cached: true });
    }

    let iqairData = null;
    let waqiData = null;
    let omData = null;
    const errors = [];

    // --- Open-Meteo: modelled PM2.5/PM10 for Panaji; indicative India National AQI ---
    try {
      omData = await fetchOpenMeteo();
    } catch (error) {
      errors.push('Open-Meteo: ' + error.message);
    }

    // --- IQAir: nearest monitoring point to Panaji ---
    if (iqairKey) {
      try {
        const response = await fetch(
          'https://api.airvisual.com/v2/nearest_city?lat=' + LAT + '&lon=' + LON + '&key=' + iqairKey
        );
        const data = await response.json();

        if (response.ok && data.status === 'success' && data.data) {
          iqairData = {
            aqi: data.data.current.pollution.aqius,
            pm25: data.data.current.pollution.p2 ? data.data.current.pollution.p2.conc : 0,
            city: data.data.city
          };
        } else {
          errors.push('IQAir: ' + ((data.data && data.data.message) || 'Failed to fetch'));
        }
      } catch (error) {
        errors.push('IQAir: ' + error.message);
      }
    }

    // --- WAQI: nearest station to Panaji (WAQI carries CPCB stations in India) ---
    if (waqiToken) {
      try {
        const response = await fetch(
          'https://api.waqi.info/feed/geo:' + LAT + ';' + LON + '/?token=' + waqiToken
        );
        const data = await response.json();

        const geo = (data.data && data.data.city && data.data.city.geo) || null;
        const stationName = (data.data && data.data.city && data.data.city.name) || 'Unknown station';
        const km = geo ? distanceKm(LAT, LON, Number(geo[0]), Number(geo[1])) : Infinity;

        if (data.status === 'ok' && data.data && km > MAX_STATION_DISTANCE_KM) {
          errors.push('WAQI: nearest station is ' + stationName + ' (' + Math.round(km) + ' km away) - not used');
        } else if (data.status === 'ok' && data.data && typeof data.data.aqi === 'number') {
          waqiData = {
            aqi: data.data.aqi,
            station: stationName,
            km: Math.round(km)
          };
        } else {
          errors.push('WAQI: ' + (data.data || 'No data returned'));
        }
      } catch (error) {
        errors.push('WAQI: ' + error.message);
      }
    }

    if (!omData && !iqairData && !waqiData) {
      return res.status(400).json({
        success: false,
        error: 'Failed to fetch data from any source',
        details: errors
      });
    }

    // Headline: India National AQI (indicative) from Open-Meteo when available.
    // IQAir and WAQI use the US scale, so they are never averaged with it; they are shown separately.
    let headline, scale;
    if (omData) {
      headline = omData.naqi;
      scale = 'India NAQI (indicative, modelled)';
    } else if (iqairData) {
      headline = iqairData.aqi;
      scale = 'US AQI (IQAir)';
    } else {
      headline = waqiData.aqi;
      scale = 'US AQI (WAQI station)';
    }

    const result = {
      location: 'Panaji, Goa',
      aqi: headline,
      aqi_scale: scale,
      band: omData ? omData.band : null,
      pm25: omData && typeof omData.pm25_now === 'number' ? Math.round(omData.pm25_now * 10) / 10 : 0,
      pm10: omData && typeof omData.pm10_now === 'number' ? Math.round(omData.pm10_now * 10) / 10 : 0,
      timestamp: new Date().toISOString(),
      sources: {
        openmeteo: omData ? omData.naqi : 'N/A',
        iqair: iqairData ? iqairData.aqi : 'N/A',
        cpcb: waqiData ? waqiData.aqi : 'N/A'
      },
      openmeteo: omData ? { basis: omData.basis, us_aqi: omData.us_aqi, data_time: omData.time,
        attribution: 'Open-Meteo, using Copernicus Atmosphere Monitoring Service (CAMS) data' } : null,
      station: waqiData ? waqiData.station : null,
      errors: errors.length > 0 ? errors : null
    };

    cache.data = result;
    cache.timestamp = Date.now();

    res.json({ success: true, data: result, cached: false });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
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
