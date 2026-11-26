/**
 * Screen setup made by the admin (Setup page, saved on the server in backend/data/ui_settings.json):
 *   management.pages  which pages the management login sees, in which order, with which name
 *   management.home   the page management opens on
 *   management.oneView  what Plant overview shows (sections, KPI tiles, refresh, amber limit)
 *   admin.pages       which pages the admin sidebar shows (Setup is always there)
 *   brand             name and tagline (brand.color = the old sidebar colour, read once into theme.sidebar)
 *   theme             colours, line colours, fonts, text size (utils/themeEngine.js)
 * normalizeUi() mirrors backend/lib/ui.php (ui_clean), so the screens behave the same before the first save.
 */
import { Barcode,
  LayoutDashboard, Radio, Building2, Clock, LineChart, Target, ClipboardList, FileSpreadsheet, Boxes, Sparkles, Filter, ShieldAlert, TrendingUp, ListOrdered, ClipboardCheck, Crosshair, Gauge, Timer, Wrench, LayoutGrid, ShieldCheck, CalendarDays, BarChart3, Sunrise, PackageX, RotateCcw, CalendarRange, ListChecks, Layers,
} from 'lucide-react';
import { normalizeTheme } from './themeEngine';
import { normalizeRefresh } from './refreshConfig';
import { normalizeNotify, normalizeWelcome } from './notifyConfig';
import { capaHead } from './capaForm';

