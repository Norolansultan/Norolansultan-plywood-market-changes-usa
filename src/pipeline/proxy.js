'use strict';

/**
 * Proxy models for deriving estimated current values from high-frequency
 * signals (Brent crude, FX rates) when primary data sources have long lag.
 */

const COUNTRIES = [
  'indonesia', 'vietnam', 'cambodia', 'malaysia', 'thailand', 'taiwan',
  'canada', 'chile', 'brazil', 'uruguay', 'finland', 'sweden', 'germany',
  'poland', 'italy', 'spain', 'belgium', 'gabon', 'ecuador', 'paraguay'
];

const COUNTRY_CURRENCY = {
  indonesia: 'IDR', vietnam: 'VND', cambodia: 'KHR', malaysia: 'MYR',
  thailand: 'THB', taiwan: 'TWD', canada: 'CAD', chile: 'CLP',
  brazil: 'BRL', uruguay: 'UYU', finland: 'EUR', sweden: 'SEK',
  germany: 'EUR', poland: 'PLN', italy: 'EUR', spain: 'EUR',
  belgium: 'EUR', gabon: 'XAF', ecuador: 'USD', paraguay: 'USD'
};

/** Map each country to a freight sensitivity category */
const COUNTRY_FREIGHT_CATEGORY = {
  indonesia: 'transpacific_ec', vietnam: 'transpacific_ec',
  cambodia: 'transpacific_ec', malaysia: 'transpacific_ec',
  thailand: 'transpacific_ec', taiwan: 'transpacific_ec',
  canada: 'americas_short', chile: 'americas_short',
  brazil: 'americas_short', uruguay: 'americas_short',
  finland: 'transatlantic', sweden: 'transatlantic',
  germany: 'transatlantic', poland: 'transatlantic',
  italy: 'transatlantic', spain: 'transatlantic',
  belgium: 'transatlantic', gabon: 'transatlantic',
  ecuador: 'americas_short', paraguay: 'americas_short'
};

const COUNTRY_FREIGHT_WC_CATEGORY = {
  indonesia: 'transpacific_wc', vietnam: 'transpacific_wc',
  cambodia: 'transpacific_wc', malaysia: 'transpacific_wc',
  thailand: 'transpacific_wc', taiwan: 'transpacific_wc',
  canada: 'americas_short', chile: 'americas_short',
  brazil: 'americas_short', uruguay: 'americas_short'
};

const AVERAGE_COGS_ESTIMATE = 300;
const M3_PER_TEU = 23;

/**
 * Compute log price proxy.
 * adjusted = baseline_mid * (1 + oil_sensitivity_pct_per_10 / 100 * brent_delta / 10)
 */
function proxyLogPrice(logEntry, brentDelta) {
  var mid = logEntry.price_mid;
  var sens = logEntry.oil_sensitivity_pct_per_10;
  return mid * (1 + (sens / 100) * (brentDelta / 10));
}

/**
 * Compute resin cost proxy per m3.
 * Base = resin_share (18%) * 300 = $54. Adjust by 1.5% per $1 Brent move.
 */
function proxyResinCost(resinSharePct, brentDelta) {
  var base = (resinSharePct / 100) * AVERAGE_COGS_ESTIMATE;
  return base * (1 + 0.015 * brentDelta);
}

/**
 * Compute electricity cost proxy per m3.
 * elec_per_m3 = mid_usd_per_mwh * 0.2 * (1 + oil_corr * delta/10)
 * (200 kWh = 0.2 MWh, so mid * 0.2 gives base cost per m3)
 */
function proxyElectricityCost(elecEntry, brentDelta) {
  var mid = elecEntry.mid;
  var oilCorr = elecEntry.oil_correlation;
  return mid * 0.2 * (1 + oilCorr * (brentDelta / 10));
}

/**
 * Compute freight cost per m3 from TEU rate + oil sensitivity.
 * adjusted_teu = base_teu * (1 + sensitivity_per_10 / base_teu * delta / 10)
 * Actually: adjusted_teu = base_teu + sensitivity_per_10 * delta / 10
 * freight_per_m3 = adjusted_teu / 23
 */
function proxyFreight(baseTeu, sensitivityPer10, brentDelta) {
  if (baseTeu == null) return null;
  var adjustedTeu = baseTeu + sensitivityPer10 * (brentDelta / 10);
  return adjustedTeu / M3_PER_TEU;
}

/**
 * Compute FX adjustment per m3.
 * Domestic cost base = log + labor + electricity (local-currency portion).
 * fx_adjustment = domestic_cost * fx_change_pct / 100
 */
