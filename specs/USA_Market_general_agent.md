#Market analytics agent
A single-page HTML analytics dashboard for monitoring the USA plywood import market. The page is designed for data managers who need to track CIF (Cost, Insurance & Freight) values by country of origin, filtered by wood type, product specification, and time period.
Layout & Navigation
* Sticky top navigation bar with section links: Overview, Countries, Trends, and any additional sections
* Three main content sections accessible via the navigation
* The page is fully single-page (no routing); sections scroll into view
* Use as a data plywood_market_data_cleaned.csv
Global Filters (Persistent Across All Sections)
These controls sit at the top of the page and apply to all data visualizations simultaneously:
FilterTypeOptionsWood TypeDropdown / ToggleSoftwood, Hardwood, Tropical, MixedProduct SpecificationDropdownStructural, Marine, Decorative, Industrial, Form-plyDate Range — YearPicker2019 – 2025Date Range — MonthPickerJan – Dec (multi-select or range)
All charts and tables update reactively when any filter changes.
Left Panel — Top 20 Countries by CIF Value
* Ranked list of the top 20 exporting countries to the USA
* Each row shows:
   * Rank number
   * Country name + flag
   * CIF value (USD)
   * Trend indicator (↑ ↓ vs prior period)
* List re-ranks and re-values when filters are applied
* Rows are selectable to highlight the corresponding country in the right-side chart
Right Panel — Monthly CIF Chart (Top 10 Countries)
* Bar or line chart showing the top 10 countries
* X-axis: Months within the selected date range
* Y-axis: CIF value (USD)
* Each country is a distinct color series
* Chart updates dynamically with filter changes
* Tooltip on hover shows: country, month, exact CIF value
* Legend is clickable to show/hide individual countries
Data Behavior
* Filters are additive — all active filters apply together
* Resetting a filter returns the view to its unfiltered state
* Default state on load: current year, all months, all wood types, all specifications
Technical Notes
* Pure single-file HTML (HTML + CSS + JS, no external backend)
* Simulated/mock data is acceptable for the prototype
* Chart library: Chart.js (CDN)
* No frameworks required; vanilla JS is sufficient