/** Every page the management login can be given. kind: main = all lines · line = one line at a time (Line 1–4 buttons). */
export const MGMT_CATALOG = [
  { id: 'dash', label: 'Dashboard', icon: LayoutGrid, color: 'text-sky-300', kind: 'main', about: 'Home page of the login: its lines today (production, OLE, stoppage, model running), OLE of the month, losses by department, RCAs pending.' },
  { id: 'overview', label: 'Plant overview', icon: LayoutDashboard, color: 'text-sky-300', kind: 'main', about: 'Whole plant on one screen: KPIs, the four lines, last 7 days, needs attention. Refreshes itself.' },
  { id: 'live', label: 'Live lines', icon: Radio, color: 'text-sky-300', kind: 'main', about: 'The four lines live: today, this hour vs target, cycle, hourly bars.' },
  { id: 'summary', label: 'All lines summary', icon: Building2, color: 'text-sky-300', kind: 'main', about: 'Period totals, target and loss per line, daily loss matrix, Excel.' },
  { id: 'hourly', label: 'Hourly analysis', icon: Clock, color: 'text-sky-300', kind: 'line', about: 'One line hour by hour against plan, loss register (read only), hourly matrix.' },
  { id: 'control', label: 'Control charts', icon: LineChart, color: 'text-sky-300', kind: 'main', about: 'Control charts and histograms per model (read only).' },
  { id: 'targets', label: 'Target methods', icon: Target, color: 'text-sky-300', kind: 'main', about: 'Method A, B, C and D (Model master) compared, CT summary Excel (no saving).' },
  { id: 'losses', label: 'Loss record', icon: ClipboardList, color: 'text-sky-300', kind: 'main', about: 'Loss reasons recorded by the lines, with filters and Excel.' },
  { id: 'models', label: 'Model analysis', icon: Boxes, color: 'text-sky-300', kind: 'line', about: 'Model-wise quantity, cycle and the three targets (no saving).' },
  { id: 'ai', label: 'AI analysis', icon: Sparkles, color: 'text-sky-300', kind: 'main', about: 'Automatic summary, alerts, forecast and questions for all lines.' },
  { id: 'explorer', label: 'Model explorer', icon: Filter, color: 'text-sky-300', kind: 'main', about: 'Filter and compare models across lines.' },
  { id: 'rejection', label: 'Rejections', icon: ShieldAlert, color: 'text-sky-300', kind: 'line', about: 'Rejections of one line by reason and model.' },
  { id: 'trends', label: 'Daily trends & SPC', icon: TrendingUp, color: 'text-sky-300', kind: 'line', about: 'Daily trends and SPC of one line.' },
  { id: 'pareto', label: 'Pareto', icon: ListOrdered, color: 'text-sky-300', kind: 'line', about: 'Pareto of models and losses of one line.' },
  { id: 'ole', label: 'OLE dashboard', icon: Gauge, color: 'text-sky-300', kind: 'main', about: 'OLE dashboard of the login\'s lines: availability × performance × quality per hour, stoppage / rejection / rework with reason and responsible department.' },
  { id: 'lqentry', label: 'Loss & quality', icon: ClipboardList, color: 'text-sky-300', kind: 'main', about: 'One page for both: the lost minutes and the rejection / rework of every hour.' },
  { id: 'qdash', label: 'Quality dashboard', icon: ClipboardCheck, color: 'text-sky-300', kind: 'main', about: 'One page for quality: pieces made against rework, rework % and PPM, dismantled, FPY / RTY against target, RCA pending, the trend, each line, top defects, category, stations, models and hour of the day, with Excel.' },
  { id: 'rwkdash', label: 'Rework dashboard', icon: RotateCcw, color: 'text-sky-300', kind: 'main', about: 'The hourly rework sheet (IPQC) as a dashboard: pieces, ₹ loss, dismantled, hour of the day, stage, category, top defects, model, line, and the sheet in the plant layout.' },
  { id: 'rcadash', label: 'RCA dashboard', icon: Wrench, color: 'text-sky-300', kind: 'main', about: 'How the departments close their RCAs: pending, submitted, closed, overdue, closure %, days to close, ageing and the oldest open RCAs.' },
  { id: 'kpidash', label: 'KPI dashboard', icon: LayoutGrid, color: 'text-sky-300', kind: 'main', about: 'The SAWM KPI report Summary as a dashboard: production plan vs actual, UPH, UPPH, RTY, manpower line wise, OT, OS&D, WO, TRC / WIP, day-wise trend and summary.' },
  { id: 'reports', label: 'Reports', icon: FileSpreadsheet, color: 'text-sky-300', kind: 'main', about: 'Excel reports: HPR, SAWM KPI report, OLE and loss reports.' },
  { id: 'serials', label: 'Serial & carton', icon: Barcode, color: 'text-sky-300', kind: 'main', about: 'Every piece of the day with its serial and carton number, by line and model; live today; Excel download.' },
  { id: 'custprod', label: 'Customer production', icon: Building2, color: 'text-sky-300', kind: 'main', about: 'Pieces made per customer and model, day by day, with the lines\' day totals — the plant\'s Customer wise production workbook as a dashboard, and its Excel (Plan / Backlog to fill).' },
  { id: 'oleentry', label: 'Loss entry', icon: ClipboardList, color: 'text-sky-300', kind: 'main', about: 'Lost minutes of every hour with model and reason, and the target of the hour (only logins allowed to fill).' },
  { id: 'qentry', label: 'Quality entry', icon: ClipboardList, color: 'text-amber-300', kind: 'main', about: 'Rejection and rework of every hour with station, model and defect (only logins allowed to fill).' },
  { id: 'rca', label: 'RCA Entry', icon: Wrench, color: 'text-sky-300', kind: 'main', about: 'Every loss goes to the department of its reason; the department writes and submits the RCA.' },
  { id: 'quality', label: 'FPY / RTY yield', icon: ShieldCheck, color: 'text-sky-300', kind: 'main', about: 'First-pass yield and rolled throughput yield of the login\'s lines: by station (LQC, FQC, leak test …), line, model and defect. Off by default — turn it on for the logins that should see it.' },
  { id: 'linetargets', label: 'Line target method', icon: Crosshair, color: 'text-sky-300', kind: 'main', about: 'Which target method each line uses (A / B / C), its effect on target and loss (read only).' },
  { id: 'targetcheck', label: 'Target rule & check', icon: ClipboardCheck, color: 'text-sky-300', kind: 'main', about: 'How every target cycle is worked out (the method of each line + allowance), with self-checks (read only).' },
  { id: 'oleview', label: 'Plant Efficiency', icon: Gauge, color: 'text-sky-300', kind: 'main', about: 'Standard management view like the Dixon MES: OLE gauge, availability / performance / quality with their figures, OLE trend with the 85 % benchmark, top loss reasons, departments and lines.' },
  { id: 'lossan', label: 'Loss analysis', icon: BarChart3, color: 'text-sky-300', kind: 'main', about: 'Department-wise loss and reason Pareto (loss minutes, share, cumulative %) of the login\'s lines; click a department for its reasons.' },
  { id: 'rejan', label: 'Rejection analysis', icon: PackageX, color: 'text-sky-300', kind: 'main', about: 'Rejections written on the Loss entry page as a drill-down: defect Pareto, station, line, model, hour, heat map, every entry with its RCA — with the rejection rate (% and PPM of the pieces made) and Excel.' },
  { id: 'rwkan', label: 'Rework analysis', icon: RotateCcw, color: 'text-sky-300', kind: 'main', about: 'Rework written on the Loss entry page as a drill-down: defect Pareto, station, line, model, hour, heat map, every entry with its RCA — with the rework rate (% and PPM of the pieces made) and Excel.' },
  { id: 'kpientry', label: 'KPI entry', icon: ClipboardCheck, color: 'text-sky-300', kind: 'main', about: 'The SAWM KPI report numbers the scans cannot give: OS&D, BOM value, OT man-hours, open WO, TRC / WIP lying, dismantle.' },
  { id: 'daily', label: 'Morning entry', icon: Sunrise, color: 'text-sky-300', kind: 'main', about: 'Supervisor, every morning: manpower, start, lunch, tea breaks and close time of the line — that day\'s targets, OLE and HPR use it.' },
  { id: 'adash', label: 'Availability dashboard', icon: Timer, color: 'text-sky-300', kind: 'main', about: 'One page for Availability: planned, run and idle time, stops, line × day, day by day against the target, line by line, idle reasons, departments, models and the hour of the day.' },
  { id: 'pdash', label: 'Performance dashboard', icon: TrendingUp, color: 'text-sky-300', kind: 'main', about: 'One page for Performance: plan vs actual pieces, cycle time vs std, speed loss, line × day, day by day against the target, line by line, every model and the hour of the day.' },
  { id: 'olea', label: 'Availability', icon: Timer, color: 'text-sky-300', kind: 'main', about: 'Deep page of Availability (as the MES): idle time KPIs, reasons Pareto, share by department, when in the day, lines and every reason.' },
  { id: 'olep', label: 'Performance', icon: TrendingUp, color: 'text-sky-300', kind: 'main', about: 'Deep page of Performance (as the MES): lines vs target, Pareto of time lost by model, when it runs slow, models slower than standard.' },
  { id: 'oleq', label: 'OLE quality', icon: ShieldCheck, color: 'text-sky-300', kind: 'main', about: 'Deep page of Quality (as the MES): rejection KPIs, reasons Pareto and share, when it comes, by station, line and model.' },
  { id: 'olecal', label: 'OLE calendar', icon: CalendarDays, color: 'text-sky-300', kind: 'main', about: 'One month as a calendar: the OLE of every day (green 85 % and above, amber 60–85 %, red below) with A · P · Q and pieces; a click on a day shows it line by line.' },
  { id: 'entrydash', label: 'Entry dashboard', icon: ListChecks, color: 'text-sky-300', kind: 'main', about: 'What the lines wrote on Loss entry and Quality entry: loss minutes, rejection and rework pieces by reason, department and line, every entry with who filled it and when, Excel.' },
  { id: 'oledrill', label: 'OLE drill-down', icon: Layers, color: 'text-sky-300', kind: 'main', about: 'OLE of a period, then Availability, Performance or Quality: line → day → hour → model → what was written, worst first, with the reasons at every step.' },
  { id: 'olemonth', label: 'Monthly OLE', icon: CalendarRange, color: 'text-sky-300', kind: 'main', about: 'One year month by month: OLE per month as bars, OLE · A · P · Q as lines, line-wise OLE, lost time, pieces made and rejection % per month, with the month table.' },
];
// 23-11-2026: no separate rejection any more (a piece is reworked or dismantled) — these pages are left out everywhere
export const RETIRED_PAGES = new Set(['rejan', 'rejection']);
export const MGMT_DEFAULT_ON = ['dash', 'overview', 'live', 'summary', 'hourly', 'control', 'targets', 'losses', 'ole', 'oleentry', 'qentry', 'rca', 'lossan', 'rejan', 'rwkan', 'qdash', 'oleview', 'olea', 'olep', 'oleq', 'olecal', 'olemonth', 'oledrill', 'rwkdash', 'rcadash', 'kpidash', 'custprod', 'quality', 'entrydash', 'reports', 'adash', 'pdash'];
/** 24-11-2026: the review pages of management, switched on once for a Setup saved before (mgmtV < 2) — mirrors UI_MGMT_REVIEW in ui.php */
export const MGMT_REVIEW = ['dash', 'overview', 'oleview', 'olea', 'olep', 'oleq', 'olecal', 'olemonth', 'oledrill', 'qdash', 'rwkdash', 'rcadash', 'kpidash', 'custprod', 'lossan', 'rejan', 'rwkan', 'quality', 'entrydash', 'reports', 'adash', 'pdash'];
export const ADMIN_IDS = ['overview', 'dash', 'oleview', 'olea', 'olep', 'oleq', 'olecal', 'olemonth', 'oledrill', 'ole', 'daily', 'oleentry', 'qentry', 'rca', 'entrydash', 'lossan', 'rejan', 'rwkan', 'quality', 'master', 'linetargets', 'targetcheck', 'ai', 'targets', 'methodplan', 'analysis', 'distribution', 'pareto', 'models', 'explorer', 'trends', 'control', 'stdcycle', 'hourly', 'rejection', 'lqentry', 'kpidash', 'rcadash', 'rwkdash', 'kpientry', 'reports', 'repcmp', 'formulas', 'serials', 'custprod', 'qdash', 'universe', 'capa', 'adash', 'pdash'];
export const KPI_LIST = [
  ['produced', 'Produced'], ['plan', 'Plan so far'], ['achievement', 'Achievement %'], ['short', 'Short pieces'], ['lost', 'Lost time'], ['running', 'Lines running / ₹ loss'],
];
/** Old sidebar colours (before Setup → Theme); a saved non-navy choice becomes the theme's sidebar colour. */
export const BRAND_COLORS = { navy: '#0B2545', charcoal: '#1F2937', teal: '#0F3D3E', maroon: '#4A1520', indigo: '#1E1B4B' };

