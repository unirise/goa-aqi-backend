const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

let cache = {
  data: null,
  timestamp: null,
  ttl: 10 * 60 * 1000
};

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Goa AQI API Server Running',
    version: '1.0.0'
  });
});

app.post('/api/aqi', async (req, res) => {
  try {
    const { iqairKey, waqiToken } = req.body;

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
        let response = await fetch(
          `https://api.airvisual.com/v2/nearest_city?lat=15.4909&lon=73.8278&key=${iqairKey}`
        );
        
        let data = await response.json();
        
        if (!response.ok || data.status !== 'success') {
          response = await fetch(
            `https://api.airvisual.com/v2/city?city=Panaji&state=Goa&country=India&key=${iqairKey}`
          );
          data = await response.json();
        }

        if (response.ok && data.status === 'success' && data.data) {
          iqairData = {
            aqi: data.data.current.pollution.aqius,
            pm25: data.data.current.pollution.p2?.conc || 0,
            timestamp: data.data.current.pollution.ts
          };
        } else {
          errors.push(`IQAir: ${data.data?.message || data.message || 'Failed to fetch'}`);
        }
      } catch (error) {
        errors.push(`IQAir: ${error.message}`);
      }
    }

    if (waqiToken) {
      try {
        const response = await fetch(
          `https://api.waqi.info/feed/goa/?token=${waqiToken}`
        );
        const data = await response.json();

        if (response.ok && data.status === 'ok' && data.data) {
          waqiData = {
            aqi: data.data.aqi,
            pm25: data.data.iaqi?.pm25?.v || 0,
            pm10: data.data.iaqi?.pm10?.v || 0,
            timestamp: data.data.time.iso
          };
        } else {
          errors.push(`WAQI: ${data.data || 'Failed to fetch'}`);
        }
      } catch (error) {
        errors.push(`WAQI: ${error.message}`);
      }
    }

    if (iqairData || waqiData) {
      const avgAqi = iqairData && waqiData 
        ? Math.round((iqairData.aqi + waqiData.aqi) / 2)
        : iqairData?.aqi || waqiData?.aqi;

      const result = {
        location: 'Panaji, Goa',
        aqi: avgAqi,
        pm25: iqairData?.pm25 || waqiData?.pm25 || 0,
        pm10: waqiData?.pm10 || 0,
        timestamp: new Date().toISOString(),
        sources: {
          iqair: iqairData?.aqi || 'N/A',
          cpcb: waqiData?.aqi || 'N/A'
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

app.post('/api/alert', async (req, res) => {
  try {
    const { studentId, alertType, message, contact } = req.body;
    console.log('Alert triggered:', { studentId, alertType, message, contact });
    
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});