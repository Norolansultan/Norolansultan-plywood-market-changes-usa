'use strict';

var EXPECTED = [
  'indonesia', 'vietnam', 'cambodia', 'malaysia', 'thailand', 'taiwan',
  'canada', 'chile', 'brazil', 'uruguay', 'finland', 'sweden', 'germany',
  'poland', 'italy', 'spain', 'belgium', 'gabon', 'ecuador', 'paraguay'
];
var M3_PER_TEU = 23, CIF_TOL = 0.5, FRT_TOL = 0.05;
var CADENCE = { freight_rates: 7, log_prices: 90, electricity: 90, labor: 90, fx_baselines: 1, trade_duties: 90 };

function daysSince(d) { return d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : Infinity; }
function err(f, c, exp, act, m) { return { field: f, country: c, expected: exp, actual: act, message: m }; }

function normalize(raw) {
  if (!raw) return {};
  if (!Array.isArray(raw)) return raw;
  var m = {};
  raw.forEach(function (c) { var k = (c.country || '').toLowerCase(); if (k) m[k] = c; });
  return m;
}

function validateAnalysis(analysis) {
  var errors = [], warnings = [];
  var countries = normalize(analysis.countries);

  // 5. Completeness
  EXPECTED.forEach(function (n) {
    if (!countries[n]) errors.push(err('countries', n, 'present', 'missing', 'Country ' + n + ' is missing'));
  });

  Object.keys(countries).forEach(function (name) {
    var c = countries[name];
    var sens = c.sensitivity_per_10_bbl || {};
    var ec = (c.cif && c.cif.east_coast) || {};
    var base = c.baseline_costs_usd_per_m3 || {};

    // 1. Arithmetic: total_cif = sum of cost components
    var v = function (a, b) { return a != null ? a : (b || 0); };
    var sum = v(ec.log, base.log_input) + v(ec.resin, base.resin) + v(ec.electricity, base.electricity)
      + v(ec.labor, base.labor) + v(ec.freight, base.freight_to_savannah) + (ec.port_handling || 0)
      + v(ec.add_duty, base.trade_duty) + v(ec.fx_adjustment, base.fx_adjustment);
    var total = ec.total_cif != null ? ec.total_cif : base.total_delivered_savannah;
    if (total != null && Math.abs(total - sum) > CIF_TOL)
      errors.push(err('total_cif', name, sum.toFixed(2), total, 'CIF ' + total + ' != components ' + sum.toFixed(2)));

    // Sensitivity total check
    var ss = (sens.resin_usd_per_m3 || 0) + (sens.log_usd_per_m3 || 0) + (sens.electricity_usd_per_m3 || 0)
      + (sens.freight_usd_per_m3 || 0) + (sens.labor_usd_per_m3 || 0);
    if (sens.total_usd_per_m3 != null && Math.abs(sens.total_usd_per_m3 - ss) > CIF_TOL)
      errors.push(err('sensitivity_total', name, ss.toFixed(2), sens.total_usd_per_m3, 'Sensitivity total mismatch'));

    // 2. Threshold flag
    if (sens.total_usd_per_m3 > 25 && !sens.exceeds_25_threshold)
      errors.push(err('exceeds_25_threshold', name, true, false, 'Total $' + sens.total_usd_per_m3 + ' > $25 but flag unset'));

    // 3. Vulnerability range
    var vs = c.vulnerability_score;
    if (vs != null && (vs < 0 || vs > 10))
      errors.push(err('vulnerability_score', name, '0-10', vs, 'Score ' + vs + ' out of range'));

    // 4. Container fill: freight ≈ teu_rate / 23
    var frt = ec.freight || base.freight_to_savannah, teu = c._teu_rate_ec;
    if (frt != null && teu != null) {
      var exp = teu / M3_PER_TEU;
      if (Math.abs(frt - exp) / (exp || 1) > FRT_TOL)
        warnings.push(err('freight', name, exp.toFixed(2), frt, 'Freight/m3 != TEU/' + M3_PER_TEU));
    }
  });

  // 6. Data staleness
  var src = analysis.data_sources || {};
  Object.keys(CADENCE).forEach(function (k) {
    var age = daysSince(src[k] && src[k].last_updated);
    if (age > CADENCE[k])
      warnings.push(err('data_sources.' + k, null, '<=' + CADENCE[k] + 'd', age + 'd', k + ' data is ' + age + ' days old'));
  });

  return { valid: errors.length === 0, errors: errors, warnings: warnings };
}

module.exports = { validateAnalysis };