const text = (v, max, def) => { const s = String(v ?? '').replace(/[\u0000-\u001F\u007F<>]/g, '').trim(); return s ? s.slice(0, max) : def; };

function pages(list, ids, defaultOn, missingOn) {
  const out = []; const seen = new Set();
  for (const p of Array.isArray(list) ? list : []) {
    const id = String(p?.id ?? '');
    if (!ids.includes(id) || seen.has(id)) continue;
    seen.add(id);
    const row = { id, on: !!p.on };
    const label = p.label != null ? text(p.label, 40, '') : '';
    if (label) row.label = label;
    out.push(row);
  }
  // a page that is newer than the saved list (e.g. OLE, Loss entry, RCA) starts as its default, not hidden
  for (const id of ids) if (!seen.has(id)) out.push({ id, on: Array.isArray(list) ? (missingOn || defaultOn.includes(id)) : defaultOn.includes(id) });
  return out;
}

/** Target rule (mirrors ui_rule in backend/lib/ui.php): Method A from `from`, valid gaps low..cap s (below `low` and above `cap`
 *  eliminated), target = A + add s, at least `min` valid gaps. */
// targets from the data of 01-08-2026 to 31-10-2026 (a fixed window): new months do not move them; to: '' = up to today
export const RULE_DEFAULT = { from: '2026-08-01', to: '2026-10-31', add: 3, cap: 22, min: 20, low: 1 };
/** Per line (Line target method page): which method sets the target — A most common, B % rule, C average — plus allowance s and B's %. */
export const TARGET_METHODS = ['A', 'B', 'C', 'D'];   // D = cycle time of the Model master
export const RULE_LINES = ['1', '2', '3', '4'];
export function normalizeRule(r) {
  const x = r && typeof r === 'object' ? r : {};
  const okDate = typeof x.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.from)
    && new Date(Number(x.from.slice(0, 4)), Number(x.from.slice(5, 7)) - 1, Number(x.from.slice(8, 10))).getDate() === Number(x.from.slice(8, 10));
  const num = (k, lo, hi) => { const n = Number(x[k]); return x[k] != null && x[k] !== '' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : RULE_DEFAULT[k]; };
  const add = num('add', 0, 30);
  const lines = {};
  for (const l of RULE_LINES) {
    const c = x.lines && typeof x.lines === 'object' ? (x.lines[l] || {}) : {};
    const method = TARGET_METHODS.includes(c.method) ? c.method : 'A';
    const n = (v, lo, hi, d) => { const k = Number(v); return v != null && v !== '' && Number.isFinite(k) ? Math.max(lo, Math.min(hi, Math.round(k * 10) / 10)) : d; };
    lines[l] = { method, add: n(c.add, 0, 30, method === 'A' ? add : 0), pct: Math.round(n(c.pct, 50, 95, 70)) };
  }
  const cap = num('cap', 5, 120);
  const lw = Number(x.low);
  let low = x.low != null && x.low !== '' && Number.isFinite(lw) ? Math.max(0, Math.min(60, Math.round(lw * 10) / 10)) : RULE_DEFAULT.low;
  if (low >= cap) low = Math.max(0, cap - 1);
  const from = okDate ? x.from : RULE_DEFAULT.from;
  // end of the data window: a real date not before the start, '' = up to today; missing = the default (31-10-2026)
  const toOk = typeof x.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.to)
    && new Date(Number(x.to.slice(0, 4)), Number(x.to.slice(5, 7)) - 1, Number(x.to.slice(8, 10))).getDate() === Number(x.to.slice(8, 10));
  const to = x.to === '' ? '' : toOk && x.to >= from ? x.to : (RULE_DEFAULT.to >= from ? RULE_DEFAULT.to : '');
  return { from, to, add, cap, min: num('min', 5, 500), low, lines, plan: normalizePlan(x.plan, add) };
}

