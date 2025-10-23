const express = require('express');
const cors = require('cors');
const app = express();

// Enhanced CORS configuration - allow all origins for Claude.ai artifacts
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false
}));

app.use(express.json());

// In-memory cache to reduce API calls
let cache = {
  data: null,
  timestamp: null,
  ttl: 10 * 60 * 1000 // 10 minutes cache
};

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Goa AQI API Server Running',
    version: '1.0.0'
  });
});

// Fetch AQI data endpoint
app.post('/api/aqi', async (req, res) => {
  try {
    const { iqairKey, waqiToken } = req.body;

    // Check cache first
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

    // Fetch from IQAir
    if (iqairKey) {
      try {
        // Try nearest city first (more reliable)
        let response = await fetch(
          `https://api.airvisual.com/v2/nearest_city?lat=15.4909&lon=73.8278&key=${iqairKey}`
        );
        
        let data = await response.json();
        
        // If nearest city fails, try specific city
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
          errors.push(`IQAir: ${data.data?.message || data.me
