# Dixon Line Pulse — EMS Shopfloor Dashboard
React + Vite + Tailwind (frontend) · PHP + SQL Server (backend)

## Structure
```
backend/
  config/db.php        DB connection, params, JSON/gzip headers   <- creds yahin
  config/queries.php   ScanDiff CTE (cycle time via LAG), reliable-model filter
  lib/cube.php         ONE query -> day x hour x model stats; builders for every panel
  lib/rejections.php   false-scan (rejection) payload
  lib/cache.php        15-20s file cache (?refresh=1 bypass)
  api/                 range_overview, day_overview, hour_detail, companies, models, available_dates
frontend/src/
  api.js               fetch client (abort + 30s cache) + formatters
  hooks/useDashboard.js all state + data loading (2 requests, abort stale, debounce)
  components/          Sidebar, Header, FilterBar, charts, tables, drawer
  App.jsx              layout + pages only
sql/indexes.sql        RUN ONCE in SSMS (big speed-up)
```
## Setup
1. `backend/` -> XAMPP `htdocs/ems-dashboard/backend` (port 8080). Check `config/db.php`.
2. SSMS me `sql/indexes.sql` run karo.
3. `cd frontend && npm i && npm run dev`  (API base: `.env` -> VITE_API_BASE)
4. Build: `npm run build`, `dist/` serve karo.
## Why it is fast now
- Panel data: 2 API calls total (range + focus day), each = 1 SQL query (pehle 15+ calls, har ek 2-4 heavy queries).
- Date filters index-friendly; gzip; short server cache; stale responses aborted; min-qty debounced.

## Cycle & Takt Analysis (sidebar page)
- Takt = available time ÷ demand. Demand scan data me nahi hota, isliye **Set takt** se daalo (seconds ya target qty/day, plus model-wise override). Browser me save rehta hai.
- Working window default 09-21, lunch 13 excluded (settings me badal sakte ho).
- KPIs: produced, plan-till-now, achievement, avg cycle, cycle vs takt, demonstrated takt, utilization, projected end-of-day (live).
- Charts: cumulative actual vs plan, hour-wise cycle vs takt line.
- Auto review: idle hours, late start, post-lunch ramp-up, slow models, long stoppages, model-mix/changeover, rejection.
## Live updates
- Header me LIVE badge: latest day focus me ho to har 20 sec silently refresh (no flicker, tab hidden ho to skip). Pause button badge par click.
- Naya production day start hone par view khud aage badh jata hai.

