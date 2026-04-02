# US Plywood Market Intelligence System

Automated BI platform analyzing how war, energy disruptions, and trade policy
affect plywood export costs to the United States across 20 nations. Tracks Brent
crude, container freight rates, FX movements, electricity tariffs, and log prices
to build delivered-cost (CIF) estimates for both US East Coast (Savannah) and
West Coast (Long Beach).

Live dashboards: <https://norolansultan.github.io/Norolansultan-plywood-market-changes-usa/>

## Architecture

```
Free APIs (EIA, FRED, OXR, World Bank)
  |
  v
src/pipeline/fetch.js        Ingest live Brent, FX, EU gas prices
  |
  v
data/manual-overrides.json   Fill gaps where no free API exists
  |
  v
src/pipeline/proxy.js        Derive estimates (resin, log, electricity, freight)
  |                           from oil price delta and country-specific elasticities
  v
src/pipeline/calculate.js    Build dual-coast CIF, vulnerability scores,
  |                           sensitivity breakdowns per country
  v
src/pipeline/validate.js     Schema and arithmetic validation
  |
  v
scripts/run-pipeline.js      Orchestrator: fetch -> proxy -> calculate -> validate
  |
  v
data/pipeline-output.json    Structured JSON for all 20 countries
  |
  v
scripts/build.js             Inject data into HTML templates
  |
  v
dist/*.html                  Static dashboards served via GitHub Pages
```

## Dashboards

| File | Purpose |
|------|---------|
| `dashboard.html` | Core market analytics -- CIF breakdown, duty rates, historical trends |
| `executive-summary.html` | One-page management briefing with key risk indicators |
| `inflation-risk.html` | Supply chain risk heatmap and forward-cost projections |
| `sensitivity-dashboard.html` | Dual-coast CIF comparison with interactive oil price simulator |

## Data Pipeline

```bash
npm run pipeline              # Full: fetch APIs + calculate + validate
npm run pipeline:calculate    # Calculate only (no API keys needed, uses cached/overrides)
npm run pipeline:full         # Pipeline + rebuild dashboards
npm run build                 # Rebuild HTML from existing pipeline-output.json
```

The pipeline can run without API keys by using `--calculate-only` mode, which
derives all estimates from `data/manual-overrides.json` and cached fetch results.

## API Keys Setup

Copy `.env.example` to `.env` and fill in free API keys:

| Key | Source | Registration |
|-----|--------|-------------|
| `EIA_API_KEY` | Brent crude spot price | <https://www.eia.gov/opendata/register.php> |
| `FRED_API_KEY` | FX rates (CAD, EUR, BRL, SEK, PLN) | <https://fred.stlouisfed.org/docs/api/api_key.html> |
| `OXR_APP_ID` | FX rates (VND, IDR, MYR, CLP, THB, etc.) | <https://openexchangerates.org/signup/free> |

All APIs are free tier. No paid subscriptions required.

## Countries Covered (20)

**Alpha Asia (6):** Indonesia, Vietnam, Cambodia, Malaysia, Thailand, Taiwan

**Beta Americas (6):** Canada, Chile, Brazil, Uruguay, Ecuador, Paraguay

**Gamma EMEA (8):** Finland, Sweden, Germany, Poland, Italy, Spain, Belgium, Gabon

## Key Metrics

- **Dual-coast CIF** -- East Coast (Savannah) and West Coast (Long Beach) delivered cost per m3
- **Sensitivity per $10 Brent rise** -- component-level USD/m3 impact (freight, resin, log, electricity)
- **Vulnerability score** -- 0-10 weighted composite (freight 20%, resin 20%, electricity 20%, log 20%, labor 10%, FX 10%)
- **Breakeven oil price** -- price at which one origin becomes cheaper than another (e.g., Indonesia vs Canada)
- **Electricity cliff analysis** -- identifies countries where gas-to-power costs spike non-linearly (Germany, Italy, Cambodia)

## Project Structure

```
├── config/
│   ├── data-sources.json          # API endpoints, cadences, field mappings
│   ├── monitoring-config.json     # Alert thresholds for re-analysis triggers
│   └── swarm-output-schema.json   # Expected output format for analysis files
├── data/
│   ├── manual-overrides.json      # Freight rates, log prices, labor costs (manual entry)
│   ├── pipeline-output.json       # Calculated output for all 20 countries
│   ├── alpha_asia_analysis.json   # Swarm analysis: Asia region detail
│   ├── beta_americas_analysis.json
│   ├── gamma_emea_analysis.json
│   ├── sensitivity_analysis_2026.json
│   ├── Inflation_multiplier_on_country_level.csv
│   ├── plywood_market_data.csv    # Raw USITC import data (wide format)
│   └── raw/                       # Cached API fetch results
├── dist/                          # Built dashboards (GitHub Pages deployment)
├── scripts/
│   ├── build.js                   # HTML data injection
│   └── run-pipeline.js            # Pipeline orchestrator
├── specs/
│   ├── architecture.md            # System architecture document
│   └── USA_Market_*_agent.md      # Agent specifications per dashboard
└── src/
    ├── pipeline/
    │   ├── fetch.js               # API data ingestion (EIA, FRED, OXR, World Bank)
    │   ├── proxy.js               # Derived cost estimates from oil price elasticity
    │   ├── calculate.js           # CIF assembly, vulnerability scoring
    │   └── validate.js            # Schema and arithmetic checks
    ├── dashboard.html             # Template: core analytics
    ├── executive-summary.html     # Template: management briefing
    ├── inflation-risk.html        # Template: risk heatmap
    └── sensitivity-dashboard.html # Template: dual-coast simulator
```

## Tech Stack

- **Runtime:** Node.js (CommonJS)
- **Visualization:** Chart.js (CDN)
- **Frameworks:** None -- pure vanilla JavaScript and HTML
- **Hosting:** GitHub Pages (static)
- **APIs:** EIA, FRED, Open Exchange Rates, World Bank (all free tier)

## License

ISC