/**
 * 20-11-2026: target method by date. plan = [{ line, from, method, add, pct, note }] — from that day on the line uses that
 * method (until the next change of the same line); the days before the first change use the line's starting method
 * (rule.lines). One change per line and day, at most 60, sorted by line and date (mirrors ui_plan in backend/lib/ui.php).
 */
export const PLAN_MAX = 60;
const realDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && new Date(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10))).getDate() === Number(v.slice(8, 10));
export function normalizePlan(list, add = RULE_DEFAULT.add) {
  const by = new Map();
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || typeof p !== 'object') continue;
    const line = String(p.line ?? '');
    if (!RULE_LINES.includes(line) || !realDate(p.from) || !TARGET_METHODS.includes(p.method)) continue;
    const n = (v, lo, hi, d) => { const k = Number(v); return v != null && v !== '' && Number.isFinite(k) ? Math.max(lo, Math.min(hi, Math.round(k * 10) / 10)) : d; };
    const note = String(p.note ?? '').replace(/[<>]/g, '').trim().slice(0, 80);
    const who = String(p.by ?? '').replace(/[<>]/g, '').trim().slice(0, 40);
    const at = typeof p.at === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(p.at) ? p.at : '';
    by.set(`${line}|${p.from}`, { line, from: p.from, method: p.method, add: n(p.add, 0, 30, p.method === 'A' ? add : 0), pct: Math.round(n(p.pct, 50, 95, 70)), ...(note ? { note } : {}), ...(who ? { by: who } : {}), ...(at ? { at } : {}) });
  }
  return [...by.values()].sort((a, b) => a.line.localeCompare(b.line) || a.from.localeCompare(b.from)).slice(0, PLAN_MAX);
}
/** the data window of the targets: [start, end] (end = the rule's end date, or today when it is later / not set) */
export const ruleEnd = (r, today) => (r?.to && r.to < today ? r.to : today);
export const ruleStart = (r, today) => { const e = ruleEnd(r, today); return r.from <= e ? r.from : e; };
/** Same rule → same key (targets are worked out again when it changes). */
export const ruleKeyOf = (r) => `${r.from}|${r.to ?? ''}|${r.add}|${r.cap}|${r.min}|${r.low ?? 1}|${RULE_LINES.map((l) => { const c = r.lines?.[l] || {}; return `${c.method}${c.add}/${c.pct}`; }).join(',')}${(r.plan || []).length ? `|${r.plan.map((p) => `${p.line}@${p.from}:${p.method}${p.add}/${p.pct}`).join(',')}` : ''}`;

