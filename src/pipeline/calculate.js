'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMEA_NO_WC = new Set([
  'finland', 'sweden', 'germany', 'poland', 'italy', 'spain', 'belgium', 'gabon',
]);

const VULNERABILITY_WEIGHTS = {
  freight: 0.20,
  resin: 0.20,
  electricity: 0.20,
  log_price: 0.20,
  labor: 0.10,
  fx_buffer: 0.10,
};

const PORT_HANDLING = 14; // standard estimate USD/m3

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freightPerM3(teuRate, containerFill) {
  return teuRate / (containerFill || 23);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function lookupFreight(rates, country, dest) {
  // Handle special cases where override keys differ from country name
  if (country === 'canada' && dest === 'savannah') return rates['canada_qc_savannah'] != null ? rates['canada_qc_savannah'] : null;
  if (country === 'canada' && dest === 'long_beach') return rates['canada_bc_long_beach'] != null ? rates['canada_bc_long_beach'] : null;
  const key = `${country}_${dest}`;
  return rates[key] != null ? rates[key] : null;
}

function lookupDuty(country, tradeDuties) {
  const key = country.toLowerCase();
  const addCvd = (tradeDuties.add_cvd_usd_per_m3 || {})[key] || 0;
  const isFtaZero = (tradeDuties.fta_zero_duty || []).includes(key);
  const mfnPct = isFtaZero ? 0 : (tradeDuties.mfn_rate_pct || 8);
  return { addCvd, mfnPct };
}

// ---------------------------------------------------------------------------
// Vulnerability scoring helpers
// ---------------------------------------------------------------------------

function scoreFreight(teuRate) {
  if (teuRate <= 1000) return 2;
  if (teuRate <= 2000) return 4;
  if (teuRate <= 3000) return 6;
  if (teuRate <= 4000) return 8;
  return 10;
}

function scoreResin(oilSensitivityPct) {
  if (oilSensitivityPct <= 1) return 2;
  if (oilSensitivityPct <= 2) return 4;
  if (oilSensitivityPct <= 3) return 6;
  if (oilSensitivityPct <= 4) return 8;
  return 10;
}

function scoreElectricity(tariffUsdMwh) {
  if (tariffUsdMwh < 50) return 1;
  if (tariffUsdMwh <= 70) return 3;
  if (tariffUsdMwh <= 90) return 5;
  if (tariffUsdMwh <= 110) return 7;
  return 9;
}

function scoreLogPrice(price) {
  if (price < 40) return 2;
  if (price <= 60) return 4;
  if (price <= 80) return 6;
  if (price <= 100) return 8;
  return 10;
}

function scoreLabor(laborCost) {
  // Inverted: high labor = wealthy country = LOW vulnerability
  if (laborCost > 80) return 2;
  if (laborCost >= 50) return 4;
  if (laborCost >= 30) return 6;
  if (laborCost >= 15) return 8;
  return 9;
}

function scoreFxBuffer(ytdChangePct) {
  // ytdChangePct is negative for depreciation (e.g. -4 means 4% depreciation)
  // More depreciation = more buffer = lower score (less vulnerable)
  const depreciation = -ytdChangePct; // positive = depreciated
  if (depreciation > 5) return 2;
  if (depreciation >= 3) return 4;
  if (depreciation >= 1) return 6;
  if (depreciation >= 0) return 8;
  return 9; // appreciation
}

// ---------------------------------------------------------------------------
// calculateCIF
// ---------------------------------------------------------------------------

function calculateCIF(countryData, overrides) {
  const country = countryData.country.toLowerCase();
  const fill = overrides.constants.container_fill_m3_per_teu;
  const rates = overrides.freight_rates.rates_usd_per_teu;
  const logInfo = overrides.log_prices.prices_usd_per_m3[country];
  const elecInfo = overrides.electricity.tariffs_usd_per_mwh[country];
  const laborCost = overrides.labor.cost_usd_per_m3[country];
  const duty = lookupDuty(country, overrides.trade_duties);
  const kwh = overrides.constants.electricity_intensity_kwh_per_m3;

  const logPrice = logInfo ? logInfo.price_mid : 0;
  const resinCost = logPrice * (overrides.constants.resin_share_of_cogs_pct / 100);
  const elecCost = elecInfo ? (elecInfo.mid / 1000) * kwh : 0; // USD/MWh -> USD/kWh * kWh
  const fxBaseline = overrides.fx_baselines.ytd_change_vs_usd_pct || {};
  const currency = countryData.currency || null;
  const fxAdj = currency && fxBaseline[currency] != null
    ? round2(logPrice * Math.abs(fxBaseline[currency]) / 100)
    : 0;

  // Duty: ADD/CVD is already USD/m3; MFN is % applied to (log + resin + elec + labor)
  const preDutyCost = logPrice + resinCost + elecCost + laborCost;
  const mfnDuty = round2(preDutyCost * (duty.mfnPct / 100));
  const totalDuty = round2(duty.addCvd + mfnDuty);

  // East Coast
  const ecTeu = lookupFreight(rates, country, 'savannah');
  const ecFreight = ecTeu != null ? round2(freightPerM3(ecTeu, fill)) : 0;
  const ecTotal = round2(
    logPrice + resinCost + elecCost + laborCost + ecFreight + PORT_HANDLING + totalDuty + fxAdj
  );
  const eastCoast = {
    log: round2(logPrice),
    resin: round2(resinCost),
    electricity: round2(elecCost),
    labor: round2(laborCost),
    freight: round2(ecFreight),
    port_handling: PORT_HANDLING,
    add_duty: round2(totalDuty),
    fx_adjustment: round2(fxAdj),
    total_cif: ecTotal,
  };

  // West Coast
  let westCoast = null;
  if (!EMEA_NO_WC.has(country)) {
    const wcTeu = lookupFreight(rates, country, 'long_beach');
    if (wcTeu != null) {
      const wcFreight = round2(freightPerM3(wcTeu, fill));
      const wcTotal = round2(
        logPrice + resinCost + elecCost + laborCost + wcFreight + PORT_HANDLING + totalDuty + fxAdj
      );
      westCoast = {
        log: round2(logPrice),
        resin: round2(resinCost),
        electricity: round2(elecCost),
        labor: round2(laborCost),
        freight: round2(wcFreight),
        port_handling: PORT_HANDLING,
        add_duty: round2(totalDuty),
        fx_adjustment: round2(fxAdj),
        total_cif: wcTotal,
      };
    }
  }

  return { east_coast: eastCoast, west_coast: westCoast };
}

// ---------------------------------------------------------------------------
// calculateVulnerability
// ---------------------------------------------------------------------------

function calculateVulnerability(countryData, weights) {
  const w = weights || VULNERABILITY_WEIGHTS;

  const breakdown = {
    freight: scoreFreight(countryData.freight_teu_ec || 0),
    resin: scoreResin(countryData.oil_sensitivity_pct || 0),
    electricity: scoreElectricity(countryData.electricity_tariff_usd_mwh || 0),
    log_price: scoreLogPrice(countryData.log_price_mid || 0),
    labor: scoreLabor(countryData.labor_cost_usd_m3 || 0),
    fx_buffer: scoreFxBuffer(countryData.fx_ytd_change_pct || 0),
  };

  let composite = 0;
  for (const dim of Object.keys(w)) {
    composite += (breakdown[dim] || 0) * (w[dim] || 0);
  }
  composite = round2(clamp(composite, 0, 10));

  return { score: composite, breakdown };
}

// ---------------------------------------------------------------------------
// checkTriggers
// ---------------------------------------------------------------------------

function checkTriggers(currentData, monitoringConfig) {
  const triggers = monitoringConfig.triggers;
  const fired = [];

  // Brent crude
  if (triggers.brent_crude && currentData.brent_usd != null) {
    const baseline = triggers.brent_crude.last_baseline_usd;
    const delta = Math.abs(currentData.brent_usd - baseline);
    if (delta >= triggers.brent_crude.retrigger_delta_usd) {
      fired.push({
        name: 'brent_crude',
        current: currentData.brent_usd,
        baseline,
        threshold: triggers.brent_crude.retrigger_delta_usd,
        direction: currentData.brent_usd > baseline ? 'up' : 'down',
      });
    }
  }

  // FX rates
  if (triggers.fx_rates && currentData.fx_rates) {
    const threshold = triggers.fx_rates.retrigger_pct_change;
    for (const ccy of triggers.fx_rates.monitored_currencies) {
      const entry = currentData.fx_rates[ccy];
      if (entry && Math.abs(entry.change_pct) >= threshold) {
        fired.push({
          name: `fx_${ccy}`,
          current: entry.current,
          baseline: entry.baseline,
          threshold,
          direction: entry.change_pct > 0 ? 'appreciation' : 'depreciation',
        });
      }
    }
  }

  // EU gas price
  if (triggers.eu_gas_price && currentData.eu_gas_eur_mwh != null) {
    const baseline = triggers.eu_gas_price.last_baseline_eur_mwh;
    const delta = Math.abs(currentData.eu_gas_eur_mwh - baseline);
    if (delta >= triggers.eu_gas_price.retrigger_delta_eur_mwh) {
      fired.push({
        name: 'eu_gas_price',
        current: currentData.eu_gas_eur_mwh,
        baseline,
        threshold: triggers.eu_gas_price.retrigger_delta_eur_mwh,
        direction: currentData.eu_gas_eur_mwh > baseline ? 'up' : 'down',
      });
    }
  }

  return { triggered: fired.length > 0, triggers_fired: fired };
}

// ---------------------------------------------------------------------------
// buildFullAnalysis
// ---------------------------------------------------------------------------

function buildFullAnalysis(proxyOutput, overrides, monitoringConfig) {
  const weights = VULNERABILITY_WEIGHTS;
  const countries = proxyOutput.countries || [];
  const results = [];

  for (const cd of countries) {
    const country = cd.country.toLowerCase();
    const logInfo = overrides.log_prices.prices_usd_per_m3[country];
    const elecInfo = overrides.electricity.tariffs_usd_per_mwh[country];
    const rates = overrides.freight_rates.rates_usd_per_teu;
    const ecTeu = lookupFreight(rates, country, 'savannah');

    const cif = calculateCIF(cd, overrides);
    const vuln = calculateVulnerability({
      freight_teu_ec: ecTeu || 0,
      oil_sensitivity_pct: logInfo ? logInfo.oil_sensitivity_pct_per_10 : 0,
      electricity_tariff_usd_mwh: elecInfo ? elecInfo.mid : 0,
      log_price_mid: logInfo ? logInfo.price_mid : 0,
      labor_cost_usd_m3: overrides.labor.cost_usd_per_m3[country] || 0,
      fx_ytd_change_pct: cd.currency
        ? (overrides.fx_baselines.ytd_change_vs_usd_pct[cd.currency] || 0)
        : 0,
    }, weights);

    results.push({
      country: cd.country,
      region: cd.region || null,
      currency: cd.currency || null,
      cif,
      vulnerability_score: vuln.score,
      vulnerability_breakdown: vuln.breakdown,
    });
  }

  // Sort by EC CIF (lowest first)
  const ecRanking = results
    .slice()
    .sort((a, b) => a.cif.east_coast.total_cif - b.cif.east_coast.total_cif)
    .map((r, i) => ({ rank: i + 1, country: r.country, total_cif_ec: r.cif.east_coast.total_cif }));

  // Sort by WC CIF (lowest first, exclude nulls)
  const wcRanking = results
    .filter((r) => r.cif.west_coast != null)
    .sort((a, b) => a.cif.west_coast.total_cif - b.cif.west_coast.total_cif)
    .map((r, i) => ({ rank: i + 1, country: r.country, total_cif_wc: r.cif.west_coast.total_cif }));

  const triggerResult = checkTriggers(proxyOutput.current_market || {}, monitoringConfig);

  return {
    generated_at: new Date().toISOString(),
    brent_baseline_usd: overrides.constants.brent_baseline_usd,
    country_count: results.length,
    countries: results,
    rankings: {
      east_coast: ecRanking,
      west_coast: wcRanking,
    },
    monitoring: triggerResult,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  calculateCIF,
  calculateVulnerability,
  checkTriggers,
  buildFullAnalysis,
};
