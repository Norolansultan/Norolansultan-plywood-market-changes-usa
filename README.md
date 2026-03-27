US Plywood Market Intelligence System
A BI platform that automates collection and analysis of macroeconomic, trade, pricing, and regulatory data for the US plywood industry. Built with Power Query, Power Pivot, and DAX — designed to run on any corporate laptop with zero licensing costs.
Full design rationale and architecture details are in specs/.

Folder Structure
plywood-market-intel/
├── specs/                          # Design documents & strategic context
│   ├── design-document.docx        # Full architecture, decision framework, DAX examples
│   ├── portfolio-page.html         # Self-contained interactive overview (open in browser)
│   └── data-dictionary.md          # KPI definitions, source mappings, refresh schedules
│
├── src/                            # Implementation code
│   ├── power-query/                # M-language scripts for data acquisition
│   │   ├── fred-api.pq             # FRED REST API connector (housing, PPI, rates)
│   │   ├── usitc-imports.pq        # USITC DataWeb import volume pipeline
│   │   ├── exchange-rates.pq       # Daily FX rates (CAD, CLP, BRL, MXN, IDR)
│   │   └── scraper-canada-chile.pq # NRC and INFOR report parsers
│   │
│   ├── dax/                        # DAX measures and calculated columns
│   │   ├── trend-measures.dax      # YoY growth, rolling averages, seasonal decomposition
│   │   ├── pricing-engine.dax      # Currency conversion, RPI, competitive benchmarking
│   │   ├── scenario-models.dax     # Interest rate, currency shock, tariff impact models
│   │   └── health-score.dax        # Composite Market Health Score (0-100)
│   │
│   ├── data-quality/               # Governance and validation logic
│   │   ├── freshness-checks.pq     # Staleness detection per source
│   │   ├── validation-rules.pq     # Cross-validation and threshold alerts
│   │   └── audit-log.pq            # Refresh timestamps, row counts, pass/fail
│   │
│   └── dashboards/                 # Excel dashboard files
│       ├── executive-view.xlsx     # Market Health Score, KPI cards, 12-month outlook
│       ├── procurement-view.xlsx   # RPI by country, buy/hold/wait signals
│       └── strategic-view.xlsx     # Scenario tools, regional breakdowns, substitution analysis
│
└── README.md
Why specs/ and src/ are separated: The specs/ folder is the strategic layer — it documents what the system should do and why. The src/ folder is the implementation layer — how it does it. This separation means the design rationale survives independently of the code. If the platform migrates from Excel to Power BI or Tableau, specs/ stays intact and src/ gets rebuilt.

Prerequisites

Microsoft Excel 2016+ (or Microsoft 365) with Power Query and Power Pivot enabled
A free FRED API key — register at fred.stlouisfed.org/docs/api
Internet access for API calls and web scraping on refresh

etup

Clone the repo

bash   git clone https://github.com/your-username/plywood-market-intel.git

Configure the FRED API key
Open any .pq file in src/power-query/ and replace the placeholder YOUR_API_KEY with your FRED key. This is referenced by all FRED-connected queries.
Import Power Query scripts
In Excel, go to Data → Get Data → From Other Sources → Blank Query → Advanced Editor, then paste the contents of each .pq file. Repeat for all connectors in src/power-query/.
Load DAX measures
In Power Pivot, open the measure editor and add the measures from each .dax file in src/dax/. Start with pricing-engine.dax (other measures depend on it).
Set up data quality checks
Import the three scripts from src/data-quality/ as additional Power Query connections. These run on every refresh and write to the audit log table.
Refresh all connections
Data → Refresh All. First run pulls historical data and may take 2–3 minutes. Subsequent refreshes are incremental.


Usage
Daily workflow: Open any dashboard file in src/dashboards/ and hit Refresh All. The data quality layer validates every source automatically — stale or suspect data surfaces as amber/red indicators on the dashboard.
Scenario modeling: In the Strategic View (strategic-view.xlsx), use the slicer panel to select a scenario type (interest rate shock, currency move, or tariff change), set the input parameters, and the DAX models recalculate projected impacts across all affected KPIs.
Adding a new data source: Write the Power Query connector in src/power-query/, add corresponding DAX measures in src/dax/, then update specs/data-dictionary.md. Before adding any metric, verify it passes the Decision Framework test: if it doesn't connect to a specific business decision, it's deferred.

See specs/design-document.docx for the full architecture, decision framework, and implementation plan.