/** HPR report: Loss (₹) = rate × manpower × I/T hours, hours from otFrom on × otX (mirrors ui_hpr in backend/lib/ui.php). */
export const HPR_DEFAULT = { rate: 65, otFrom: '18:00', otX: 2 };
export function normalizeHpr(h) {
  const x = h && typeof h === 'object' ? h : {};
  const num = (v, lo, hi, d) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? Math.round(Math.max(lo, Math.min(hi, n)) * 100) / 100 : d; };
  return { rate: num(x.rate, 0, 10000, HPR_DEFAULT.rate), otFrom: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x.otFrom || '')) ? x.otFrom : HPR_DEFAULT.otFrom, otX: num(x.otX, 1, 5, HPR_DEFAULT.otX) };
}
/** OLE formulas chosen by the admin (mirrors ui_ole in backend/lib/ui.php); the first value of each is the standard. */
export const OLE_DEFAULT = { pMode: 'run', aEnd: 'lastScan', aLoss: 'all', lossIn: 'avail', aIdle: 'run', pBase: 'run', pCap: true, pNoStd: 'skip', qMode: 'rejRework', qV: 2, qStations: 'all', mpSync: false, mpUse: 'open', mpUp: false, stdMp: {}, good: 95, watch: 85, fewPcs: 5, timeFmt: 'h1', goodA: 95, watchA: 85, goodP: 95, watchP: 85, goodQ: 95, watchQ: 85, bench: 2 };
export function normalizeOle(o) {
  const x = o && typeof o === 'object' ? o : {};
  const pick = (k, ok) => (ok.includes(x[k]) ? x[k] : ok[0]);
  const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return v !== '' && v != null && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  // 19-11-2026 (bench 2): OLE good from 95 % · watch 85 %, Performance at most 100 % — a setup saved before gets these once
  const old = !(Number(x.bench) >= 2);
  const good = old ? 95 : int(x.good, 50, 100, 95);
  const stdMp = {};
  for (const l of ['1', '2', '3', '4']) { const n = int(x.stdMp?.[l], 0, 1000, 0); if (n > 0) stdMp[l] = n; }
  return { aEnd: pick('aEnd', ['lastScan', 'shiftEnd']), aLoss: pick('aLoss', ['all', 'unplanned']), lossIn: pick('lossIn', ['avail', 'perf']), aIdle: pick('aIdle', ['run', 'idle']),
    pMode: pick('pMode', ['run', 'plan', 'std']),   // 26-11-2026: Performance = Actual ÷ run-time target · ÷ shift plan · std time ÷ run time
    pBase: pick('pBase', ['run', 'planned']), pCap: old ? true : !!x.pCap, pNoStd: pick('pNoStd', ['skip', 'avg']), qMode: Number(x.qV) >= 2 ? pick('qMode', ['rejRework', 'rej']) : 'rejRework', qV: 2,   // 25-11-2026: Good = Actual − Rework (no rejection since 23-11); mirrors ui_ole
    qStations: pick('qStations', ['all', 'final']),
    mpSync: !!x.mpSync, mpUse: pick('mpUse', ['open', 'avg']), mpUp: !!x.mpUp, stdMp, good, watch: old ? Math.min(85, good) : int(x.watch, 0, good, Math.min(85, good)), ...apqBench(x, int), fewPcs: int(x.fewPcs, 1, 100, 5), timeFmt: pick('timeFmt', ['h1', 'hm']), bench: 2 };
}
/** A · P · Q benchmarks (19-11-2026): good from 95 %, watch from 85 % unless the admin sets them (Setup → OLE formulas) */
function apqBench(x, int) {
  const o = {};
  for (const k of ['A', 'P', 'Q']) { const g = int(x[`good${k}`], 50, 100, 95); o[`good${k}`] = g; o[`watch${k}`] = int(x[`watch${k}`], 0, g, Math.min(85, g)); }
  return o;
}
/**
 * Menu folders (19-11-2026, as the C8 MES): every page sits in one folder; the admin names the folders, sets their order
 * and moves a page from one folder to another (Setup → Menu folders). Same folders for every login; what each login
 * sees stays with Management view / Admin view.
 */
