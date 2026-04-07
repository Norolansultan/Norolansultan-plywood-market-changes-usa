/**
 * Comtrade JSON → standardized CSV transform script.
 * Reads raw Comtrade JSON files from data/raw/comtrade/ and produces
 * per-country and master CSV files in data/comtrade/.
 *
 * Usage:
 *   node scripts/comtrade-transform.js               # all raw files
 *   node scripts/comtrade-transform.js --country USA  # single country
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw', 'comtrade');
const OUT_DIR = path.join(ROOT, 'data', 'comtrade');

// ── Lookup tables ────────────────────────────────────────────────────────────

const ISO3 = {
  360:'IDN', 704:'VNM', 116:'KHM', 458:'MYS', 764:'THA', 490:'TWN',
  156:'CHN', 410:'KOR', 124:'CAN', 152:'CHL', 76:'BRA', 858:'URY',
  218:'ECU', 600:'PRY', 842:'USA', 246:'FIN', 752:'SWE', 276:'DEU',
  616:'POL', 380:'ITA', 724:'ESP', 56:'BEL', 266:'GAB', 251:'FRA',
  428:'LVA', 392:'JPN', 826:'GBR', 484:'MEX', 356:'IND', 682:'SAU',
  0:'WLD'
};

const HS_TO_WOOD = {
  '441210': 'Bamboo',
  '441231': 'Tropical hardwood',
  '441233': 'Tropical hardwood',
  '441234': 'Temperate hardwood',
  '441239': 'Softwood',
  '441294': 'Mixed/Unspecified',
  '441299': 'Mixed/Unspecified',
  '4412':   'Mixed/Unspecified'
};

const FLOW_MAP = { 'M': 'import', 'X': 'export', 'RX': 're-export' };

const PLYWOOD_DENSITY_KG_PER_M3 = 580;

const CSV_HEADER = [
  'reporting_country', 'import_country', 'import_country_iso3',
  'export_country', 'export_country_iso3', 'flow_type', 'wood_type',
  'hs_code', 'year', 'month', 'volume_m3', 'volume_original',
  'volume_unit_original', 'conversion_factor', 'value_monetary',
  'currency', 'source', 'source_url', 'confidence', 'notes'
].join(',');

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeCSV(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function resolveISO3(code) {
  return ISO3[code] || '';
}

function resolveWoodType(cmdCode) {
  const code = String(cmdCode || '');
  return HS_TO_WOOD[code] || HS_TO_WOOD[code.slice(0, 4)] || 'Mixed/Unspecified';
}

function parsePeriod(period) {
  const p = String(period);
  const year = parseInt(p.slice(0, 4), 10);
  const month = p.length >= 6 ? parseInt(p.slice(4, 6), 10) : null;
  return { year, month };
}

/** Build a dedup key for a single trade record. */
function dedupKey(rec) {
  return [
    rec.reporterCode, rec.partnerCode, rec.flowCode, rec.period, rec.cmdCode
  ].join('|');
}

/** HS code specificity — longer (more digits) wins. */
function hsSpecificity(cmdCode) {
  return String(cmdCode || '').replace(/\D/g, '').length;
}

// ── Volume conversion ────────────────────────────────────────────────────────

function convertVolume(rec) {
  const unit = (rec.qtyUnitAbbr || '').toLowerCase();
  const qty = rec.qty;
  const netWgt = rec.netWgt;
  const value = rec.primaryValue || rec.cifvalue || rec.fobvalue || 0;

  if (unit === 'm3' && qty != null && qty > 0) {
    return {
      volume_m3: qty,
      volume_original: qty,
      volume_unit_original: 'm3',
      conversion_factor: 1.0,
      notes: ''
    };
  }

  if (unit === 'kg' || (netWgt != null && netWgt > 0)) {
    const weight = (unit === 'kg' && qty > 0) ? qty : netWgt;
    if (weight != null && weight > 0) {
      const vol = Math.round((weight / PLYWOOD_DENSITY_KG_PER_M3) * 1000) / 1000;
      return {
        volume_m3: vol,
        volume_original: weight,
        volume_unit_original: 'kg',
        conversion_factor: 0.001724,
        notes: 'Converted from kg using density 580 kg/m3'
      };
    }
  }

  if (value > 0) {
    return {
      volume_m3: '',
      volume_original: '',
      volume_unit_original: '',
      conversion_factor: '',
      notes: 'No quantity reported'
    };
  }

  return {
    volume_m3: '',
    volume_original: '',
    volume_unit_original: '',
    conversion_factor: '',
    notes: 'No quantity or value reported'
  };
}

// ── Record → CSV row ─────────────────────────────────────────────────────────

