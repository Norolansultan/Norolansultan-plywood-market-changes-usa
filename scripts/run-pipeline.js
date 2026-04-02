'use strict';
var fs = require('fs'), path = require('path'), cp = require('child_process');
require('dotenv').config();

var ROOT = path.resolve(__dirname, '..'), args = process.argv.slice(2);
var fetchOnly = args.includes('--fetch-only'), calcOnly = args.includes('--calculate-only'), dryRun = args.includes('--dry-run');

function loadJSON(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); }

function latestCached() {
  var dir = path.join(ROOT, 'data', 'raw');
  if (!fs.existsSync(dir)) return null;
  var files = fs.readdirSync(dir).filter(function (f) { return f.startsWith('fetch_') && f.endsWith('.json'); });
  if (!files.length) return null;
  files.sort();
  return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
}

var CCY = { indonesia:'IDR', vietnam:'VND', cambodia:'KHR', malaysia:'MYR', thailand:'THB', taiwan:'TWD',
  canada:'CAD', chile:'CLP', brazil:'BRL', uruguay:'UYU', finland:'EUR', sweden:'SEK', germany:'EUR',
  poland:'PLN', italy:'EUR', spain:'EUR', belgium:'EUR', gabon:'XAF', ecuador:'USD', paraguay:'USD' };
var REG = { indonesia:'Asia', vietnam:'Asia', cambodia:'Asia', malaysia:'Asia', thailand:'Asia', taiwan:'Asia',
  canada:'Americas', chile:'Americas', brazil:'Americas', uruguay:'Americas', ecuador:'Americas', paraguay:'Americas',
  finland:'EMEA', sweden:'EMEA', germany:'EMEA', poland:'EMEA', italy:'EMEA', spain:'EMEA', belgium:'EMEA', gabon:'EMEA' };