export const FOLDER_DEFAULT = [
  { name: 'Overview', ids: ['dash', 'overview', 'live', 'summary', 'oleview', 'olecal', 'olemonth', 'oledrill', 'ole'] },
  // 20-11-2026: the entry pages in their own folder "Entry" (not under Availability)
  { name: 'Entry', ids: ['daily', 'lqentry', 'oleentry', 'qentry', 'kpientry', 'entrydash'] },
  { name: 'Availability', ids: ['adash', 'olea', 'lossan', 'losses'] },
  { name: 'Performance', ids: ['pdash', 'olep', 'hourly', 'analysis', 'distribution', 'stdcycle', 'control', 'trends'] },
  { name: 'Quality', ids: ['qdash', 'oleq', 'rca', 'capa', 'rcadash', 'rwkdash', 'rejan', 'rwkan', 'quality', 'rejection'] },
  { name: 'Analysis', ids: ['ai', 'pareto', 'models', 'explorer', 'universe'] },
  { name: 'Targets', ids: ['master', 'linetargets', 'targetcheck', 'targets', 'methodplan'] },
  { name: 'Reports', ids: ['kpidash', 'reports', 'custprod', 'serials', 'repcmp', 'formulas', 'setup'] },
];
export const FOLDER_IDS = [...new Set(FOLDER_DEFAULT.flatMap((f) => f.ids))];
const ENTRY_IDS = ['daily', 'lqentry', 'oleentry', 'qentry', 'kpientry', 'entrydash'];
export function normalizeFolders(list, v = 2) {
  let src = Array.isArray(list) && list.length ? list : FOLDER_DEFAULT;
  // 20-11-2026 (once, folders saved before): the entry pages move into a new folder "Entry" after the first folder
  if (src !== FOLDER_DEFAULT && !(v >= 2) && !src.some((f) => String(f?.name || '').trim().toLowerCase() === 'entry')) {
    const rest = src.map((f) => ({ ...f, ids: (Array.isArray(f?.ids) ? f.ids : []).filter((id) => !ENTRY_IDS.includes(id)) }));
    src = [rest[0], { name: 'Entry', ids: [...ENTRY_IDS] }, ...rest.slice(1)];
  }
  const seen = new Set(), names = new Set(), out = [];
  for (const [i, f] of src.slice(0, 12).entries()) {
    let name = text(f?.name, 24, `Folder ${i + 1}`);   // a name left empty: "Folder N" (the folder and its pages stay)
    if (names.has(name.toLowerCase())) continue; names.add(name.toLowerCase());
    const ids = (Array.isArray(f?.ids) ? f.ids : []).map(String).filter((id) => FOLDER_IDS.includes(id) && !seen.has(id));
    ids.forEach((id) => seen.add(id));
    out.push({ name, ids });
  }
  if (!out.length) return structuredClone(FOLDER_DEFAULT);
  // a page in no folder (new page, or a saved list from before): into its standard folder when that name is kept, else the last folder
  for (const id of FOLDER_IDS) if (!seen.has(id)) {
    const std = FOLDER_DEFAULT.find((f) => f.ids.includes(id))?.name;
    (out.find((f) => f.name === std) || out[out.length - 1]).ids.push(id);
  }
  return out;
}

