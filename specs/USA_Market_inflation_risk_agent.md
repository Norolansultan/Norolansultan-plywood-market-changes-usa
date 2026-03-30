# USA Plywood Import Market — Inflation & Supply Risk Agent Spec

## Purpose
A standalone HTML analysis page quantifying supply chain cost risk and forward-price exposure for USA plywood imports (HS 4412). Designed for sourcing managers evaluating supplier portfolio resilience — identifies which countries carry the highest cost inflation risk due to fuel, shipping, and production pressures, and projects their impact on landed cost.

**Parent spec:** `USA_Market_general_agent.md` (shares same data embedding pattern)
**Related:** `USA_Market_executive_summary_agent.md` (consumes risk tiers computed here)

---

## Data Sources
- **Market data** — same inline JS array as core dashboard: `[country, woodType, productSpec, time, cif, duty, dutiable, pricePerQty]`
  - Source: `data/plywood_market_data_cleaned.csv` (monthly rows only)
- **Inflation multiplier data** — second inline JS array: `[rank, country, logPriceImpact, shippingImpact, productionImpact, overallEstIncrease, explanation]`
  - Source: `data/Inflation_multiplier_on_country_level.csv` (25 countries)
- Both arrays embedded directly in `<script>` block; no fetch, no server, file:// safe

---

## Risk Tier Definition
Computed from `overallEstIncrease` in the inflation dataset. Applied to every country present in either dataset.

| Tier | Threshold | Color | Label |
|------|-----------|-------|-------|
| Low | Overall < 6% | Green | Low Risk |
| Medium | 6% ≤ Overall < 9% | Amber | Medium Risk |
| High | Overall ≥ 9% | Red | High Risk |
| Sanctions Premium | Russia (hardcoded flag) | Dark Red | Sanctions Premium |

Countries in market data but absent from inflation dataset: show as "Unrated" (grey).

---

## Layout & Navigation
- Sticky top bar with section links: **Risk Overview**, **Country Scorecards**, **Inflation Breakdown**, **Price Projection**, **Sensitivity Map**, **Risk Rationale**
- Single-page scroll, no routing
- Header note: "Forward-cost projections apply inflation multipliers to latest 12-month average. Not a forecast — treat as directional risk signal."

---

## Section 1 — Risk Overview
Three KPI stat cards computed from the intersection of market data (latest complete year) and inflation data:

- **Portfolio Weighted Inflation Risk** — CIF-weighted average of `overallEstIncrease` across all active suppliers (countries with CIF > 0 in latest year). Formula: `Σ(CIF_i × overallIncrease_i) / Σ(CIF_i)`. Label: "Blended supply-side inflation exposure"
- **High-Risk Supplier Exposure** — sum of CIF from countries in High or Sanctions Premium tiers ÷ total CIF, shown as %. Label: "% of import value from high-risk origins"
- **Projected Additional Annual Cost** — total CIF latest year × portfolio weighted inflation rate. Shows the dollar amount at risk. Label: "Estimated additional landed cost at current volumes"

Below cards: a one-line alert banner if any top-3 CIF country is in the High or Sanctions Premium tier.

---

## Section 2 — Country Risk Scorecards
A responsive grid of cards, one per country in the inflation dataset (25 countries).

Each card shows:
- Country name + flag emoji
- Risk tier badge (color-coded per Risk Tier Definition)
- Overall Est. Increase % (large, prominent)
- Three sub-metrics in small text: Log Price Impact / Shipping Impact / Production Impact
- CIF value for latest year from market data (if country is active importer); "Not in top importers" if absent
- **Explanation excerpt** — first 100 characters of the Explanation field shown directly on the card in small italic text, no hover required; full text accessible via "See full rationale ↓" link that scrolls to the country's row in Section 6

Sort order: default by Overall Est. Increase descending (highest risk first). Toggle to sort by CIF value descending.

---

## Section 3 — Inflation Impact Breakdown
Horizontal grouped bar chart. One group per country (25 countries), sorted by Overall Est. Increase descending.

Each group has 3 bars:
- Log Price Impact % (blue)
- Shipping Impact % (orange)
- Production Impact % (green)

Overall Est. Increase shown as a small diamond marker on each group for reference.

- X-axis: percentage (0–30%)
- Y-axis: country names
- Tooltip on hover: all four values + Explanation text (truncated to 120 chars with "...")
- Toggle: show only countries active in market data (intersection view) vs. all 25

