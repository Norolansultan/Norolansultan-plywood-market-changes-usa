# USA Plywood Import Market — Analytics Dashboard Agent Spec

## Purpose
A single-page HTML analytics dashboard for monitoring USA plywood import market data (HS 4412). Designed for data managers tracking CIF value, calculated duty, and landed cost by country of origin, filtered by wood type, product specification, and time period.

---

## Data Source
- **Fully self-contained offline file** — no server, no CSV fetch, no backend required
- Embed all data directly as a minified JavaScript array inside the HTML `<script>` block
- Data format: `[country, woodType, productSpec, time, cif, duty, dutiable]` per row
- Source file: `data/plywood_market_data_cleaned.csv`
- Must work when opened directly from the file system (`file://`) or shared via email/Teams
- Monthly rows only — exclude annual summary rows to avoid double-counting

---

## Layout & Navigation
- Sticky top navigation bar with section links: **Overview**, **Countries**, **Trends**, **Landed Cost**, **Trade Alerts**
- Single-page, no routing — sections scroll into view on nav click
- Active nav link highlighted

---

## Global Filters (Persistent Across All Sections)
All filters apply simultaneously to every chart, table, and stat card.

| Filter | Type | Options |
|--------|------|---------|
| Wood Type | Dropdown | Derived from data (Coniferous, Tropical, Non-Coniferous, Bamboo, Birch, All Types, etc.) — reflect actual data values, not simplified mappings |
| Product Specification | Dropdown | Derived from data dynamically |
| Year | Dropdown | Derived from data; **default = latest year in dataset** (dynamic, not hardcoded) |
| Month | Multi-select | January – December |

- Reset button clears all filters back to defaults
- Default state on load: latest detected year, all months, all wood types, all specifications

---

## Section 1 — Overview
Stat cards showing aggregated totals for the current filter state:
- **Total CIF Value** ($US)
- **Total Calculated Duty** ($US)
- **Avg Duty Rate** (Duty ÷ Dutiable Value, %)
- **Total Full Landed Cost** (CIF + Duty, $US)
- **Active Exporting Countries** (count)
- **Top Country by CIF** (name + flag + value)

---

## Section 2 — Countries

### Left Panel — Top 20 Countries by CIF Value
- Ranked list, re-ranks reactively when filters change
- Each row shows: rank, flag, country name, CIF value ($US), YoY trend indicator
- **Trend indicator logic**: year-over-year comparison (same month(s), prior year)
  - ↑ = current period > same period prior year by >5%
  - ↓ = current period < same period prior year by >5%
  - → = within ±5%
  - Secondary: show month-over-month delta on hover tooltip
- **Row click = drill-down**: clicking a country filters the right panel to that country in isolation
  - Show a breadcrumb/pill (e.g. "Vietnam ×") with a clear button to reset to all countries
  - Do not merely highlight — repopulate all charts with that country's data

### Right Panel — Monthly CIF Chart
- Line chart: top 10 countries by CIF in the selected period (or single country if drilled down)
- X-axis: months within selected date range
- Y-axis: CIF value ($US)
- Each country = distinct color series
- Toggle button: **CIF** / **Duty** / **Landed Cost** — switches the Y metric shown
- Tooltip on hover: country, month, CIF, Duty, Landed Cost
- Clickable legend to show/hide individual countries

---

## Section 3 — Trends

### CIF Value by Wood Type
- Horizontal bar chart
- Aggregated across filtered period and countries

### CIF Value by Product Specification
- Doughnut chart
- Aggregated across filtered period and countries

### Monthly CIF + Duty Trend (All Countries)
- Grouped or stacked bar chart
- X-axis: months in selected range
- Two series: CIF Value (primary) and Calculated Duty (secondary)
- Tooltip shows both values per month

---

## Section 4 — Landed Cost
- Full Landed Cost = CIF + Calculated Duty
- Line chart: top 10 countries by Landed Cost over time
- Side-by-side table: country, CIF, duty, landed cost, duty rate (%), ranked by landed cost
- Shows how duty burden shifts relative ordering vs. CIF alone

---

## Section 5 — Trade Alerts
Flags unusual activity based on month-over-month changes within the filtered period.

**Alert triggers:**
- CIF spike: country's monthly CIF increased >25% vs. prior month
- CIF drop: country's monthly CIF decreased >25% vs. prior month
- Duty rate anomaly: effective duty rate (duty/dutiable) deviates >2× from that country's own average

**Display:**
- Alert cards showing: country flag + name, alert type, affected month, magnitude (e.g. "+42% MoM")
- Threshold configurable via a slider (default: 25%)
- If no alerts match current filters, show "No anomalies detected in this period"

---

## Technical Specification
- **Pure single-file HTML** — HTML + CSS + JS, no external dependencies except Chart.js CDN
- **Chart library**: Chart.js (CDN link)
- **Framework**: none — vanilla JS only
- **Data**: embedded inline as minified JS array, parsed synchronously on load (no `fetch()`)
- **Compatibility**: works opened directly via `file://` in any modern browser
- **Responsive**: adapts to laptop and desktop widths; mobile is secondary
- **Performance**: all aggregations done at filter-apply time using pre-built lookup maps (no `.find()` loops)