/**
 * 23-11-2026: which reports each login sees on the Reports page (mirrors ui_reports in backend/lib/ui.php).
 * access = { login: [report ids] } — a login not listed sees every report; [] = none.
 */
export function normalizeReports(r) {
  const access = {};
  for (const [u0, ids] of Object.entries(r?.access && typeof r.access === 'object' ? r.access : {})) {
    const u = String(u0).trim().toLowerCase();
    if (!/^[a-z0-9._-]{1,40}$/.test(u) || !Array.isArray(ids)) continue;
    access[u] = [...new Set(ids.map(String).filter((x) => /^[a-zA-Z]{2,20}$/.test(x)))].slice(0, 50);
  }
  return { access };
}
/** the reports a login may open (null = all) */
export const reportsAllowed = (ui, user, isAdmin) => (isAdmin || !user ? null : ui?.reports?.access?.[String(user).toLowerCase()] ?? null);

export function normalizeUi(s = {}) {
  const m = s.management || {};
  const mp = pages(m.pages, MGMT_CATALOG.map((p) => p.id), MGMT_DEFAULT_ON, false);
  if ((Number(s.mgmtV) || 1) < 2 && Array.isArray(m.pages)) for (const p of mp) if (MGMT_REVIEW.includes(p.id)) p.on = true;
  // the Dashboard came after the Setup was saved: put it first and open on it (mirrors ui_clean in backend/lib/ui.php)
  const newDash = Array.isArray(m.pages) && !m.pages.some((p) => p?.id === 'dash');
  if (newDash) { const i = mp.findIndex((p) => p.id === 'dash'); mp.unshift(...mp.splice(i, 1)); }
  let on = mp.filter((p) => p.on).map((p) => p.id);
  if (!on.length) { mp[0].on = true; on = [mp[0].id]; }
  const ov = m.oneView || {};
  const flag = (k) => (ov[k] == null ? true : !!ov[k]);
  const kpis = Object.fromEntries(KPI_LIST.map(([k]) => [k, ov.kpis?.[k] == null ? true : !!ov.kpis[k]]));
  const ap = pages(s.admin?.pages, ADMIN_IDS, ADMIN_IDS, true);
  if (!ap.some((p) => p.on)) ap[0].on = true;
  const b = s.brand || {};
  const clamp = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  return {
    management: {
      pages: mp, home: newDash ? 'dash' : on.includes(m.home) ? m.home : on[0],
      oneView: { showKpis: flag('showKpis'), lines: flag('lines'), week: flag('week'), attention: flag('attention'), kpis, refreshSec: clamp(ov.refreshSec ?? 15, 10, 300, 15), amberFrom: clamp(ov.amberFrom ?? 90, 50, 99, 90) },
    },
    admin: { pages: ap },
    mgmtV: 2,
    folders: normalizeFolders(s.folders, Number(s.foldersV) || 1), foldersV: 2,
    targetRule: normalizeRule(s.targetRule),
    brand: { name: text(b.name, 24, 'DIXON'), tagline: text(b.tagline, 40, 'Line Pulse — EMS'), color: BRAND_COLORS[b.color] ? b.color : 'navy' },
    theme: normalizeTheme(s.theme, b.color && b.color !== 'navy' ? BRAND_COLORS[b.color] : null),
    hpr: normalizeHpr(s.hpr),
    ole: normalizeOle(s.ole),
    reports: normalizeReports(s.reports),
    refresh: normalizeRefresh(s.refresh),
    notify: normalizeNotify(s.notify),     // 23-11-2026: Setup → Notifications
    welcome: normalizeWelcome(s.welcome),
    capa: capaHead(s.capa),   // 24-11-2026: header of the CAPA form (mirrors capa_head in backend/lib/capa.php)
    entry: normalizeEntry(s.entry),   // 25-11-2026: the entry methods switched on (mirrors ui_entry in backend/lib/ui.php)
    updatedAt: s.updatedAt ?? null, updatedBy: s.updatedBy ?? null,
  };
}

