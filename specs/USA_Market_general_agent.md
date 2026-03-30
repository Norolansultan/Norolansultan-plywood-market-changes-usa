# USA Plywood Import Market — Core Analytics Dashboard Agent Spec

## Purpose
A single-page HTML analytics dashboard for monitoring USA plywood import market data (HS 4412). Designed for purchasing managers and trade compliance teams tracking CIF value, calculated duty, landed cost, and price-per-unit by country of origin, filtered by wood type, product specification, and time period.

**Companion specs:**
- `USA_Market_inflation_risk_agent.md` — supply chain risk and forward-cost projection view
- `USA_Market_executive_summary_agent.md` — printable one-page management briefing

---

## Data Sources
- **Fully self-contained offline file** — no server, no CSV fetch, no backend required
- **Market data** — embedded as a minified JS array: `[country, woodType, productSpec, time, cif, duty, dutiable, pricePerQty]` per row
  - `pricePerQty` = Price per Quantity unit ($/m³ or $/1000 board-feet as present in source data)
  - Source: `data/plywood_market_data_cleaned.csv`; monthly rows only — exclude annual summary rows
- **Inflation multiplier data** — embedded as a second inline JS array: `[country, logPriceImpact, shippingImpact, productionImpact, overallEstIncrease]`
  - Source: `data/Inflation_multiplier_on_country_level.csv` (25 countries)
  - Used for: inflation-aware stat cards, country hover tooltips, risk-adjusted ranking toggle
  - If a country is in the market data but absent from inflation data, treat its multiplier as `null` — do not impute
- Must work when opened directly from the file system (`file://`) or shared via email/Teams

---

## Layout & Navigation
- Sticky top navigation bar with section links: **Overview**, **Countries**, **Trends**, **Landed Cost**, **Trade Alerts**
- Single-page, no routing — sections scroll into view on nav click
- Active nav link highlighted
- Header badge showing: data as-of date (latest month in dataset) and total record count

---

## Global Filters (Persistent Across All Sections)
All filters apply simultaneously to every chart, table, and stat card.

| Filter | Type | Options |
|--------|------|---------|
| Wood Type | Dropdown | Derived from data (Coniferous, Tropical, Non-Coniferous, Bamboo, Birch, All Types, etc.) — reflect actual data values, not simplified mappings |
| Product Specification | Dropdown | Derived from data dynamically |
| Year | Dropdown | Derived from data; **default = latest year in dataset** (dynamic, not hardcoded) |
| Month | Multi-select | January – December |

**Quick Range presets** (button row, overrides Year + Month selectors):
- **Last 3M** — trailing 3 calendar months from latest data point
- **Last 6M** — trailing 6 months
- **Last 12M** — trailing 12 months (default on first load)
- **YTD** — January of the latest detected year through latest month
- Selecting a Quick Range updates the Year/Month dropdowns to reflect the equivalent selection
- YoY comparison for Quick Ranges: compare the same N-month window in the prior year (e.g. Last 6M vs. same 6M prior year) — not calendar year

- Reset button clears all filters back to defaults (Last 12M preset active)
- Filter state shown as a summary pill row (e.g. "Last 12M · Coniferous · All Specs")

---

## Section 1 — Overview
Stat cards showing aggregated totals for the current filter state (2 rows of cards):

**Row 1 — Value metrics:**
- **Total CIF Value** ($US, formatted with commas)
- **Total Calculated Duty** ($US)
- **Avg Duty Rate** (Duty ÷ Dutiable Value, %)
- **Total Full Landed Cost** (CIF + Duty, $US)

**Row 2 — Market intelligence:**
- **Active Exporting Countries** (count of countries with CIF > 0 in filtered period)
- **Top Country by CIF** (name + flag emoji + value + % of total)
- **Avg Price per Unit** (weighted average Price per Quantity across filtered rows, $/unit)
- **Supplier Concentration (HHI)** — Herfindahl-Hirschman Index computed from CIF market shares
  - Display as: score (0–10000) with label: Low (<1500), Moderate (1500–2500), High (>2500)
  - Tooltip explains: "High HHI = concentrated sourcing risk. Low HHI = diversified supply base."
