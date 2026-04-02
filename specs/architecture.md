# Architecture: US Plywood Market Intelligence System

Version 1.0 -- 2026-04-02

## 1. System Context

The system is a static BI platform that estimates the delivered cost of plywood
to the United States from 20 exporting nations. It consumes free public APIs for
high-frequency signals (oil prices, FX rates), combines them with manually
maintained cost baselines (freight rates, log prices, labor costs), and produces
four interactive HTML dashboards served via GitHub Pages.

**Primary users:** procurement analysts and management reviewing competitive
positioning of plywood suppliers under changing energy and trade conditions.

**External systems:**

| System | Protocol | Data | Cadence |
|--------|----------|------|---------|
| EIA API v2 | REST/JSON | Brent crude spot (USD/bbl) | Daily |
| FRED API | REST/JSON | FX rates: CAD, EUR, BRL, SEK, PLN | Daily |
| Open Exchange Rates | REST/JSON | FX rates: VND, IDR, MYR, CLP, THB, TWD, KHR, UYU | Daily |
| World Bank Commodity API | REST/JSON | EU gas price (USD/MMBtu) | Monthly |
| USITC DataWeb | Manual CSV | Import volumes, CIF values, duties | Quarterly |

## 2. Data Flow

```
  EIA (Brent)  +  FRED (FX)  +  OXR (FX)  +  World Bank (gas)
                       |
                       v
              src/pipeline/fetch.js          cache --> data/raw/
                       |
          +------------+------------+
          v                         v
  data/raw/fetch_*.json    data/manual-overrides.json
          |                         |
          +------------+------------+
                       v
              src/pipeline/proxy.js          derive log, resin, elec, freight
                       |
                       v
              src/pipeline/calculate.js      dual-coast CIF, vulnerability, sensitivity
                       |
                       v
              src/pipeline/validate.js       completeness, arithmetic, staleness
                       |
                       v
              data/pipeline-output.json
                       |
                       v
              scripts/build.js               inject data into HTML templates
                       |
                       v
              dist/*.html                    GitHub Pages
```

## 3. Component Descriptions

### fetch.js -- Data Ingestion

Calls EIA, FRED, Open Exchange Rates, and World Bank APIs with exponential
backoff retry (1s, 4s, 16s). Writes timestamped results to `data/raw/` for
cache. Returns a structured object with `sources_ok` and `sources_failed` arrays
so the orchestrator can decide whether to proceed or fall back to cache.

### proxy.js -- Derived Estimates

Converts a single high-frequency signal (Brent crude price delta from baseline)
into per-country cost estimates for components that lack free real-time APIs.
Each proxy function uses country-specific elasticity coefficients stored in
`manual-overrides.json`. Also applies FX adjustments to domestic-currency cost
components using live or baseline exchange rates.

### calculate.js -- CIF Assembly and Scoring

Assembles full delivered cost (CIF) for each of 20 countries on two US coasts.
Computes vulnerability scores as a weighted composite (freight 20%, resin 20%,
electricity 20%, log price 20%, labor 10%, FX buffer 10%). Adds sensitivity
decomposition showing how each cost component responds to a $10 Brent rise.

### validate.js -- Output Validation

Checks pipeline output for: (a) completeness -- all 20 countries present,
(b) arithmetic -- CIF total equals sum of components within $0.50 tolerance,
(c) freight sanity -- freight/m3 within 5% of TEU rate / 23, (d) staleness --
warns when override data exceeds its expected refresh cadence.

### build.js -- Dashboard Generation

Parses the raw USITC CSV (wide format with multi-row headers), extracts CIF
values, duty rates, quantities, and computes price-per-unit. Reads inflation
multiplier CSV. Injects all data as inline JavaScript into four HTML template
files from `src/`, writing output to `dist/` for GitHub Pages deployment.

### run-pipeline.js -- Orchestrator

Parses CLI flags (`--fetch-only`, `--calculate-only`, `--dry-run`), runs fetch
then calculate in sequence, merges live data with manual overrides, runs
validation, and writes `pipeline-output.json`. Falls back to cached fetch data
when API calls fail.

## 4. Data Model

### manual-overrides.json

The primary configuration file for data that has no free API. Structure:

```json
{
  "brent_baseline_usd": 92,
  "freight_rates": {
    "indonesia_savannah": 2800,
    "indonesia_long_beach": 2200,
    "canada_qc_savannah": 1200,
    "canada_bc_long_beach": 800
  },
  "log_prices": {
    "indonesia": { "price_mid": 110, "oil_sensitivity_pct_per_10": 3.5 }
  },
  "electricity": {
    "germany": { "mid": 180, "oil_correlation": 0.7 }
  },
  "labor_costs": { "indonesia": 22, "germany": 65 },
  "resin_share_pct": { "indonesia": 18, "canada": 12 },
  "fx_baselines": { "ytd_change_vs_usd_pct": { "IDR": -2.1, "EUR": 1.5 } },
  "trade_duties": {
    "mfn_rate_pct": 8,
    "fta_zero_duty": ["canada", "chile"],
    "add_cvd_usd_per_m3": { "china": 45 }
  }
}
```

### pipeline-output.json

Per-country calculated output. Each country entry contains:

