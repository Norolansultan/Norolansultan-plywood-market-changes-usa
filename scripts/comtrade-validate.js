/**
 * Comtrade trade data validation script.
 * Validates master_plywood_trade.csv against spec requirements and
 * cross-checks with existing USITC import data and global trade volumes.
 *
 * Usage: node scripts/comtrade-validate.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COMTRADE_DIR = path.join(ROOT, 'data/comtrade');
const MASTER_CSV = path.join(COMTRADE_DIR, 'master_plywood_trade.csv');
const USITC_JSON = path.join(ROOT, 'data/market_data.json');
const VOLUMES_JSON = path.join(ROOT, 'data/global_trade_volumes.json');

// Target 25 reporter countries
const TARGET_COUNTRIES = [
  'Indonesia', 'Vietnam', 'Cambodia', 'Malaysia', 'Thailand',
  'Taiwan', 'Canada', 'Chile', 'Brazil', 'Uruguay',
  'Ecuador', 'Paraguay', 'Finland', 'Sweden', 'Germany',
  'Poland', 'Italy', 'Spain', 'Belgium', 'Gabon',
  'China', 'Russia', 'India', 'South Korea', 'Japan'
];

const VALID_FLOW_TYPES = new Set(['import', 'export', 're-export', 'production']);
const TARGET_MONTHS = 30; // 2023-2025 ~= 30 months

// ── Parse CSV line handling quoted commas ─────────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

// ── Parse CSV file into array of objects keyed by header ─────────────────────
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  // Strip BOM if present
  const clean = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
  const lines = clean.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (vals[j] || '').trim();
    }
    rows.push(obj);
  }
  return rows;
}

// ── Load JSON safely ─────────────────────────────────────────────────────────
function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  return JSON.parse(clean);
}

// ── Main validation ──────────────────────────────────────────────────────────
function validate() {
  const report = [];
  const log = (msg) => { report.push(msg); };

  log('=== PLYWOOD TRADE DATABASE VALIDATION REPORT ===');
  log(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  log('');

  // ── Check master CSV exists ────────────────────────────────────────────────
  if (!fs.existsSync(MASTER_CSV)) {
    log('ERROR: master_plywood_trade.csv not found at ' + MASTER_CSV);
    log('Run the Comtrade transform pipeline first.');
    const text = report.join('\n');
    console.log(text);
    writeReport(text);
    return;
  }

  const rows = parseCSV(MASTER_CSV);
  log(`COVERAGE`);
  log(`  Total rows: ${rows.length}`);

  // ── 1. Coverage check ─────────────────────────────────────────────────────
  // Build per-country month sets and flow-type sets
  const countryMonths = {};   // country -> Set of YYYY-MM
  const countryFlows = {};    // country -> Set of flow_type
  for (const r of rows) {
    const c = r.reporting_country || '';
    if (!c) continue;
    if (!countryMonths[c]) { countryMonths[c] = new Set(); countryFlows[c] = new Set(); }

    // Extract YYYY-MM from date/period field (try common column names)
    const period = r.period || r.date || r.year_month || r.month || '';
    const ym = period.slice(0, 7); // expect YYYY-MM format
    if (/^\d{4}-\d{2}$/.test(ym)) countryMonths[c].add(ym);

    const ft = (r.flow_type || '').toLowerCase();
    if (ft) countryFlows[c].add(ft);
  }

  const countriesWithData = Object.keys(countryMonths);
  log(`  Countries with data: ${countriesWithData.length} / ${TARGET_COUNTRIES.length}`);
  log(`  Country coverage:`);

  const lowCoverage = [];
  for (const c of TARGET_COUNTRIES) {
    const months = countryMonths[c] ? countryMonths[c].size : 0;
    const hasImport = countryFlows[c] ? countryFlows[c].has('import') : false;
    const hasExport = countryFlows[c] ? (countryFlows[c].has('export') || countryFlows[c].has('re-export')) : false;
    const tag = (hasImport && hasExport) ? '' : ' [missing ' + (!hasImport ? 'import' : '') + (!hasExport ? (hasImport ? '' : '+') + 'export' : '') + ']';
    log(`    ${c}: ${months}/${TARGET_MONTHS} months${tag}`);
    if (months < TARGET_MONTHS * 0.5) lowCoverage.push(c);
  }
  if (lowCoverage.length > 0) {
    log(`  ** Countries with <50% month coverage: ${lowCoverage.join(', ')}`);
  }
  log('');

  // ── 2. Required fields check ──────────────────────────────────────────────
  log('FIELD COMPLETENESS');
  let missingFlowType = 0;
  let missingWoodType = 0;
  let missingVolume = 0;
  let missingReporter = 0;
  let importFieldErrors = 0;
  let exportFieldErrors = 0;
  let invalidFlowType = 0;

  for (const r of rows) {
    const ft = (r.flow_type || '').toLowerCase();
    if (!ft) missingFlowType++;
    else if (!VALID_FLOW_TYPES.has(ft)) invalidFlowType++;

    if (!r.wood_type) missingWoodType++;
    if (!r.reporting_country) missingReporter++;

    const vol = parseFloat(r.volume_m3);
    if (isNaN(vol) || vol === 0) missingVolume++;

    // Direction field checks
    if (ft === 'import') {
      if (!r.import_country && !r.import_country_iso3) importFieldErrors++;
    }
    if (ft === 'export' || ft === 're-export') {
      if (!r.export_country && !r.export_country_iso3) exportFieldErrors++;
    }
  }

  log(`  Rows missing flow_type: ${missingFlowType}`);
  log(`  Rows with invalid flow_type: ${invalidFlowType}`);
  log(`  Rows missing wood_type: ${missingWoodType}`);
  log(`  Rows missing reporting_country: ${missingReporter}`);
  log(`  Rows missing volume_m3: ${missingVolume} (these should have notes explaining why)`);
  log(`  Import rows missing import_country fields: ${importFieldErrors}`);
  log(`  Export rows missing export_country fields: ${exportFieldErrors}`);
  log('');

  // ── 3. WLD rate check ─────────────────────────────────────────────────────
  log('WLD RATE');
  const countryTotal = {};    // country -> total bilateral rows
  const countryWLD = {};      // country -> WLD rows
  for (const r of rows) {
    const c = r.reporting_country || '';
    if (!c) continue;
    const partner = r.import_country_iso3 || r.export_country_iso3 || r.partner_iso3 || '';
    countryTotal[c] = (countryTotal[c] || 0) + 1;
    if (partner.toUpperCase() === 'WLD') {
      countryWLD[c] = (countryWLD[c] || 0) + 1;
    }
  }

  const wldExceeding = [];
  for (const c of Object.keys(countryTotal).sort()) {
    const wldCount = countryWLD[c] || 0;
    const total = countryTotal[c];
    const pct = total > 0 ? (wldCount / total * 100) : 0;
    if (pct > 0) log(`  ${c}: ${pct.toFixed(1)}% WLD rows (${wldCount}/${total})`);
    if (pct > 10) wldExceeding.push(c);
  }
  if (wldExceeding.length > 0) {
    log(`  ** Countries exceeding 10% threshold: ${wldExceeding.join(', ')}`);
  } else {
    log('  No countries exceed 10% WLD threshold.');
  }
  log('');

  // ── 4. Mirror flow check ──────────────────────────────────────────────────
  log('MIRROR DISCREPANCIES');

  // Build lookup: exporter -> importer -> YYYY-MM -> value_usd
  const exportMap = {};  // "A|B|YYYY-MM" -> value
  const importMap = {};  // "B|A|YYYY-MM" -> value (B reports import from A)
  for (const r of rows) {
    const reporter = r.reporting_country || '';
    const period = (r.period || r.date || r.year_month || r.month || '').slice(0, 7);
    const ft = (r.flow_type || '').toLowerCase();
    const val = parseFloat(r.value_usd || r.trade_value_usd || '0') || 0;
    if (!reporter || !period || val === 0) continue;

    if (ft === 'export' || ft === 're-export') {
      const partner = r.export_country || r.partner || '';
      if (partner) {
        const key = `${reporter}|${partner}|${period}`;
        exportMap[key] = (exportMap[key] || 0) + val;
      }
    }
    if (ft === 'import') {
      const partner = r.import_country || r.partner || '';
      if (partner) {
        const key = `${partner}|${reporter}|${period}`;
        importMap[key] = (importMap[key] || 0) + val;
      }
    }
  }

  const mirrorDiscrepancies = [];
  const checkedPairs = new Set();
  for (const key of Object.keys(exportMap)) {
    if (checkedPairs.has(key)) continue;
    checkedPairs.add(key);
    const expVal = exportMap[key];
    const impVal = importMap[key];
    if (impVal !== undefined && impVal > 0 && expVal > 0) {
      const diff = Math.abs(expVal - impVal);
      const avg = (expVal + impVal) / 2;
      const pctDiff = (diff / avg) * 100;
      if (pctDiff > 20) {
        const [a, b, ym] = key.split('|');
        mirrorDiscrepancies.push({
          exporter: a,
          importer: b,
          period: ym,
          export_value: expVal,
          import_value: impVal,
          discrepancy_pct: pctDiff.toFixed(1)
        });
      }
    }
  }

  log(`  Pairs checked: ${checkedPairs.size}`);
  log(`  Pairs with >20% discrepancy: ${mirrorDiscrepancies.length}`);

  // Write mirror discrepancies CSV
  if (mirrorDiscrepancies.length > 0) {
    const mirrorCSV = [
      'exporter,importer,period,export_value_usd,import_value_usd,discrepancy_pct'
    ];
    for (const d of mirrorDiscrepancies) {
      mirrorCSV.push(`${d.exporter},${d.importer},${d.period},${d.export_value},${d.import_value},${d.discrepancy_pct}`);
    }
    const mirrorPath = path.join(COMTRADE_DIR, 'mirror_discrepancies.csv');
    fs.writeFileSync(mirrorPath, mirrorCSV.join('\n'), 'utf8');
    log(`  See mirror_discrepancies.csv for details`);
  } else {
    log('  No mirror discrepancies found (or insufficient bilateral data).');
  }
  log('');

  // ── 5. USITC cross-check ─────────────────────────────────────────────────
  log('USITC CROSS-CHECK');
  const usitcData = loadJSON(USITC_JSON);
  if (!usitcData || !usitcData.data) {
    log('  WARN: market_data.json not found or missing data array. Skipping cross-check.');
  } else {
    // Sum Comtrade US imports by country for 2023
    const comtradeUS = {};
    for (const r of rows) {
      const ft = (r.flow_type || '').toLowerCase();
      const reporter = (r.reporting_country || '').toLowerCase();
      const period = r.period || r.date || r.year_month || r.month || '';
      if (ft !== 'import') continue;
      // US as reporter importing from others
      if (reporter !== 'united states' && reporter !== 'usa' && reporter !== 'us') continue;
      if (!period.startsWith('2023')) continue;
      const partner = r.import_country || r.partner || '';
      const val = parseFloat(r.value_usd || r.trade_value_usd || '0') || 0;
      if (partner && val > 0) {
        comtradeUS[partner] = (comtradeUS[partner] || 0) + val;
      }
    }

    // Sum USITC CIF values by country for 2023
    const usitcByCountry = {};
    for (const rec of usitcData.data) {
      const t = rec.time || '';
      // Annual rows for 2023 or monthly rows containing 2023
      if (!t.includes('2023')) continue;
      const c = rec.country || '';
      const cif = parseFloat(rec.cif) || 0;
      if (c && cif > 0) {
        usitcByCountry[c] = (usitcByCountry[c] || 0) + cif;
      }
    }

    const allCountries = new Set([...Object.keys(comtradeUS), ...Object.keys(usitcByCountry)]);
    let withinThreshold = 0;
    const discrepancies = [];
    for (const c of [...allCountries].sort()) {
      const ctVal = comtradeUS[c] || 0;
      const usVal = usitcByCountry[c] || 0;
      if (ctVal === 0 && usVal === 0) continue;
      const avg = (ctVal + usVal) / 2;
      const diffPct = avg > 0 ? Math.abs(ctVal - usVal) / avg * 100 : 0;
      if (ctVal > 0 && usVal > 0 && diffPct <= 10) {
        withinThreshold++;
      } else if (ctVal > 0 || usVal > 0) {
        discrepancies.push({
          country: c,
          comtrade: ctVal,
          usitc: usVal,
          diffPct: diffPct.toFixed(1)
        });
      }
    }

    const total = withinThreshold + discrepancies.length;
    log(`  Countries within 10%: ${withinThreshold}/${total}`);
    if (discrepancies.length > 0) {
      log('  Countries with discrepancy:');
      for (const d of discrepancies) {
        log(`    ${d.country}: Comtrade=$${d.comtrade.toLocaleString()} vs USITC=$${d.usitc.toLocaleString()}, diff=${d.diffPct}%`);
      }
    }
  }
  log('');

  // ── 6. Volume spike check ─────────────────────────────────────────────────
  log('VOLUME SPIKES (>50% month-on-month change)');

  // Group volumes by country+flow, sorted by period
  const volumeSeries = {}; // "country|flow" -> [{period, vol}]
  for (const r of rows) {
    const c = r.reporting_country || '';
    const ft = (r.flow_type || '').toLowerCase();
    const period = (r.period || r.date || r.year_month || r.month || '').slice(0, 7);
    const vol = parseFloat(r.volume_m3) || 0;
    if (!c || !period || vol === 0) continue;
    const key = `${c}|${ft}`;
    if (!volumeSeries[key]) volumeSeries[key] = [];
    // Aggregate by period
    const existing = volumeSeries[key].find(v => v.period === period);
    if (existing) { existing.vol += vol; }
    else { volumeSeries[key].push({ period, vol }); }
  }

  let spikeCount = 0;
  const spikeExamples = [];
  for (const key of Object.keys(volumeSeries).sort()) {
    const series = volumeSeries[key].sort((a, b) => a.period.localeCompare(b.period));
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1].vol;
      const curr = series[i].vol;
      if (prev > 0) {
        const change = (curr - prev) / prev * 100;
        if (Math.abs(change) > 50) {
          spikeCount++;
          if (spikeExamples.length < 10) {
            const [c, ft] = key.split('|');
            spikeExamples.push(`    ${c} (${ft}) ${series[i - 1].period}->${series[i].period}: ${change > 0 ? '+' : ''}${change.toFixed(0)}%`);
          }
        }
      }
    }
  }

  log(`  Spikes detected: ${spikeCount}`);
  if (spikeExamples.length > 0) {
    log('  Examples (first 10):');
    spikeExamples.forEach(s => log(s));
  }
  log('');

  // ── 7. Unit conversion check ──────────────────────────────────────────────
  log('UNIT CONVERSION CHECK');
  let conversionErrors = 0;
  let nonM3Rows = 0;
  for (const r of rows) {
    const origUnit = (r.volume_unit_original || r.unit_original || '').toLowerCase();
    const factor = parseFloat(r.conversion_factor || '1');
    if (origUnit && origUnit !== 'm3' && origUnit !== 'cubic meters' && origUnit !== 'cubic metres') {
      nonM3Rows++;
      if (factor === 1.0) conversionErrors++;
    }
  }
  log(`  Non-m3 original unit rows: ${nonM3Rows}`);
  log(`  Rows with non-m3 unit but conversion_factor=1.0 (errors): ${conversionErrors}`);
  log('');

  // ── Confidence distribution ───────────────────────────────────────────────
  log('CONFIDENCE DISTRIBUTION');
  const confBuckets = { high: 0, medium: 0, low: 0, unset: 0 };
  for (const r of rows) {
    const conf = (r.confidence || r.data_confidence || '').toLowerCase();
    if (conf.includes('high') && !conf.includes('medium') && !conf.includes('low')) confBuckets.high++;
    else if (conf.includes('medium')) confBuckets.medium++;
    else if (conf.includes('low')) confBuckets.low++;
    else confBuckets.unset++;
  }
  const total = rows.length || 1;
  log(`  High: ${(confBuckets.high / total * 100).toFixed(1)}%  Medium: ${(confBuckets.medium / total * 100).toFixed(1)}%  Low: ${(confBuckets.low / total * 100).toFixed(1)}%`);
  if (confBuckets.unset > 0) {
    log(`  Unset/unknown: ${confBuckets.unset} rows (${(confBuckets.unset / total * 100).toFixed(1)}%)`);
  }
  log('');

  // ── Global trade volume comparison ────────────────────────────────────────
  log('GLOBAL TRADE VOLUME COMPARISON');
  const volumes = loadJSON(VOLUMES_JSON);
  if (!volumes || !volumes.countries) {
    log('  WARN: global_trade_volumes.json not found. Skipping comparison.');
  } else {
    // Sum Comtrade exports by country for 2023
    const comtradeExports2023 = {};
    for (const r of rows) {
      const ft = (r.flow_type || '').toLowerCase();
      if (ft !== 'export' && ft !== 're-export') continue;
      const period = r.period || r.date || r.year_month || r.month || '';
      if (!period.startsWith('2023')) continue;
      const c = r.reporting_country || '';
      const vol = parseFloat(r.volume_m3) || 0;
      if (c && vol > 0) {
        comtradeExports2023[c] = (comtradeExports2023[c] || 0) + vol;
      }
    }

    for (const vc of volumes.countries) {
      const expRange = vc.exports_2023_m3;
      if (!expRange) continue;
      const ctVol = comtradeExports2023[vc.country] || 0;
      const low = expRange.low || 0;
      const high = expRange.high || 0;
      const status = ctVol === 0 ? 'NO DATA' :
        (ctVol >= low && ctVol <= high) ? 'OK' :
        (ctVol < low) ? `BELOW (${((low - ctVol) / low * 100).toFixed(0)}% under low est)` :
        `ABOVE (${((ctVol - high) / high * 100).toFixed(0)}% over high est)`;
      log(`  ${vc.country}: Comtrade=${ctVol.toLocaleString()} m3 vs est ${low.toLocaleString()}-${high.toLocaleString()} m3 [${status}]`);
    }
  }
  log('');

  // ── Write report ──────────────────────────────────────────────────────────
  const text = report.join('\n');
  console.log(text);
  writeReport(text);
}

function writeReport(text) {
  if (!fs.existsSync(COMTRADE_DIR)) fs.mkdirSync(COMTRADE_DIR, { recursive: true });
  const reportPath = path.join(COMTRADE_DIR, 'validation_report.txt');
  fs.writeFileSync(reportPath, text, 'utf8');
  console.log(`\nReport written to: ${reportPath}`);
}

// ── Run ──────────────────────────────────────────────────────────────────────
validate();