---

## Section 4 — Price-per-Unit Forward Projection
Table showing current pricing vs. inflation-adjusted projection for all countries present in both datasets.

| Column | Description |
|--------|-------------|
| Country | Name + flag + risk tier badge |
| Avg Price/Unit (Current) | 12-month weighted average from market data (latest year) |
| Inflation Multiplier | `overallEstIncrease` from inflation data |
| Projected Price/Unit | Current × (1 + multiplier) |
| Delta ($/unit) | Projected − Current |
| Annual CIF Volume | Total CIF value in latest year |
| Projected Cost Impact | Delta × (CIF volume / avg price per unit) — estimated extra spend |

- Default sort: Projected Cost Impact descending (highest dollar exposure first)
- Click column header to re-sort
- Rows colored by risk tier (subtle background tint)
- Bottom row: totals for Annual CIF Volume and Projected Cost Impact
- Note below table: "Delta assumes current import volumes are maintained. Multipliers reflect directional risk, not contracted price changes."

---

## Section 5 — Shipping vs. Production Sensitivity Map
Bubble/scatter chart showing the risk composition of each country's inflation exposure.

- X-axis: Shipping Impact % (0–30%)
- Y-axis: Production Impact % (0–15%)
- Bubble size: Overall Est. Increase % (proportional)
- Bubble color: Risk Tier (Green / Amber / Red / Dark Red)
- Label: country name, displayed next to bubble (offset to avoid overlap)
- Tooltip on hover: all four metrics + Explanation

**Quadrant lines** (dashed, configurable):
- Vertical at X = 10%: "Shipping Dominant" right of line
- Horizontal at Y = 8%: "Production Dominant" above line

**Interpretation guide** below chart:
- Top-right quadrant: "Dual Risk — both shipping and production costs under pressure"
- Top-left quadrant: "Production Risk — energy/resin costs main driver"
- Bottom-right quadrant: "Logistics Risk — freight and routing volatility main driver"
- Bottom-left quadrant: "Lower Exposure — relatively insulated from fuel/war pressures"

---

## Section 6 — Risk Rationale Table
A full-width readable table showing the plain-text explanation for every country's inflation estimate — the human-readable reasoning from the `Explanation` column of the inflation multiplier CSV. This is the primary place where the "why" behind each multiplier is visible without hovering.

| Column | Description |
|--------|-------------|
| # | Rank (sorted by Overall Est. Increase descending by default) |
| Country | Flag emoji + name |
| Risk Tier | Color-coded badge (Low / Medium / High / Sanctions Premium) |
| Overall % | `overallEstIncrease` — large, bold |
| Main Driver | Auto-derived label from the three component values: whichever of Log Price / Shipping / Production is highest becomes the label (e.g. "Shipping Dominant", "Production Dominant", "Balanced") |
| Explanation | Full explanation text from the CSV, displayed in full — no truncation, no tooltip |

**Formatting rules:**
- Explanation cell: left-aligned, normal weight, slightly muted color (not grey — readable at a glance)
- Row background tinted by risk tier (same tint as scorecards: light green / light amber / light red / dark red)
- Rows are not clickable — this is a reference table, not interactive
- Below the table: a note reading "Source: Norolansultan internal inflation estimates. Reflects fuel/war premium assumptions as of data preparation date."

**Sort options** (buttons above table):
- **By Risk (default)** — Overall % descending
- **By Country A–Z** — alphabetical
- **By Main Driver** — groups Shipping Dominant / Production Dominant / Balanced together

**Purpose note for the agent:** This section functions as the "methodology appendix" visible inline — a manager reading the dashboard can immediately see *why* Russia is flagged at 13.8% or *why* Spain is at 9% without needing a separate document.

---

## Technical Specification
- **Pure single-file HTML** — HTML + CSS + JS, no external dependencies except Chart.js CDN
- **Chart library**: Chart.js with scatter/bubble plugin (CDN link)
- **Framework**: none — vanilla JS only
- **Data**: two inline JS arrays, parsed synchronously on load
- **Compatibility**: file:// in any modern browser; shareable via email/Teams
- **No global filters** — this page always shows full dataset (inflation data is static, not time-filtered)
- **Responsive**: laptop and desktop widths; grid layout adapts column count
