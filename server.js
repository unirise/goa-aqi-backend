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
        const locations = ['panaji', 'margao', 'ponda', 'vasco-da-gama', 'mapusa', 'india/goa'];
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

    if (iqairData || waqiData) {
      let avgAqi;
      if (iqairData && waqiData) {
        avgAqi = Math.round((iqairData.aqi + waqiData.aqi) / 2);
      } else if (iqairData) {
        avgAqi = iqairData.aqi;
      } else {
        avgAqi = waqiData.aqi;
      }

      const result = {
        location: 'Panaji, Goa',
        aqi: avgAqi,
        pm25: (iqairData && iqairData.pm25) || (waqiData && waqiData.pm25) || 0,
        pm10: (waqiData && waqiData.pm10) || 0,
        timestamp: new Date().toISOString(),
        sources: {
          iqair: iqairData ? iqairData.aqi : 'N/A',
          cpcb: waqiData ? waqiData.aqi : 'N/A'
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

app.post('/api/alert', async function(req, res) {
  try {
    const studentId = req.body.studentId;
    const alertType = req.body.alertType;
    const message = req.body.message;
    const contact = req.body.contact;
    
    console.log('Alert triggered:', { studentId: studentId, alertType: alertType, message: message, contact: contact });
    
    res.json({
      success: true,
      message: 'Alert logged (integration pending)'
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