- **Top 3 Share %** — combined CIF share of the top 3 countries (e.g. "63% of total CIF from top 3 suppliers")
  - Renders as a single bold percentage with a mini horizontal bar showing the 3-country breakdown
- **Portfolio Inflation Exposure** — CIF-weighted average of `overallEstIncrease` across active countries with inflation data
  - Formula: `Σ(CIF_i × multiplier_i) / Σ(CIF_i)` for countries with a non-null multiplier
  - Label: "Blended supply-side inflation risk"; shown as %; grey/amber/red based on value (< 6% / 6–9% / > 9%)
  - Tooltip: "Based on [N] of [M] active suppliers with inflation data"

---

## Section 2 — Countries

### Left Panel — Top 20 Countries by CIF Value
- Ranked list, re-ranks reactively when filters change
- Each row shows: rank, flag emoji, country name, CIF value ($US), market share %, share change YoY (±pp), YoY trend indicator
  - **Share Change YoY**: difference in market share percentage points vs. same period prior year (e.g. "+2.3pp" or "−1.1pp")
  - A country with flat CIF but positive share gain is displacing competitors — highlight in light blue
- **Trend indicator logic**: year-over-year comparison (same month(s) or equivalent window in prior year)
  - ↑ = current period > same period prior year by >5%
  - ↓ = current period < same period prior year by >5%
  - → = within ±5%
  - Hover tooltip: MoM delta, Share Change YoY (pp), and if inflation data exists for this country: inflation risk tier badge + overall multiplier %
- **Concentration warning**: if any single country's market share exceeds 30% (configurable), highlight that row with an amber left-border and a ⚠ concentration icon
- **Ranking toggle** (button above list): **By CIF** (default) / **By Projected Cost** — the Projected Cost ranking applies each country's inflation multiplier to their current landed cost and re-sorts accordingly; countries without inflation data are ranked last
- **Row click = drill-down**: clicking a country filters the right panel to that country in isolation
  - Show a breadcrumb/pill (e.g. "Vietnam ×") with a clear button to reset to all countries
  - Do not merely highlight — repopulate all charts with that country's data

### Right Panel — Monthly CIF Chart
- Line chart: top 10 countries by CIF in the selected period (or single country if drilled down)
- X-axis: months within selected date range
- Y-axis: CIF value ($US)
- Each country = distinct color series
- Toggle button: **CIF** / **Duty** / **Landed Cost** / **Price/Unit** — switches the Y metric shown
- Tooltip on hover: country, month, CIF, Duty, Landed Cost, Price/Unit
- Clickable legend to show/hide individual countries

---

## Section 3 — Trends

### CIF Value by Wood Type
- Horizontal bar chart
- Aggregated across filtered period and countries
- Each bar labeled with value and % of total

### CIF Value by Product Specification
- Doughnut chart
- Aggregated across filtered period and countries
- Legend shows top 8 specs; remaining grouped as "Other"

### Monthly CIF + Duty Trend (All Countries)
- Grouped or stacked bar chart
- X-axis: months in selected range
- Two series: CIF Value (primary) and Calculated Duty (secondary)
- Tooltip shows both values per month

### Price per Unit Trend
- Line chart: average Price/Unit per month across filtered countries
- X-axis: months in selected range
- Y-axis: $/unit
- Helps identify unit-cost inflation independent of volume changes

### Market Share Composition (Monthly)
- 100% stacked bar chart: each bar = one month, segments = top 8 countries by CIF, remainder = "Other"
- X-axis: months in selected range; Y-axis: 0–100%
- Makes trade diversion patterns immediately visible — one country growing while another shrinks within the same total
- Tooltip per segment: country name, month, absolute CIF value, share %

---

## Section 4 — Landed Cost

### Landed Cost Over Time
- Line chart: top 10 countries by Landed Cost over time
- Full Landed Cost = CIF + Calculated Duty

### Landed Cost Table
Side-by-side table ranked by landed cost (default). Columns:

