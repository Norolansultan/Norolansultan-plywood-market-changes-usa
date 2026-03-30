# USA Plywood Import Market — Executive Summary Agent Spec

## Purpose
A single-page, print-optimized management briefing that auto-computes the most critical signals from USA plywood import data (HS 4412) and inflation risk data. Designed for senior managers and procurement directors who need a quick, actionable digest — no interactive filters, no configuration required, ready to print or save as PDF.

**Companion specs:**
- `USA_Market_general_agent.md` — full interactive operational dashboard
- `USA_Market_inflation_risk_agent.md` — detailed inflation and risk analysis

---

## Data Sources
- **Market data** — same inline JS array as core dashboard: `[country, woodType, productSpec, time, cif, duty, dutiable, pricePerQty]`
  - Source: `data/plywood_market_data_cleaned.csv` (monthly rows only)
- **Inflation multiplier data** — second inline JS array: `[rank, country, logPriceImpact, shippingImpact, productionImpact, overallEstIncrease, explanation]`
  - Source: `data/Inflation_multiplier_on_country_level.csv`
- All data computed at page load with no user interaction; no `fetch()`, no server, file:// safe
- Auto-detection of latest year and month in dataset; no hardcoded dates

---

## Layout
- No navigation bar — single uninterrupted page designed for printing
- Page header: company/report title ("USA Plywood Import Market — Executive Brief"), auto-detected reporting period (e.g. "January–December 2024"), and generation timestamp
- Print / Save as PDF button (top-right, hidden in print view)
- Footer: "Data source: US Customs HS 4412 import records. Inflation multipliers: Norolansultan internal estimates. For internal use only."
- Screen view: clean white background, max-width 960px centered
- Print view: full-width, no shadows, no background colors on cards (use borders instead)

---

## Section 1 — Market Snapshot
Three large KPI callout blocks, side by side (stacked on print):

| KPI | Computation | Label |
|-----|-------------|-------|
| **Total Import Value** | Sum of CIF, latest complete year | "Total CIF (Latest Year)" |
| **Year-over-Year Change** | (latest year CIF − prior year CIF) / prior year CIF × 100 | "vs. Prior Year" — green if positive, red if negative |
| **Top Supply Risk** | Country name with highest `overallEstIncrease` among top-5 CIF countries | "Highest Inflation Risk in Top 5 Suppliers" — shown with risk tier badge |

Below the three KPIs: a single sentence auto-generated from data, e.g.:
> *"[Country] remains the dominant supplier at [X]% of total CIF. Supply concentration (HHI: [score]) indicates a [Low / Moderate / High] dependency risk."*

---

## Section 2 — Top 5 Supplier Risk Table
A single combined table joining market data and inflation data. Auto-computed from the 5 countries with highest CIF in the latest complete year.

| Column | Source | Description |
|--------|--------|-------------|
| # | — | Rank by CIF |
| Country | Market data | Name + flag emoji |
| CIF Value | Market data | Latest year total, $US formatted |
| Market Share | Market data | Country CIF ÷ total CIF, % |
| Landed Cost | Market data | CIF + Duty, latest year |
| YoY Trend | Market data | ↑ / → / ↓ vs. prior year (same logic as core dashboard: >5% threshold) |
| Inflation Risk Tier | Inflation data | Low / Medium / High / Sanctions Premium badge |
| Est. Inflation Multiplier | Inflation data | Overall Est. Increase % (or "Unrated" if absent) |
| Projected Cost Impact | Computed | Latest year CIF × inflation multiplier = estimated additional spend |

- Table printed with full borders, no hover states
- Rows with High or Sanctions Premium tier have a subtle left border accent (red) in screen view; bold text in print view
- Total row at bottom: sum of CIF, Landed Cost, and Projected Cost Impact for these 5 countries

---

## Section 3 — Key Signals Narrative
A formatted block of auto-generated insight sentences, each backed by a specific computed value. Reads as a brief paragraph. Designed to be copied directly into a management email or presentation.

Template (JS injects the `[bracketed]` values at load time):

> **Supply Base:** The USA imported plywood from **[N] countries** in [Year], totaling **$[CIF]**. The top 3 suppliers — [Country1], [Country2], [Country3] — accounted for **[X]%** of total CIF value.
>
> **Cost Pressure:** Blended supply-side inflation exposure across active suppliers is estimated at **[W]%**, implying approximately **$[D]** in additional annual landed cost at current volumes if multipliers materialize.
>
> **Duty Burden:** Average effective duty rate across all imports was **[R]%**, contributing **$[Duty]** to total landed cost. [Country_highest_duty] carried the highest effective duty rate at **[max_R]%**.
>
> **Price Trend:** Average price per unit [increased / decreased / held stable] by **[P]%** year-over-year, from **$[P0]/unit** to **$[P1]/unit**.
>
> **Sourcing Risk:** [If HHI > 2500: "Supplier concentration is HIGH (HHI: [score]). Over-reliance on a small number of origins increases exposure to supply disruptions." / If 1500–2500: "Supplier concentration is MODERATE (HHI: [score]). Consider diversification to reduce disruption risk." / If < 1500: "Supplier base is well-diversified (HHI: [score])."]

- Each sentence is a separate `<p>` tag for clean print spacing
- Bold values use `<strong>` for emphasis in both screen and print
- Section heading: "Key Market Signals"

---

## Section 4 — Active Trade Alerts
Auto-computed alerts using the same trigger logic as the core dashboard's Section 5, but applied to the full latest-year dataset with no user-adjustable thresholds.

**Fixed thresholds for executive brief:**
- CIF Spike / Drop: >25% month-over-month
- Duty Rate Anomaly: effective rate >2× country average
- Price/Unit Spike: >20% year-over-year
- New Supplier Entry: appears after 3+ month absence
- Supplier Exit Risk: drops to zero after 6+ consecutive months of activity

**Display:** Bulleted list (not cards), grouped by severity:

```
⚠ Warnings
  • [Country] — CIF Spike: +[X]% in [Month YYYY] vs. prior month
  • [Country] — Duty Rate Anomaly: [R]% effective rate vs. [avg]% average in [Month YYYY]

ℹ Notices
  • [Country] — New supplier entry detected in [Month YYYY]
```

- Maximum 8 alerts shown; if more exist, append "and [N] additional alerts — see full dashboard"
- If no alerts: "No significant anomalies detected in the reporting period."
- Section heading: "Trade Alerts — [Month YYYY] Reporting Period"

---

## Technical Specification
- **Pure single-file HTML** — HTML + CSS + JS, no external dependencies except Chart.js CDN (used only if a mini chart is needed; can be omitted entirely)
- **No charts required** — this is a data-narrative document; avoid charts unless a simple sparkline adds clarity
- **Framework**: none — vanilla JS only
- **Data**: two inline JS arrays, parsed synchronously on load
- **Compatibility**: file:// in any modern browser
- **Print CSS**: `@media print` block that:
  - Hides the Print button
  - Removes box shadows and background colors
  - Expands all sections (no collapsed state)
  - Sets font to serif for readability
  - Enforces page-break-avoid on tables and alert blocks
- **No interactive controls**: no dropdowns, no sliders, no filters — all values auto-computed from latest year data
- **Performance**: all computations run once on DOMContentLoaded; no reactive re-computation needed
