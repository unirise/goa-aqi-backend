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

// === Alert Generator for Purple Shades START ===
function generateAlertMessage(shade, aqi) {
  const alerts = {
    purpleMIND: [
      "Keep indoor play calm; Monitor irritability.",
      "Avoid loud/exhaust areas; Maintain hydration.",
      "Use air purifier; reduce sensory triggers.",
      "Strict indoor rest; pollution mask indoors."
    ],
    purpleVISION: [
      "Use tactile markers indoors; avoid dusty spaces.",
      "Increase indoor lighting and airflow.",
      "Stay indoors, keep environment ventilated.",
      "Full indoor restriction; ensure caregiver supervision."
    ],
    purpleHEAR: [
      "Encourage mask use outdoors.",
      "Limit outdoor group activities.",
      "Indoor-only communication; stay hydrated.",
      "Alert teachers/caregivers of indoor isolation."
    ],
    purpleVOICE: [
      "Avoid shouting or exertion.",
      "Keep water nearby; avoid dusty air.",
      "No outdoor communication tasks.",
      "Only communicate indoors; use humidifiers if available."
    ],
    purpleID: [
      "Gentle reminders to avoid running outside.",
      "Continuous supervision advised; indoor games.",
      "Strict indoor hours; ensure cool environment.",
      "Indoor-only with hydration; rest frequently."
    ],
    purpleLD: [
      "Short outdoor exposure only.",
      "Prefer classroom-based activities.",
      "Limit movement between rooms.",
      "Stay in one room with clean air filtration."
    ],
    purplePHYSICAL: [
      "Stay hydrated; monitor for fatigue.",
      "Avoid prolonged wheelchair use outside.",
      "Indoors, stretch and relax limbs periodically.",
      "Full indoor rest; maintain temperature control."
    ]
  };

  if (aqi <= 200) return alerts[shade][0];
  if (aqi <= 300) return alerts[shade][1];
  if (aqi <= 400) return alerts[shade][2];
  return alerts[shade][3];
}
// === Alert Generator for Purple Shades END ===

let cache = {
  data: null,
  timestamp: null,
  ttl: 10 * 60 * 1000
};

app.get('/', function(req, res) {
  res.json({ 
    status: 'ok', 
    message: 'Goa AQI API Server Running',
    version: '1.0.0'
  });
});

app.post('/api/aqi', async function(req, res) {
  try {
    const iqairKey = req.body.iqairKey;
    const waqiToken = req.body.waqiToken;

    if (cache.data && cache.timestamp && (Date.now() - cache.timestamp < cache.ttl)) {
      return res.json({
        success: true,
        data: cache.data,
        cached: true
      });
    }

    let iqairData = null;
    let waqiData = null;
    let errors = [];

    if (iqairKey) {
      try {
        let response = await fetch('https://api.airvisual.com/v2/nearest_city?lat=15.4909&lon=73.8278&key=' + iqairKey);
        let data = await response.json();
        
        if (!response.ok || data.status !== 'success') {
          response = await fetch('https://api.airvisual.com/v2/city?city=Panaji&state=Goa&country=India&key=' + iqairKey);
          data = await response.json();
        }

        if (response.ok && data.status === 'success' && data.data) {
          iqairData = {
            aqi: data.data.current.pollution.aqius,
            pm25: data.data.current.pollution.p2 ? data.data.current.pollution.p2.conc : 0,
            timestamp: data.data.current.pollution.ts
          };
        } else {
          const errorMsg = (data.data && data.data.message) || data.message || 'Failed to fetch';
          errors.push('IQAir: ' + errorMsg);
        }
      } catch (error) {
        errors.push('IQAir: ' + error.message);
      }
    }

    if (waqiToken) {
      try {
        const locations = ['delhi', 'panaji', 'margao', 'ponda', 'vasco-da-gama', 'mapusa', 'india/goa'];
        let waqiDataFound = false;
        
        for (let i = 0; i < locations.length; i++) {
          try {
            const response = await fetch('https://api.waqi.info/feed/' + locations[i] + '/?token=' + waqiToken);
            const data = await response.json();
            
            if (data.status === 'ok' && data.data && typeof data.data.aqi === 'number') {
              waqiData = {
                aqi: data.data.aqi,
                pm25: (data.data.iaqi && data.data.iaqi.pm25) ? data.data.iaqi.pm25.v : 0,
                pm10: (data.data.iaqi && data.data.iaqi.pm10) ? data.data.iaqi.pm10.v : 0,
                timestamp: data.data.time.iso
              };
              waqiDataFound = true;
              break;
            }
          } catch (locErr) {
            continue;
          }
        }
        
        if (!waqiDataFound) {
          errors.push('WAQI: No active stations found for Goa region');
        }
      } catch (error) {
        errors.push('WAQI: ' + error.message);
      }
    }

// === BEGIN CPCB PROTOTYPE MOCK ===
let cpcbData = null;
try {
  // Temporary mock CPCB dataset — you can randomize for demonstrations
  cpcbData = {
    station: 'Goa Pollution Control Board (Mock)',
    aqi: Math.floor(Math.random() * 150) + 60,   // random AQI range 60–210
    pm25: Math.floor(Math.random() * 80) + 20,   // random PM2.5 20–100
    pm10: Math.floor(Math.random() * 120) + 40,  // random PM10 40–160
    timestamp: new Date().toISOString()
  };
} catch (mockErr) {
  errors.push('CPCB Mock: ' + mockErr.message);
}
// === END CPCB PROTOTYPE MOCK ===
    
if (iqairData || waqiData || cpcbData) {
  let allAqis = [];

  if (iqairData) allAqis.push(iqairData.aqi);
  if (waqiData) allAqis.push(waqiData.aqi);
  if (cpcbData) allAqis.push(cpcbData.aqi);

  let avgAqi = allAqis.length > 0
    ? Math.round(allAqis.reduce((a, b) => a + b, 0) / allAqis.length)
    : 0;

      const result = {
        location: 'Panaji, Goa',
        aqi: avgAqi,
        pm25: (iqairData && iqairData.pm25) || (waqiData && waqiData.pm25) || 0,
        pm10: (waqiData && waqiData.pm10) || 0,
        timestamp: new Date().toISOString(),
        sources: {
            iqair: iqairData ? iqairData.aqi : 'N/A',
            waqi: waqiData ? waqiData.aqi : 'N/A',
            cpcb: cpcbData ? cpcbData.aqi : 'N/A' 
        },
        errors: errors.length > 0 ? errors : null
      };

      cache.data = result;
      cache.timestamp = Date.now();

      res.json({
        success: true,
        data: result,
        cached: false
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Failed to fetch data from any source',
        details: errors
      });
    }
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/*
 This section triggers disability-specific alerts
 based on AQI and Purple Shade categories
*/

// === ALERT GENERATION ROUTE (Purple Shade + AQI Dynamic Messaging) ===
app.post('/api/alert', async function (req, res) {
  try {
    const { studentId, alertType, aqi, shade } = req.body;

    // Generate the alert message dynamically
    const message = generateAlertMessage(shade, aqi);

    console.log('ALERT TRIGGERED:', {
      studentId: studentId,
      shade: shade,
      aqi: aqi,
      suggested_action: message
    });

    res.json({
      success: true,
      shade: shade,
      aqi_level: aqi,
      message: message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, function() {
  console.log('Server running on port ' + PORT);
});