| Column | Description |
|--------|-------------|
| Country | Flag + name |
| CIF Value | $US |
| Calculated Duty | $US |
| Landed Cost | CIF + Duty, $US |
| Duty Rate % | Effective rate (Duty ÷ Dutiable) |
| Duty Efficiency Rank | Rank 1 = lowest duty rate among countries supplying the same woodType + productSpec in the current filter; shown as "1 of N" |
| Avg Price/Unit | Weighted average $/unit for filtered period |
| Landed Cost/Unit | Landed Cost ÷ implied quantity (CIF ÷ pricePerQty); comparable across countries |

- Click any column header to re-sort
- **Countries with 0% Duty** quick-filter button (above table): shows only countries where calculated duty = 0 for the filtered product spec and wood type; identifies FTA-benefiting suppliers and zero-tariff opportunities

### Duty Rate Comparison Chart
- Horizontal bar chart: one bar per country, sorted by effective duty rate descending
- Median duty rate shown as a dashed vertical reference line
- Countries with rate > 1.5× the category median for the same woodType are flagged in amber
- Tooltip: country, effective duty rate, category median, deviation
- This makes duty disparity visible at a glance — the lowest-rate suppliers for the same product are direct substitution candidates

### Substitution Analysis Panel
Activated when a country is selected via drill-down in the Countries section.

Shows alternative suppliers for the same `woodType` + `productSpec` combination as the drilled-down country:
- Table of up to 5 alternatives ranked by Landed Cost per Unit ascending
- Columns: Country, Landed Cost/Unit, Duty Rate %, Active Supplier Count (Wood Type), Inflation Risk Tier (from multiplier data if available), Est. Multiplier %
- Label above table: "Alternative suppliers for [WoodType] — [ProductSpec]"
- Note: "Active Supplier Count" = number of months with CIF > 0 in the last 12 months — a proxy for supply capacity
- If fewer than 2 alternatives exist for the same woodType + productSpec, show: "No direct substitutes found for this combination in the current filter period"

---

## Section 5 — Trade Alerts
Flags unusual activity based on changes within the filtered period.

**Alert triggers:**

| Alert Type | Logic | Severity |
|------------|-------|----------|
| CIF Spike | Country monthly CIF increased >25% vs. prior month | Warning |
| CIF Drop | Country monthly CIF decreased >25% vs. prior month | Info |
| Duty Rate Anomaly (Own Avg) | Effective duty rate deviates >2× from that country's own historical average | Warning |
| Duty Rate Anomaly (Category) | Country's effective duty rate for a given woodType exceeds 1.5× the average rate for that woodType across all countries | Warning |
| Price/Unit Spike | Country's Price/Unit increased >20% vs. same period prior year | Warning |
| New Supplier Entry | Country appears in filtered period but had zero CIF in prior 3 months | Info |
| Supplier Exit Risk | Country had CIF > 0 every month for 6+ months, then drops to 0 | Warning |

**Display:**
- Alert cards showing: country flag + name, alert type, affected month, magnitude (e.g. "+42% MoM")
- Alerts grouped by severity: Warnings first, then Info
- Threshold configurable via a slider (default: 25% for CIF alerts, 20% for Price/Unit)
- If no alerts match current filters, show "No anomalies detected in this period"

---

## Technical Specification
- **Pure single-file HTML** — HTML + CSS + JS, no external dependencies except Chart.js CDN
- **Chart library**: Chart.js (CDN link)
- **Framework**: none — vanilla JS only
- **Data**: two inline JS arrays (`MARKET_DATA` and `INFLATION_DATA`), parsed synchronously on load (no `fetch()`)
- **Compatibility**: works opened directly via `file://` in any modern browser
- **Responsive**: adapts to laptop and desktop widths; mobile is secondary
- **Performance**: all aggregations done at filter-apply time using pre-built lookup maps (no `.find()` loops); inflation data joined to market data via a country-name lookup map built once on init
- **HHI computation**: `Σ(share_i²)` where `share_i = CIF_country_i / total_CIF`; scaled 0–10000 for display
- **Quick Range logic**: Last N months computed backward from `max(time)` in the dataset; YoY comparison for ranges always compares same-length window in prior period, not prior calendar year
- **Country name normalization**: build a lookup map normalizing both datasets to lowercase trimmed names on init to handle any minor name discrepancies between the two CSVs