## Outlier filter (cycle time)
- Cycle = gap between consecutive scans of the SAME model on the same day. Lunch / breakdown / changeover gaps would wreck the average, so they are filtered **from cycle stats only** (quantity never changes).
- Modes: **Auto** (gap > N x model's median, min 20 s floor — default N=3), **Fixed** (max seconds), **Off**. Plus `min gap` (double scans, default 1 s).
- Removed gaps are not hidden: shown as "gaps + stoppage minutes" (day and range), as the Stoppage KPI and in the review findings.
- Drawer scan list keeps RAW gaps (its own IQR / changeover filters still work).

## Verified calculations (backend/tests/cube_test.php — run `php backend/tests/cube_test.php`)
hourly qty / excluded / weighted avg (SUM÷COUNT, equals AVG over raw scans) / theoretical 3600÷qty; daily (range-level low-volume rule);
model-wise (min/max/avg, active hours, avg theoretical); matrix; outlier SQL for auto/fixed/off.
Frontend `utils/analysis.js`: available time, target = avail ÷ takt, achievement (vs plan-till-now when live), cycle÷takt,
demonstrated takt, utilization, cumulative plan, live projection.

## Analytics suite (sidebar)
| Page | What you get |
|---|---|
| Overview | KPI cards, daily trend, hourly chart (live) |
| Cycle & Takt | takt vs cycle, plan vs actual, projection, auto review |
| **Distribution** | cycle-time **histogram** (mean / P50 / P95 / takt lines), model-wise P10-P50-P90 spread, σ / CV / Cpk table, % within takt |
| **Pareto** | production by model (ABC), stoppage by model, time lost vs takt, rejection reasons / models / hours — click bar = filter model |
| **Model Analytics** | sortable scorecard (share, ABC, pcs/hr, cycle, CV, Cpk, rej %, stoppage, daily sparkline, health), volume-vs-cycle bubble chart, top-5 trend, model x hour heatmap + detailed table |
| **Trends & SPC** | daily qty + cycle, rejection + stoppage, I-chart control limits (daily and hourly), moving average, deviation vs average |
| Formulas | every formula + parameters in force (outlier, window, takt) |
Every chart card shows its formula (ƒ line) under the title.

## Export & print
- Header: **Excel** button = ek workbook (Info/parameters, Hourly, Daily, Models, Cycle stats by model, Histogram, Rejection sheets) — wahi numbers jo screen par hain.
- **Print** button = A4 landscape PDF-ready (sidebar/header hide, filters + charts rahenge).
- Ek page crash ho to sirf wahi page error dikhata hai (Retry button), baaki dashboard chalta rehta hai.

## Line idle vs gap time (important)
- **Gap time (per model)** = outlier gaps of one model. Ek lunch break har model ke gap me dikhta hai, isliye models ke gap time **jodna galat** hai.
- **Line idle** = kisi bhi selected model ka scan nahi hua aur gap outlier cap se bada + `idle ≥ N s` (default 60). Har stop **ek hi baar** (overlap nahi), hours me clip hota hai. Isi se KPI "Line idle", chips, trend aur analysis insight bante hain.
- Multiple parallel lines ek saath chalti hon to Company / Model filter se ek line alag karo (warna line idle kam dikhega).

## Responsive
- Phone: bottom tab bar (scrollable, safe-area), 2-column KPI grids, tables horizontally scroll with sticky first column, chart axes/labels compact.
- Tablet: sidebar icons-only (auto), 3–4 column KPIs. Desktop: full sidebar, 5 (xl) / 9 (2xl) column KPIs.
- Modals/drawers use dynamic viewport height.

## Verification — `run_all_tests.bat` (Windows) / `./run_all_tests.sh`
Sab tests offline hain: koi database connection nahi khulta, aur temporary files tests khud delete kar dete hain.
```
php backend/tests/cube_test.php            hourly / daily / model / matrix maths
php backend/tests/analytics_test.php       percentile, std, CV, histogram, pareto, rejection rates
php backend/tests/outlier_test.php         outlier rule (SQLite)
php backend/tests/live_test.php            live board engine
php backend/tests/scanid_test.php          ScanId binary search
php backend/tests/connect_test.php         connection policy (retry / pause rules)
php backend/tests/backup_test.php          offline backup fallback
php backend/tests/mirror_test.php          backup copy (mirror)
php backend/tests/snapshot_test.php        last good copy when a line is offline
php backend/tests/snapshot_newer_test.php  newer last read vs an old backup
php backend/tests/cache_backup_test.php    cache of answers built from a backup
php backend/tests/clock_test.php           line server clock check
php backend/tests/store_test.php           targets, shift and loss register store
php backend/tests/readonly_test.php        the live line databases are never written
php backend/tests/auth_test.php            login tokens, password rules, login throttle
php backend/tests/ui_test.php              screen setup + OLE formula settings
php backend/tests/ole_test.php             loss / quality / morning entries
php backend/tests/input_test.php           bad input gives HTTP 400
node frontend/tests/run-calc.mjs           every frontend calculation (OLE, targets, HPR, SPC, stats, exports ...)
```

## Server notes
- Time zone: the backend works in India time (`lib/clock.php`); this XAMPP's php.ini says Europe/Berlin, which used to
  write every saved time 4 h 30 min behind.
- Server errors (5xx) of the line pages are noted in the Windows temp folder of the Apache user:
  `ems_api_errors.log` (one line per kind of error per 10 minutes, kept under 256 KB). A line that cannot be reached
  answers with its last good copy (X-EMS-Backup "snapshot") instead of an error.
- Settings answers (model master, line settings, losses, OLE, screen setup) go gzip-compressed with an ETag
  (304 when nothing changed); the line pages' answers are gzip-compressed too.
- Backup facts of each line are kept 2 minutes (`ems_backup_info_line<N>.json` in the temp folder), so the local
  SQL Server is not asked on every request. The local backup copies are refreshed only by `backend/admin/backup_sync.bat`
  (not scheduled at the moment — last copy 27-10-2026).
- Not served to a browser: `backend/lib`, `backend/config`, `backend/data`, `sql`, the frontend sources / packages /
  build files, and folder listings. The app is `frontend/dist/`; the site root opens it.