/** 25-11-2026: the ways of filling an hour on Loss / Quality entry (Setup → Access & entry): all on by default */
export const ENTRY_METHODS = [
  ['manyHours', 'Many hours · model-wise', 'Rework / rejection of one model in all the hours it ran, in one grid (Quality entry)'],
  ['copyPrev', 'Copy the previous hour', 'Loss entry: copy the loss rows of the hour before'],
  ['quickAdd', 'Quick add buttons', 'One click adds a reason / defect used often'],
  ['noLoss', '"No loss" / "No defects" — Save', 'One click saves an hour as checked with nothing lost / found'],
  ['lineOff', 'Line off all day', 'Loss entry: the whole day marked as line off (holiday, no plan …)'],
  ['nextEmpty', 'Next empty hour', 'Top button that opens the next hour still to fill'],
];
export function normalizeEntry(e) {
  const x = e && typeof e === 'object' ? e : {};
  return Object.fromEntries(ENTRY_METHODS.map(([k]) => [k, x[k] !== false]));
}

/** Sidebar entries of the management login, in the admin's order, with the admin's names. */
export function mgmtPages(ui) {
  return ui.management.pages.filter((p) => p.on && !RETIRED_PAGES.has(p.id)).map((p) => { const c = MGMT_CATALOG.find((x) => x.id === p.id); return { ...c, label: p.label || c.label }; });
}

/** Admin sidebar: the chosen pages of the full list + Setup (always last, cannot be hidden). */
export function adminPages(ui, all, setupPage) {
  const on = new Set(ui.admin.pages.filter((p) => p.on).map((p) => p.id));
  const order = ui.admin.pages.map((p) => p.id);
  return [...all.filter((p) => on.has(p.id) && !RETIRED_PAGES.has(p.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)), setupPage];
}