async function main() {
  console.log('\n=== Plywood Market Pipeline ===\n');

  // Step 1: FETCH
  var fetchResult = null;
  if (!calcOnly) {
    try {
      fetchResult = await require(path.join(ROOT, 'src/pipeline/fetch.js')).fetchAll();
      console.log('[fetch] OK: ' + (fetchResult.sources_ok || []).join(', '));
      if (fetchResult.sources_failed.length) console.log('[fetch] Failed: ' + fetchResult.sources_failed.join(', '));
    } catch (e) {
      console.error('[fetch] ' + e.message + ' — falling back to cache');
      fetchResult = latestCached();
    }
  } else { fetchResult = latestCached(); }

  if (!fetchResult) {
    if (calcOnly) { console.log('[info] No cache; using overrides only'); fetchResult = {}; }
    else { console.error('[ABORT] No data. Set API keys or use --calculate-only.'); process.exit(1); }
  }
  if (fetchOnly) { console.log('\n--fetch-only: done.'); return; }

  // Step 2: LOAD OVERRIDES
  var overrides = loadJSON('data/manual-overrides.json');
  var monCfg = loadJSON('config/monitoring-config.json');
  console.log('[overrides] Loaded');

  // Normalize brent: extract number from fetch result
  var norm = Object.assign({}, fetchResult);
  if (norm.brent && typeof norm.brent === 'object') norm.brent = norm.brent.fallback ? null : norm.brent.value;

  // Step 3: PROXY
  var proxyResult = require(path.join(ROOT, 'src/pipeline/proxy.js')).applyProxyModels(norm, overrides);
  console.log('[proxy] Brent delta: $' + proxyResult.brent_delta_from_baseline);

  // Step 4: CALCULATE
  var analysis, calcPath = path.join(ROOT, 'src/pipeline/calculate.js');
  if (fs.existsSync(calcPath)) {
    var pfc = Object.assign({}, proxyResult);
    if (proxyResult.countries && !Array.isArray(proxyResult.countries)) {
      pfc.countries = Object.keys(proxyResult.countries).map(function (n) {
        return Object.assign({ country: n.charAt(0).toUpperCase() + n.slice(1), region: REG[n], currency: CCY[n] },
          proxyResult.countries[n]);
      });
    }
    analysis = require(calcPath).buildFullAnalysis(pfc, overrides, monCfg);
  } else {
    console.log('[calculate] calculate.js not found — using proxy result');
    analysis = proxyResult;
  }

  // Step 5: VALIDATE
  var vr = require(path.join(ROOT, 'src/pipeline/validate.js')).validateAnalysis(analysis);
  if (vr.errors.length) {
    console.log('[validate] ERRORS (' + vr.errors.length + '):');
    vr.errors.forEach(function (e) { console.log('  - ' + (e.country ? e.country + ': ' : '') + e.message); });
  }
  if (vr.warnings.length) {
    console.log('[validate] WARNINGS (' + vr.warnings.length + '):');
    vr.warnings.forEach(function (w) { console.log('  - ' + (w.country ? w.country + ': ' : '') + w.message); });
  }
  if (vr.valid) console.log('[validate] All checks passed');
  if (vr.errors.length && !dryRun) analysis.data_confidence = 'low';

  // Step 6: WRITE
  if (!dryRun) {
    var out = path.join(ROOT, 'data', 'pipeline-output.json');
    fs.writeFileSync(out, JSON.stringify(analysis, null, 2));
    console.log('[output] Wrote ' + out);
  } else { console.log('[dry-run] Skipping write'); }

  // Triggers
  var brentVal = (typeof norm.brent === 'number' ? norm.brent : null) || overrides.constants.brent_baseline_usd;
  var triggers = [];
  var bt = (monCfg.triggers || {}).brent_crude;
  if (bt && Math.abs(brentVal - bt.last_baseline_usd) >= bt.retrigger_delta_usd)
    triggers.push('brent_crude ($' + (brentVal - bt.last_baseline_usd).toFixed(2) + ')');

  // Step 7: REBUILD DASHBOARD
  if (!fetchOnly && !dryRun) {
    var bp = path.join(ROOT, 'scripts/build.js');
    if (fs.existsSync(bp)) { console.log('[build] Rebuilding dashboard...'); cp.execSync('node ' + bp, { stdio: 'inherit', cwd: ROOT }); }
  }

  // Summary
  var bd = brentVal - overrides.constants.brent_baseline_usd;
  var fxN = norm.fx ? Object.keys(norm.fx).length : 0;
  var gas = (norm.eu_gas && norm.eu_gas.value) || 'N/A';
  var ecC = [], wcC = [], cnt = 0, ct = analysis.countries;
  if (Array.isArray(ct)) {
    cnt = ct.length;
    ct.forEach(function (c) {
      if (c.cif && c.cif.east_coast) ecC.push({ n: c.country, v: c.cif.east_coast.total_cif });
      if (c.cif && c.cif.west_coast) wcC.push({ n: c.country, v: c.cif.west_coast.total_cif });
    });
  } else if (ct) {
    var ks = Object.keys(ct); cnt = ks.length;
    ks.forEach(function (n) { var b = ct[n].baseline_costs_usd_per_m3 || {};
      if (b.total_delivered_savannah) ecC.push({ n: n, v: b.total_delivered_savannah });
      if (b.total_delivered_long_beach) wcC.push({ n: n, v: b.total_delivered_long_beach }); });
  }
  ecC.sort(function (a, b) { return a.v - b.v; });
  wcC.sort(function (a, b) { return a.v - b.v; });

  console.log('\n=== Pipeline Summary ===');
  console.log('Brent Crude: $' + brentVal + '/bbl (delta: ' + (bd >= 0 ? '+' : '') + '$' + bd.toFixed(2) + ' from $92 baseline)');
  console.log('FX rates: ' + fxN + ' currencies updated');
  console.log('EU Gas: $' + gas + '/MMBtu');
  console.log('\nCountries processed: ' + cnt);
  if (ecC.length) console.log('East Coast CIF range: $' + ecC[0].v + ' - $' + ecC[ecC.length-1].v + ' (best: ' + ecC[0].n + ', worst: ' + ecC[ecC.length-1].n + ')');
  if (wcC.length) console.log('West Coast CIF range: $' + wcC[0].v + ' - $' + wcC[wcC.length-1].v + ' (best: ' + wcC[0].n + ', worst: ' + wcC[wcC.length-1].n + ')');
  console.log('\nTriggers: ' + triggers.length + ' fired' + (triggers.length ? ' (' + triggers.join(', ') + ')' : ''));
  console.log('Validation: ' + vr.errors.length + ' errors, ' + vr.warnings.length + ' warnings');
  if (!dryRun) console.log('\nOutput: data/pipeline-output.json');
}

main().catch(function (e) { console.error('\n[FATAL] ' + e.message); if (e.stack) console.error(e.stack); process.exit(1); });