function recordToRow(rec) {
  const flow = FLOW_MAP[rec.flowCode] || rec.flowCode;
  const reporter = (rec.reporterDesc || '').trim();
  const partner = (rec.partnerDesc || '').trim();
  const partnerISO3 = resolveISO3(rec.partnerCode);
  const woodType = resolveWoodType(rec.cmdCode);
  const { year, month } = parsePeriod(rec.period);
  const vol = convertVolume(rec);
  const value = rec.cifvalue || rec.primaryValue || rec.fobvalue || 0;

  let importCountry = '';
  let importISO3 = '';
  let exportCountry = '';
  let exportISO3 = '';

  if (flow === 'import') {
    importCountry = partner;
    importISO3 = partnerISO3;
  } else {
    exportCountry = partner;
    exportISO3 = partnerISO3;
  }

  const fields = [
    reporter,
    importCountry,
    importISO3,
    exportCountry,
    exportISO3,
    flow,
    woodType,
    rec.cmdCode,
    year,
    month != null ? month : '',
    vol.volume_m3,
    vol.volume_original,
    vol.volume_unit_original,
    vol.conversion_factor,
    value,
    'USD',
    'UN Comtrade',
    'https://comtradeplus.un.org/',
    'high',
    vol.notes
  ];

  return fields.map(escapeCSV).join(',');
}

// ── File loading & deduplication ─────────────────────────────────────────────

function loadRawFiles(filterCountry) {
  if (!fs.existsSync(RAW_DIR)) {
    console.error(`Raw directory not found: ${RAW_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('No JSON files found in ' + RAW_DIR);
    process.exit(1);
  }

  console.log(`Found ${files.length} raw JSON file(s) in ${RAW_DIR}`);

  const allRecords = [];

  for (const file of files) {
    // Optional country filter based on filename prefix
    if (filterCountry) {
      const prefix = file.split('_')[0].toLowerCase();
      if (prefix !== filterCountry.toLowerCase()) continue;
    }

    const filePath = path.join(RAW_DIR, file);
    let json;
    try {
      json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.warn(`SKIP (invalid JSON): ${file}`);
      continue;
    }

    const data = json.data || json.dataset || [];
    if (!Array.isArray(data) || data.length === 0) {
      console.warn(`SKIP (no data array): ${file}`);
      continue;
    }

    console.log(`  ${file}: ${data.length} record(s)`);
    for (const rec of data) {
      allRecords.push(rec);
    }
  }

  return allRecords;
}

function deduplicateRecords(records) {
  const map = new Map();

  for (const rec of records) {
    const key = dedupKey(rec);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, rec);
    } else {
      // Keep the more specific HS code (6-digit over 4-digit)
      if (hsSpecificity(rec.cmdCode) > hsSpecificity(existing.cmdCode)) {
        map.set(key, rec);
      }
    }
  }

  return Array.from(map.values());
}

// ── Output ───────────────────────────────────────────────────────────────────

function groupByReporter(records) {
  const groups = {};
  for (const rec of records) {
    const reporter = (rec.reporterDesc || 'UNKNOWN').trim();
    if (!groups[reporter]) groups[reporter] = [];
    groups[reporter].push(rec);
  }
  return groups;
}

function writeCSV(filePath, rows) {
  const content = CSV_HEADER + '\n' + rows.join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

function run() {
  // Parse CLI args
  const args = process.argv.slice(2);
  let filterCountry = null;
  const countryIdx = args.indexOf('--country');
  if (countryIdx !== -1 && args[countryIdx + 1]) {
    filterCountry = args[countryIdx + 1];
  }

  // Load and deduplicate
  const rawRecords = loadRawFiles(filterCountry);
  console.log(`\nTotal raw records: ${rawRecords.length}`);

  const records = deduplicateRecords(rawRecords);
  console.log(`After deduplication: ${records.length}`);

  if (records.length === 0) {
    console.log('No records to process.');
    return;
  }

  // Ensure output directory
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  // Convert all records to CSV rows
  const allRows = records.map(recordToRow);

  // Group by reporter for per-country files
  const groups = groupByReporter(records);
  let countryFiles = 0;

  for (const [reporter, recs] of Object.entries(groups)) {
    const rows = recs.map(recordToRow);
    const safeName = reporter.replace(/[^a-zA-Z0-9_-]/g, '_');
    const outPath = path.join(OUT_DIR, `${safeName}_trade.csv`);
    writeCSV(outPath, rows);
    console.log(`[OK] ${safeName}_trade.csv (${rows.length} rows)`);
    countryFiles++;
  }

  // Master file
  const masterPath = path.join(OUT_DIR, 'master_plywood_trade.csv');
  writeCSV(masterPath, allRows);
  console.log(`[OK] master_plywood_trade.csv (${allRows.length} rows)`);

  console.log(`\nDone. ${countryFiles} country file(s) + 1 master file -> ${OUT_DIR}`);
}

run();
