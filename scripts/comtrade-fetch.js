/**
 * UN Comtrade bilateral plywood trade data fetcher.
 * Fetches raw JSON from the public preview API for 25 countries across 8 HS codes.
 * Supports phased fetching, checkpointing (resume on restart), and rate limiting.
 *
 * Usage:
 *   node scripts/comtrade-fetch.js --phase 1    # US monthly imports
 *   node scripts/comtrade-fetch.js --phase 2    # Annual all countries
 *   node scripts/comtrade-fetch.js --phase 3    # Monthly top exporters
 *   node scripts/comtrade-fetch.js --phase all  # All phases sequentially
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'raw', 'comtrade');
const ERROR_LOG = path.join(OUT_DIR, 'errors.log');

// ── Reporter country codes ───────────────────────────────────────────────────
const REPORTERS = {
  'Indonesia': 360, 'Vietnam': 704, 'Cambodia': 116, 'Malaysia': 458,
  'Thailand': 764, 'Taiwan': 490, 'China': 156, 'South Korea': 410,
  'Canada': 124, 'Chile': 152, 'Brazil': 76, 'Uruguay': 858,
  'Ecuador': 218, 'Paraguay': 600, 'USA': 842,
  'Finland': 246, 'Sweden': 752, 'Germany': 276, 'Poland': 616,
  'Italy': 380, 'Spain': 724, 'Belgium': 56, 'Gabon': 266,
  'France': 251, 'Latvia': 428,
};

// ── HS codes ─────────────────────────────────────────────────────────────────
// Plywood (4412) — all sub-headings
// Veneer sheets (4408) — raw input to plywood
// Particle board & OSB (4410) — competing panel products
// Fibreboard & MDF (4411) — competing panel products
const HS_CODES = [
  // Plywood
  '4412',   '441210', '441231', '441232', '441233', '441234', '441239',
  '441241', '441249', '441291', '441292', '441293', '441294', '441299',
  // Veneer sheets
  '4408',   '440810', '440831', '440839', '440890',
  // Particle board / OSB
  '4410',   '441011', '441012', '441019',
  // Fibreboard / MDF
  '4411',   '441112', '441113', '441114', '441192', '441193', '441194',
];

// Top 8 exporters for Phase 3
const TOP_EXPORTERS = ['Indonesia', 'Vietnam', 'Malaysia', 'Canada', 'Brazil', 'Chile', 'China', 'South Korea'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate monthly period strings YYYYMM from 202301 to 202506.
 */
function monthlyPeriods() {
  const periods = [];
  for (let y = 2023; y <= 2025; y++) {
    const maxM = (y === 2025) ? 6 : 12;
    for (let m = 1; m <= maxM; m++) {
      periods.push(String(y) + String(m).padStart(2, '0'));
    }
  }
  return periods;
}

/**
 * Build the safe filename for a given call.
 */
function outFileName(reporterName, flow, period, hs) {
  const safe = reporterName.replace(/\s+/g, '_');
  return `${safe}_${flow}_${period}_${hs}.json`;
}

/**
 * Check if a checkpoint file already exists and is non-empty.
 */