function proxyFxAdjustment(logCost, laborCost, elecCost, fxChangePct) {
  if (fxChangePct == null || fxChangePct === 0) return 0;
  var domesticCost = logCost + laborCost + elecCost;
  return domesticCost * (fxChangePct / 100);
}

/**
 * Look up the EC (Savannah) freight rate key for a country.
 */
function ecFreightKey(country) {
  if (country === 'canada') return 'canada_qc_savannah';
  return country + '_savannah';
}

/**
 * Look up the WC (Long Beach) freight rate key for a country.
 * Returns null if no WC route exists.
 */
function wcFreightKey(country) {
  if (country === 'canada') return 'canada_bc_long_beach';
  if (COUNTRY_FREIGHT_WC_CATEGORY[country]) return country + '_long_beach';
  return null;
}

/**
 * Get the FX change percentage for a country.
 * Prefers live data over overrides fallback.
 */
function getFxChangePct(country, liveData, overrides) {
  var ccy = COUNTRY_CURRENCY[country];
  if (ccy === 'USD') return 0;

  if (liveData && liveData.fx && liveData.fx[ccy] != null) {
    var baselines = overrides.fx_baselines && overrides.fx_baselines.ytd_change_vs_usd_pct;
    if (baselines && baselines[ccy] != null) {
      return liveData.fx[ccy];
    }
    return liveData.fx[ccy];
  }

  var fallback = overrides.fx_baselines && overrides.fx_baselines.ytd_change_vs_usd_pct;
  if (fallback && fallback[ccy] != null) return fallback[ccy];
  return 0;
}

/**
 * Main export. Derives proxy-adjusted cost estimates per country.
 *
 * @param {Object} liveData - Output from fetch.js: { brent, fx, eu_gas }
 * @param {Object} overrides - Parsed manual-overrides.json
 * @returns {Object} Adjusted values per country plus metadata
 */
function applyProxyModels(liveData, overrides) {
  var brentBaseline = overrides.constants.brent_baseline_usd;
  var brentCurrent = (liveData && liveData.brent) || brentBaseline;
  var brentDelta = brentCurrent - brentBaseline;
  var resinSharePct = overrides.constants.resin_share_of_cogs_pct;
  var freightRates = overrides.freight_rates.rates_usd_per_teu;
  var freightSens = overrides.freight_rates.sensitivity_per_10_bbl_usd_per_teu;

  var countries = {};

  COUNTRIES.forEach(function (country) {
    var logEntry = overrides.log_prices.prices_usd_per_m3[country];
    var elecEntry = overrides.electricity.tariffs_usd_per_mwh[country];
    var laborCost = overrides.labor.cost_usd_per_m3[country];

    var logAdj = proxyLogPrice(logEntry, brentDelta);
    var resinCost = proxyResinCost(resinSharePct, brentDelta);
    var elecCost = proxyElectricityCost(elecEntry, brentDelta);

    var ecKey = ecFreightKey(country);
    var wcKey = wcFreightKey(country);
    var ecCategory = COUNTRY_FREIGHT_CATEGORY[country];
    var wcCategory = COUNTRY_FREIGHT_WC_CATEGORY[country] || null;

    var ecSens = freightSens[ecCategory] || 0;
    var wcSens = wcCategory ? (freightSens[wcCategory] || 0) : 0;

    var freightEc = proxyFreight(freightRates[ecKey] || null, ecSens, brentDelta);
    var freightWc = wcKey ? proxyFreight(freightRates[wcKey] || null, wcSens, brentDelta) : null;

    var fxChangePct = getFxChangePct(country, liveData, overrides);
    var fxAdj = proxyFxAdjustment(logAdj, laborCost, elecCost, fxChangePct);

    countries[country] = {
      log_price_adjusted: round2(logAdj),
      resin_cost_per_m3: round2(resinCost),
      electricity_cost_per_m3: round2(elecCost),
      labor_cost_per_m3: laborCost,
      fx_adjustment_per_m3: round2(fxAdj),
      freight_ec: freightEc != null ? round2(freightEc) : null,
      freight_wc: freightWc != null ? round2(freightWc) : null
    };
  });

  return {
    countries: countries,
    brent_current: brentCurrent,
    brent_delta_from_baseline: round2(brentDelta),
    metadata: {
      timestamp: new Date().toISOString(),
      sources_used: buildSourcesList(liveData)
    }
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function buildSourcesList(liveData) {
  var sources = ['manual-overrides.json'];
  if (liveData) {
    if (liveData.brent != null) sources.push('brent_live');
    if (liveData.fx) sources.push('fx_live');
    if (liveData.eu_gas != null) sources.push('eu_gas_live');
  }
  return sources;
}

module.exports = { applyProxyModels };
