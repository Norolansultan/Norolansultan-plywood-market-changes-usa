/**
 * Data injection build script.
 * Parses market CSV directly (wide format) to extract all measures including
 * Price per Unit (computed as CIF ÷ Quantity1 where quantity > 0).
 * Injects market data + inflation CSV into HTML templates → dist/ and src/.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

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

// ── Parse wide-format market CSV → row array [country,woodType,spec,time,cif,duty,dutiable,pricePerQty] ──
function parseMarketCSV(csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
  const row = i => parseCSVLine(lines[i] || '');

  // Header rows (0-indexed)
  const commodity  = row(0);   // HTS commodity code + name — contains explicit (m2)/(m3) unit markers
  const woodType   = row(1);   // Wood Type
  const spec       = row(2);   // Product Specification
  const country    = row(3);   // Country
  const time       = row(7);   // Time period
  const dutiable   = row(9);   // Dutiable Value
  const cif        = row(10);  // CIF Value
  const duty       = row(11);  // Calculated Duty
  const qty1       = row(13);  // Quantity 1 (Cons) — has real values

  const records = [];
  const seen = new Set();

  for (let i = 1; i < time.length; i++) {
    const t = (time[i] || '').trim();
    if (!t) continue;

    // Keep monthly rows only (time string contains a space, e.g. "April 2023")
    if (t.indexOf(' ') < 0) continue;

    const c  = (country[i]  || '').trim();
    const wt = (woodType[i] || '').trim();
    const sp = (spec[i]     || '').trim();
    if (!c || !wt || !sp) continue;

    const cifVal      = parseFloat(cif[i])      || 0;
    const dutyVal     = parseFloat(duty[i])      || 0;
    const dutiableVal = parseFloat(dutiable[i])  || 0;
    const qtyVal      = parseFloat(qty1[i])      || 0;

    // Compute raw price per unit (CIF ÷ Quantity)
    const rawPpu = (cifVal > 0 && qtyVal >= 50) ? cifVal / qtyVal : 0;

    // Unit detection — commodity code (row 0) is authoritative; spec/wood are fallback
    const commCode = (commodity[i] || '').toLowerCase();

    // Aggregate/heading rows (< 10-digit HTS code) must not get a ppu — they aggregate
    // mixed products with different units and thicknesses, making any single conversion invalid.
    const htsDigits = (((commodity[i] || '').match(/^(\d+)/) || [])[1] || '').length;
    if (htsDigits > 0 && htsDigits < 10) {
      // This is a heading or subheading row — skip ppu computation entirely
      const key = `${c}|${wt}|${sp}|${t}`;
      if (!seen.has(key)) { seen.add(key); records.push([c, wt, sp, t, cifVal, dutyVal, dutiableVal, 0]); }
      continue;
    }
    const combined  = (sp + ' ' + wt).toLowerCase();
    const isM3 = commCode.includes('(m3)') || combined.includes('m3');
    const isM2 = commCode.includes('(m2)') || combined.includes('m2');

    // Thickness: check commodity code + spec + wood name for explicit mm value.
    // Flooring/Blockboard products without an explicit thickness default to 18mm
    // (standard flooring panel); all others default to 12mm.
    const allNames = (commodity[i] || '') + ' ' + sp + ' ' + wt;
    const thickMatch = allNames.match(/(\d+(?:\.\d+)?)\s*mm/i);
    const isFlooring = /flooring|blockboard|blb\s/i.test(allNames);
    const thickMm = thickMatch ? parseFloat(thickMatch[1]) : (isFlooring ? 18 : 12);
    const thickM  = thickMm / 1000;

    // Only show price/unit for products explicitly measured in m3.
    // m2 products and threshold-based conversions are excluded (set to 0).
    let pricePerQty = 0;
    if (rawPpu > 0 && isM3) {
      pricePerQty = Math.round(rawPpu * 100) / 100;
    }

    const key = `${c}|${wt}|${sp}|${t}`;
    if (seen.has(key)) continue;
    seen.add(key);

    records.push([c, wt, sp, t, cifVal, dutyVal, dutiableVal, pricePerQty]);
  }

  return records;
}

// ── Build market data from CSV ────────────────────────────────────────────────
console.log('Parsing market CSV...');
const marketData = parseMarketCSV(path.join(ROOT, 'data/plywood_market_data_cleaned.csv'));
const marketArrayStr = JSON.stringify(marketData);
const withPrice = marketData.filter(r => r[7] > 0).length;
console.log(`  ${marketData.length} monthly records | ${withPrice} with price/unit data`);

// ── Load inflation multiplier CSV ─────────────────────────────────────────────
const inflationCsv = fs.readFileSync(path.join(ROOT, 'data/Inflation_multiplier_on_country_level.csv'), 'utf8');
const inflationRows = inflationCsv.trim().split('\n').slice(1); // skip header row
const inflationData = inflationRows.map(line => {
  const c = parseCSVLine(line);
  return [
    parseInt(c[0]) || 0,       // rank
    (c[1] || '').trim(),       // country
    parseFloat(c[2]) || 0,     // logPriceImpact (e.g. "5.50%" -> 5.50)
    parseFloat(c[3]) || 0,     // shippingImpact
    parseFloat(c[4]) || 0,     // productionImpact
    parseFloat(c[5]) || 0,     // overallEstIncrease
    (c[6] || '').replace(/^"|"$/g, '').trim() // explanation
  ];
});
const inflationArrayStr = JSON.stringify(inflationData);

// ── Inject into templates ─────────────────────────────────────────────────────
const templates = [
  'src/dashboard.html',
  'src/executive-summary.html',
  'src/inflation-risk.html',
];

const MARKET_PLACEHOLDER   = 'const MARKET_DATA = []; // <<MARKET_DATA>>';
const INFLATION_PLACEHOLDER = 'const INFLATION_DATA = []; // <<INFLATION_DATA>>';

const distDir = path.join(ROOT, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

let built = 0;
templates.forEach(tpl => {
  const tplPath = path.join(ROOT, tpl);
  if (!fs.existsSync(tplPath)) { console.warn(`SKIP (not found): ${tpl}`); return; }

  // Read template (must still have placeholders)
  const template = fs.readFileSync(tplPath, 'utf8');
  if (!template.includes(MARKET_PLACEHOLDER)) {
    console.warn(`WARN: ${tpl} missing MARKET_DATA placeholder — skipping`);
    return;
  }

  const injected = template
    .replace(MARKET_PLACEHOLDER,   `const MARKET_DATA = ${marketArrayStr};`)
    .replace(INFLATION_PLACEHOLDER, `const INFLATION_DATA = ${inflationArrayStr};`);

  // Write to dist/ (production-ready file)
  const outName = path.basename(tpl);
  const distPath = path.join(distDir, outName);
  fs.writeFileSync(distPath, injected, 'utf8');
  console.log(`[OK] dist/${outName} (${Math.round(injected.length / 1024)}KB)`);
  built++;
});

console.log(`\nDone. ${built} file(s) built → open dist/ in your browser.`);