function alreadyFetched(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * Append a line to the error log.
 */
function logError(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(ERROR_LOG, line, 'utf8');
}

/**
 * Perform an HTTPS GET and return { statusCode, body }.
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Fetch a single Comtrade endpoint with retry on 429.
 * Returns parsed JSON or null on failure.
 */
async function fetchComtrade(url, label) {
  let res;
  try {
    res = await httpsGet(url);
  } catch (err) {
    logError(`${label} NETWORK_ERROR ${err.message}`);
    return null;
  }

  // Rate limited — wait 30s and retry once
  if (res.statusCode === 429) {
    console.log(`  [429] Rate limited, waiting 30s...`);
    await delay(30000);
    try {
      res = await httpsGet(url);
    } catch (err) {
      logError(`${label} RETRY_NETWORK_ERROR ${err.message}`);
      return null;
    }
    if (res.statusCode === 429) {
      logError(`${label} 429_AFTER_RETRY`);
      return null;
    }
  }

  // Server error
  if (res.statusCode >= 500) {
    logError(`${label} HTTP_${res.statusCode}`);
    return null;
  }

  // Non-200 (other than above)
  if (res.statusCode !== 200) {
    logError(`${label} HTTP_${res.statusCode}`);
    return null;
  }

  try {
    return JSON.parse(res.body);
  } catch {
    logError(`${label} JSON_PARSE_ERROR`);
    return null;
  }
}

// ── Build call lists per phase ───────────────────────────────────────────────

/**
 * Each call object: { reporter, reporterCode, flow, freq, period, hs }
 */
function buildPhase1Calls() {
  // All 25 reporters, monthly imports + exports + re-exports, all 8 HS codes, 30 months
  const calls = [];
  const periods = monthlyPeriods();
  const flows = ['M', 'X', 're-X'];
  for (const [name, code] of Object.entries(REPORTERS)) {
    for (const period of periods) {
      for (const flow of flows) {
        for (const hs of HS_CODES) {
          calls.push({
            reporter: name, reporterCode: code,
            flow, freq: 'M', period, hs,
          });
        }
      }
    }
  }
  return calls;
}

function buildPhase2Calls() {
  // All 25 reporters, annual, exports + imports, HS 4412 only, 2023 & 2024
  const calls = [];
  const periods = ['2023', '2024'];
  for (const [name, code] of Object.entries(REPORTERS)) {
    for (const period of periods) {
      for (const flow of ['M', 'X', 're-X']) {
        calls.push({
          reporter: name, reporterCode: code,
          flow, freq: 'A', period, hs: '4412',
        });
      }
    }
  }
  return calls;
}

function buildPhase3Calls() {
  // Top 8 exporters, monthly exports, HS 4412, 30 months
  const calls = [];
  const periods = monthlyPeriods();
  for (const name of TOP_EXPORTERS) {
    for (const period of periods) {
      calls.push({
        reporter: name, reporterCode: REPORTERS[name],
        flow: 'X', freq: 'M', period, hs: '4412',
      });
    }
  }
  return calls;
}

// ── Execute a list of calls ──────────────────────────────────────────────────

async function executeCalls(calls, phaseLabel) {
  console.log(`\n=== ${phaseLabel} === (${calls.length} calls)\n`);

  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const fname = outFileName(c.reporter, c.flow, c.period, c.hs);
    const fpath = path.join(OUT_DIR, fname);
    const label = `${c.reporter} ${c.flow} ${c.period} ${c.hs}`;
    const prefix = `[${i + 1}/${calls.length}]`;

    // Checkpoint: skip if already fetched
    if (alreadyFetched(fpath)) {
      console.log(`${prefix} ${label} ... already fetched (skip)`);
      continue;
    }

    // Build URL — the public preview API uses query parameters, not path segments
    // for reporter, commodity, partner, period, and flow.
    const url = `https://comtradeapi.un.org/public/v1/preview/C/${c.freq}/HS`
      + `?r=${c.reporterCode}&cc=${c.hs}&p=0&ps=${c.period}&flowCode=${c.flow}`;

    const data = await fetchComtrade(url, label);

    if (data === null) {
      // Save empty marker so we don't retry forever
      fs.writeFileSync(fpath, JSON.stringify({ error: true, records: 0 }), 'utf8');
      console.log(`${prefix} ${label} ... ERROR (see errors.log)`);
    } else {
      const records = (data.data && Array.isArray(data.data)) ? data.data.length : 0;
      if (records === 0) {
        // Empty marker
        fs.writeFileSync(fpath, JSON.stringify({ data: [], count: 0 }), 'utf8');
        console.log(`${prefix} ${label} ... 0 records (empty marker saved)`);
      } else {
        fs.writeFileSync(fpath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`${prefix} ${label} ... ${records} records (saved)`);
      }
    }

    // Rate limit: wait 7s between calls (skip after last call)
    if (i < calls.length - 1) {
      await delay(7000);
    }
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  // Parse --phase argument
  const args = process.argv.slice(2);
  const phaseIdx = args.indexOf('--phase');
  if (phaseIdx === -1 || !args[phaseIdx + 1]) {
    console.error('Usage: node scripts/comtrade-fetch.js --phase <1|2|3|all>');
    process.exit(1);
  }
  const phase = args[phaseIdx + 1];
  if (!['1', '2', '3', 'all'].includes(phase)) {
    console.error('Phase must be 1, 2, 3, or all');
    process.exit(1);
  }

  // Ensure output directory exists
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('UN Comtrade Plywood Trade Data Fetcher');
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Phase:  ${phase}`);

  if (phase === '1' || phase === 'all') {
    await executeCalls(buildPhase1Calls(), 'Phase 1: USA monthly imports (all HS codes)');
  }
  if (phase === '2' || phase === 'all') {
    await executeCalls(buildPhase2Calls(), 'Phase 2: Annual all countries (HS 4412)');
  }
  if (phase === '3' || phase === 'all') {
    await executeCalls(buildPhase3Calls(), 'Phase 3: Top 8 exporters monthly (HS 4412)');
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