- `baseline_costs_usd_per_m3` -- log, resin, electricity, labor, freight (per coast)
- `cif.east_coast` / `cif.west_coast` -- fully assembled delivered cost
- `sensitivity_per_10_bbl` -- component-level delta for $10 Brent rise
- `vulnerability_score` -- 0-10 composite
- `fx_impact_usd_per_m3` -- FX adjustment on domestic cost portion

### Swarm Analysis Files

`alpha_asia_analysis.json`, `beta_americas_analysis.json`, `gamma_emea_analysis.json`
contain region-level narratives and per-country deep dives generated by agent
specifications in `specs/`. These feed the executive summary and inflation risk
dashboards.

## 5. Sensitivity (Proxy) Model

All proxy models use Brent crude delta from baseline as the primary driver.

| Component | Formula | Rationale |
|-----------|---------|-----------|
| Log price | `mid * (1 + sensitivity_pct/100 * delta/10)` | Logging uses diesel; 3-5% cost sensitivity per $10 Brent |
| Resin | `share% * $300 * (1 + 0.015 * delta)` | Phenol-formaldehyde is petrochemical; 1.5% per $1 Brent |
| Electricity | `mid_usd_mwh * 0.2 * (1 + oil_corr * delta/10)` | 200 kWh/m3 production; gas-linked in EU (correlation 0.5-0.8) |
| Freight | `(base_teu + sens_per_10 * delta/10) / 23` | Bunker fuel is 30-50% of TEU rate; 23 m3 per TEU |
| FX | `domestic_cost * fx_change_pct / 100` | Domestic cost portion (log + labor + elec) exposed to currency moves |

Constants: average COGS estimate = $300/m3, TEU capacity = 23 m3, port handling = $14/m3.

## 6. Dual-Coast CIF Model

The system calculates separate CIF for two US entry points:

**East Coast (Savannah, GA):**
- Default route for all 20 countries
- Freight keys: `{country}_savannah` (special: `canada_qc_savannah` for Quebec)
- Includes Panama Canal transit premium for Asian origins

**West Coast (Long Beach, CA):**
- Available only for countries with Pacific routing: Asia-6 (Indonesia, Vietnam,
  Cambodia, Malaysia, Thailand, Taiwan) and Americas (Canada BC, Chile, Brazil,
  Uruguay, Ecuador, Paraguay)
- EMEA countries (8) have no West Coast route (set to null)
- Freight keys: `{country}_long_beach` (special: `canada_bc_long_beach` for BC)

CIF formula (per coast):
```
CIF = log + resin + electricity + labor + freight/m3 + port_handling + duty
duty = (mfn_rate_pct / 100 * dutiable_value) + add_cvd_usd_per_m3
```

Countries with FTA zero duty (Canada, Chile) skip the MFN rate.

## 7. Monitoring and Triggers

Defined in `config/monitoring-config.json`. The system flags when re-analysis
is needed based on:

| Signal | Threshold | Priority |
|--------|-----------|----------|
| Brent crude | +/- $5 from baseline ($92) | HIGH |
| Baltic Dry Index | 10% change over 30 days | HIGH |
| EU gas price | +/- 8 EUR/MWh from baseline (48) | HIGH |
| FX rates | 5% move over 30 days for monitored currencies | MEDIUM |
| Log prices | Plantation fire, export ban, hurricane events | MEDIUM |
| Trade policy | New AD/CVD petition, tariff announcement | HIGH |

The pipeline does not auto-trigger. Monitoring thresholds are checked manually
or by scheduled CI runs comparing current API values to last analysis baseline.

## 8. Deployment

1. `npm run pipeline:full` fetches latest data and rebuilds dashboards
2. `scripts/build.js` injects data into HTML templates from `src/` and writes to `dist/`
3. `dist/` is committed and served via GitHub Pages
4. No server runtime required -- all dashboards are self-contained static HTML
   with Chart.js loaded from CDN
5. CSP headers are set via meta tags to restrict script sources

## 9. Known Limitations

- **FAOSTAT lag:** Log price data has 12-18 month publication delay. The system
  uses manual baseline estimates with oil-price elasticity proxies to bridge the gap.
- **No free freight API:** Container rates (TEU) require manual entry or a paid
  Freightos subscription. The `manual-overrides.json` freight rates must be
  updated by hand when significant shipping cost changes occur.
- **Baltic Dry Index removed:** The original World Bank endpoint pointed to iron
  ore prices, not BDI. The system now relies on manual TEU rate entries and
  Freightos FBX route indices as shipping cost proxies.
- **Electricity tariffs:** Updated semi-annually at best. The proxy model
  estimates mid-cycle changes using oil correlation coefficients, but large
  policy-driven tariff changes (e.g., German EEG surcharge) are not captured.
- **Single product category:** Covers plywood only. Does not model OSB, MDF, or
  LVL substitution effects, though the vulnerability framework could be extended.
- **No automated CI trigger:** Monitoring thresholds exist in config but are not
  wired to a GitHub Actions workflow. Re-analysis is manually initiated.
- **West Coast coverage:** EMEA countries have no West Coast route modeled.
  Suez-to-Long-Beach routing is theoretically possible but not commercially
  relevant for plywood at current freight rates.
