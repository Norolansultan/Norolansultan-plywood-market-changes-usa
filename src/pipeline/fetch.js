'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const FRED_SERIES = {
  BRL_USD: 'DEXBZUS',
  CAD_USD: 'DEXCAUS',
  EUR_USD: 'DEXUSEU',
  PLN_USD: 'DEXPOUS',
  SEK_USD: 'DEXSDUS',
};

const OXR_SYMBOLS = ['VND', 'IDR', 'MYR', 'CLP', 'UYU', 'THB', 'TWD', 'KHR'];

const RETRY_DELAYS = [1000, 4000, 16000];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchWithRetry(url, label) {
  let lastErr;
  for (let i = 0; i <= RETRY_DELAYS.length; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < RETRY_DELAYS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]));
      }
    }
  }
  throw new Error(`${label}: ${lastErr.message} (after ${RETRY_DELAYS.length} retries)`);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Individual fetchers
// ---------------------------------------------------------------------------

async function fetchBrent() {
  const key = process.env.EIA_API_KEY;
  if (!key) {
    console.warn('[fetch] EIA_API_KEY not set — skipping Brent crude');
    return { error: 'EIA_API_KEY not set', source: 'eia', fallback: true };
  }
  try {
    const url =
      `https://api.eia.gov/v2/petroleum/pri/spt/data/` +
      `?api_key=${key}&frequency=daily&data[0]=value` +
      `&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=1`;
    const json = await fetchWithRetry(url, 'eia');
    const row = json.response.data[0];
    return { source: 'eia', date: row.period, value: Number(row.value), unit: 'USD/bbl' };
  } catch (err) {
    console.error('[fetch] Brent crude failed:', err.message);
    return { error: err.message, source: 'eia', fallback: true };
  }
}

async function fetchFredFx() {
  const key = process.env.FRED_API_KEY;
  if (!key) {
    console.warn('[fetch] FRED_API_KEY not set — skipping FRED FX rates');
    return { error: 'FRED_API_KEY not set', source: 'fred', fallback: true };
  }
  try {
    const results = await Promise.all(
      Object.entries(FRED_SERIES).map(async ([pair, seriesId]) => {
        const url =
          `https://api.stlouisfed.org/fred/series/observations` +
          `?series_id=${seriesId}&api_key=${key}&sort_order=desc&limit=1&file_type=json`;
        const json = await fetchWithRetry(url, `fred:${pair}`);
        const obs = json.observations[0];
        return { currency: pair, rate: Number(obs.value), date: obs.date };
      }),
    );
    return results;
  } catch (err) {
    console.error('[fetch] FRED FX failed:', err.message);
    return { error: err.message, source: 'fred', fallback: true };
  }
}

async function fetchOxrFx() {
  const appId = process.env.OXR_APP_ID;
  if (!appId) {
    console.warn('[fetch] OXR_APP_ID not set — skipping Open Exchange Rates');
    return { error: 'OXR_APP_ID not set', source: 'oxr', fallback: true };
  }
  try {
    const symbols = OXR_SYMBOLS.join(',');
    const url =
      `https://openexchangerates.org/api/latest.json?app_id=${appId}&symbols=${symbols}`;
    const json = await fetchWithRetry(url, 'oxr');
    const date = new Date(json.timestamp * 1000).toISOString().slice(0, 10);
    return OXR_SYMBOLS.map((sym) => ({
      currency: `${sym}_USD`,
      rate: json.rates[sym],
      date,
    }));
  } catch (err) {
    console.error('[fetch] OXR FX failed:', err.message);
    return { error: err.message, source: 'oxr', fallback: true };
  }
}

async function fetchEuGas() {
  try {
    const url =
      'https://api.worldbank.org/v2/en/indicator/PNGASEUUSDM?format=json&mrv=1';
    const json = await fetchWithRetry(url, 'worldbank');
    const row = json[1][0];
    return {
      source: 'worldbank',
      value: Number(row.value),
      unit: 'USD/MMBtu',
      date: String(row.date),
    };
  } catch (err) {
    console.error('[fetch] EU gas failed:', err.message);
    return { error: err.message, source: 'worldbank', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// Main pipeline entry
// ---------------------------------------------------------------------------

async function fetchAll(options = {}) {
  const [brent, fredFx, oxrFx, euGas] = await Promise.all([
    fetchBrent(),
    fetchFredFx(),
    fetchOxrFx(),
    fetchEuGas(),
  ]);

  // Merge FX into a single map
  const fx = {};
  const mergeFx = (arr) => {
    if (Array.isArray(arr)) {
      arr.forEach((r) => { fx[r.currency] = { rate: r.rate, date: r.date }; });
    }
  };
  mergeFx(fredFx);
  mergeFx(oxrFx);

  // Track successes / failures
  const sourcesOk = [];
  const sourcesFailed = [];
  const check = (result, name) => {
    if (result && !result.error) sourcesOk.push(name);
    else sourcesFailed.push(name);
  };
  check(brent, 'eia');
  check(fredFx, 'fred');
  check(oxrFx, 'oxr');
  check(euGas, 'worldbank');

  const output = {
    timestamp: new Date().toISOString(),
    brent: brent.error ? brent : { value: brent.value, date: brent.date, unit: brent.unit },
    fx,
    eu_gas: euGas.error ? euGas : { value: euGas.value, date: euGas.date, unit: euGas.unit },
    sources_ok: sourcesOk,
    sources_failed: sourcesFailed,
  };

  // Persist to data/raw/
  const outDir = path.resolve(__dirname, '..', '..', 'data', 'raw');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `fetch_${today()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`[fetch] Wrote ${outFile}`);

  return output;
}

module.exports = { fetchAll, fetchBrent, fetchFredFx, fetchOxrFx, fetchEuGas };
