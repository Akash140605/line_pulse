import HeaderBar, { segGroup, segBtn } from './components/HeaderBar';
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import MesDrawer from './components/MesDrawer';
import useMediaQuery from './hooks/useMediaQuery';
import { X, Maximize2 } from 'lucide-react';

import { getLine, setLine, LINE_IDS, api, scopeLabel } from './api';
import { OLE_LINES } from './utils/ole';
import { QualityCtx } from './components/OleParts';
import { fmtDate } from './theme';
import LineSwitch from './components/LineSwitch';
import TvStage, { TvButton, tvFromUrl, TV_LOOKS } from './components/TvStage';
import BackupBanner from './components/BackupBanner';
import { getBackupState, subscribeBackup } from './utils/backup';
import LineOffline from './components/LineOffline';
import { describeLoadError } from './utils/offline';
import MainOverview from './components/MainOverview';
import { OPEN_PAGE_EVENT } from './components/NotificationBell';
import MainLive, { OfflineToday } from './components/MainLive';
import useDashboard from './hooks/useDashboard';
import { refreshSec } from './utils/refreshConfig';
import MissingCycleWatch from './components/MissingCycleWatch';
import { installDownloadLog } from './utils/downloadLog';

// 25-11-2026: every download (report, Excel, CSV, PDF …) goes to the activity log — who, which report, which days
installDownloadLog();
import Header from './components/Header';
import Sidebar, { PAGES, SETUP_PAGE } from './components/Sidebar';
import useUiSettings from './hooks/useUiSettings';
import { mgmtPages, adminPages, MGMT_CATALOG } from './utils/uiSettings';
import FilterBar from './components/FilterBar';
import DailyTrendChart from './components/DailyTrendChart';
import HourlyChart from './components/HourlyChart';
import HourlyMatrix from './components/HourlyMatrix';
import ModelAnalysisTable from './components/ModelAnalysisTable';
import HourDrawer from './components/HourDrawer';
import RejectionAnalysis from './components/RejectionAnalysis';
import PanelShell from './components/PanelShell';
import LoadingBar from './components/LoadingBar';
import { PageLoader, GlobalBusyBar } from './components/Loader';
import LiveControl from './components/LiveControl';
import OutlierBar from './components/OutlierBar';
import ErrorBoundary from './components/ErrorBoundary';
import ExportBar from './components/ExportBar';
import { exportWorkbook } from './utils/exportExcel';
import TaktSettings from './components/TaktSettings';
import useTakt from './hooks/useTakt';
import useAnalytics from './hooks/useAnalytics';
import AuthGate, { UserMenu, useAuth } from './components/AuthGate';
import { useActivityPage, useActivityLogout } from './utils/activityTrack';
import { aiContext } from './utils/ai';
import { computeAnalysis } from './utils/analysis';
import LiveLine from './components/LiveLine';
import useLossData from './hooks/useLossData';
import useLineSettings from './hooks/useLineSettings';
import useLosses from './hooks/useLosses';
import useRunningModel from './hooks/useRunningModel';
import TargetBoard from './components/TargetBoard';
import TargetsEditor from './components/TargetsEditor';
import { targetOf, pphOf, hourPlanOf } from './utils/targets';
import { withMasterFallback } from './utils/targetMethods';
import { settingsOn } from './utils/targetPeriods';
import { workSecInHour, hourSpanLabel, realCycleSec, runCycleOf, setupShift } from './utils/shift';
import useDaySetups from './hooks/useDaySetups';
import { buildHourLoss } from './utils/loss';
import { serverNow, serverToday } from './utils/serverTime';

// Pages: each one is its own file chunk, loaded the first time it is opened (keeps the first screen fast)
const AnalysisView = lazy(() => import('./components/AnalysisView'));
const DistributionPage = lazy(() => import('./pages/DistributionPage'));
const ParetoPage = lazy(() => import('./pages/ParetoPage'));
const ModelsPage = lazy(() => import('./pages/ModelsPage'));
const ModelExplorerPage = lazy(() => import('./pages/ModelExplorerPage'));
const TrendsPage = lazy(() => import('./pages/TrendsPage'));
const FormulasPage = lazy(() => import('./pages/FormulasPage'));
const ControlChartsPage = lazy(() => import('./components/ControlChartsPage'));
const StdCyclePage = lazy(() => import('./components/StdCyclePage'));
const AIAnalysisPage = lazy(() => import('./pages/AIAnalysisPage'));
const MainAIPage = lazy(() => import('./pages/MainAIPage'));
const TargetMethodsPage = lazy(() => import('./pages/TargetMethodsPage'));
const LossRecordPage = lazy(() => import('./pages/LossRecordPage'));
const CommandView = lazy(() => import('./components/CommandView'));
const SetupPage = lazy(() => import('./pages/SetupPage'));
const MainModelsPage = lazy(() => import('./pages/MainModelsPage'));
const TargetCheckPage = lazy(() => import('./pages/TargetCheckPage'));
const LineTargetsPage = lazy(() => import('./pages/LineTargetsPage'));
const MethodPlanPage = lazy(() => import('./pages/MethodPlanPage'));
const OlePage = lazy(() => import('./pages/OlePage'));
const LossEntryPage = lazy(() => import('./pages/LossEntryPage'));
const QualityEntryPage = lazy(() => import('./pages/LossEntryPage').then((m) => ({ default: m.QualityEntryPage })));
const KpiDashboardPage = lazy(() => import('./pages/KpiDashboardPage'));
const RcaDashboardPage = lazy(() => import('./pages/RcaDashboardPage'));
const ReworkDashboardPage = lazy(() => import('./pages/ReworkDashboardPage'));
const SerialsPage = lazy(() => import('./pages/SerialsPage'));
const CustomerProductionPage = lazy(() => import('./pages/CustomerProductionPage'));   // 23-11-2026: customer wise production   // 23-11-2026: carton & serial report
const LossQualityEntryPage = lazy(() => import('./pages/LossEntryPage').then((m) => ({ default: m.LossQualityEntryPage })));
const RcaPage = lazy(() => import('./pages/RcaPage'));
const DailyCapaPage = lazy(() => import('./pages/DailyCapaPage'));
const MorningEntryPage = lazy(() => import('./pages/MorningEntryPage'));
const KpiEntryPage = lazy(() => import('./pages/KpiEntryPage'));
const LossAnalysisPage = lazy(() => import('./pages/LossAnalysisPage'));
const QualityAnalysisPage = lazy(() => import('./pages/QualityAnalysisPage'));   // Rejection analysis / Rework analysis
// Dashboard = the clean management view
const DashboardPage = lazy(() => import('./pages/CleanDashboardPage'));
const OleOverviewPage = lazy(() => import('./pages/OleOverviewPage'));
const OleCalendarPage = lazy(() => import('./pages/OleCalendarPage'));
const AvailabilityFocusPage = lazy(() => import('./pages/OleFocusPage').then((m) => ({ default: m.AvailabilityFocusPage })));
const PerformanceFocusPage = lazy(() => import('./pages/OleFocusPage').then((m) => ({ default: m.PerformanceFocusPage })));
const QualityFocusPage = lazy(() => import('./pages/OleFocusPage').then((m) => ({ default: m.QualityFocusPage })));
const OleMonthlyPage = lazy(() => import('./pages/OleMonthlyPage'));
const EntryDashboardPage = lazy(() => import('./pages/EntryDashboardPage'));
const OleDrillPage = lazy(() => import('./pages/OleDrillPage'));
const ModelMasterPage = lazy(() => import('./pages/ModelMasterPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const ReportComparePage = lazy(() => import('./pages/ReportComparePage'));
const ModelUniversePage = lazy(() => import('./pages/ModelUniversePage'));
const CapaRegisterPage = lazy(() => import('./pages/CapaRegisterPage'));
const QualityPage = lazy(() => import('./pages/QualityPage'));
const QualityDashboardPage = lazy(() => import('./pages/QualityDashboardPage'));
const FactorDashboardPage = lazy(() => import('./pages/FactorDashboardPage'));   // 26-11-2026: Availability / Performance dashboards   // 23-11-2026: quality dashboard
const PAGE_FALLBACK = <PageLoader label="Opening the page" />;

const ANALYTICS_PAGES = ['distribution', 'pareto', 'models', 'trends'];
// OLE pages keep their own period (and line tabs), so the scan filters (company, model, outliers) are not shown above them
/** 25-11-2026: on a phone a filter card folds behind one line (tap to open); on a wider screen it is always open */
function PhoneFold({ summary, children }) {
  const phone = useMediaQuery('(max-width: 767px)');
  const [open, setOpen] = React.useState(false);
  if (!phone) return children;
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button type="button" aria-expanded={open} data-testid="phone-filters" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <span className="shrink-0 rounded-md bg-dixon-navy px-2 py-1 text-fs-12 font-bold text-white">{open ? 'Hide filters' : 'Filters'}</span>
        <span className="min-w-0 flex-1 truncate text-fs-13 font-semibold text-slate-600">{summary}</span>
        <span aria-hidden className={`text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && <div className="border-t border-slate-100">{children}</div>}
    </div>
  );
}
const OWN_PERIOD_PAGES = ['capaday', 'idleday', 'capa', 'universe', 'qdash', 'adash', 'pdash', 'custprod', 'serials', 'repcmp', 'methodplan', 'rwkdash', 'rcadash', 'kpidash', 'lqentry', 'kpientry', 'dash', 'oleview', 'olea', 'olep', 'oleq', 'olecal', 'olemonth', 'entrydash', 'oledrill', 'master', 'reports', 'ole', 'oleentry', 'qentry', 'rca', 'quality', 'targetcheck', 'linetargets', 'daily', 'lossan', 'rejan', 'rwkan'];

const PANEL_TITLES = {
  trend: 'Daily production trend',
  hourly: 'Hourly production',
  rejection: 'Rejection analysis',
  matrix: 'Hourly matrix',
  models: 'Model analysis',
};

const fmtTime = (v) => {
  if (!v) return '';
  const t = new Date(v);
  return isNaN(t) ? String(v) : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const todayStr = () => serverToday();   // DB server ka din (is PC ki ghadi galat ho sakti hai)

/* ───────────── Main view: all four lines together ───────────── */
// pages that work for all lines together; the others (hourly, takt, spread …) need one line, so Main does not list them
const MAIN_PAGE_IDS = ['capaday', 'idleday', 'capa', 'universe', 'qdash', 'adash', 'pdash', 'custprod', 'serials', 'repcmp', 'methodplan', 'rwkdash', 'rcadash', 'kpidash', 'lqentry', 'kpientry', 'overview', 'dash', 'oleview', 'olea', 'olep', 'oleq', 'olecal', 'olemonth', 'entrydash', 'oledrill', 'master', 'reports', 'ole', 'daily', 'oleentry', 'qentry', 'rca', 'lossan', 'rejan', 'rwkan', 'quality', 'linetargets', 'targetcheck', 'ai', 'targets', 'models', 'explorer', 'control', 'hourly', 'formulas', 'setup'];
// one-line pages the admin also opens from Main: the line's own page with Line 1–4 buttons above it (like management)
const MAIN_LINE_PAGES = ['hourly'];
// Main pages without their own line buttons keep the Line 1–4 / Main switch in the header; the others pick lines on the page
const MAIN_SWITCH_PAGES = ['overview', 'ai'];
/** 23-11-2026: a notification (the bell) opens its page — only a page this view has */
function useOpenPageEvent(setPage, ids) {
  const ref = React.useRef({ setPage, ids });
  ref.current = { setPage, ids };
  useEffect(() => {
    const on = (e) => { const p = e?.detail?.page; if (p && ref.current.ids.includes(p)) ref.current.setPage(p); };
    window.addEventListener(OPEN_PAGE_EVENT, on);
    return () => window.removeEventListener(OPEN_PAGE_EVENT, on);
  }, []);
}

function MainView({ line, onLineChange, ui }) {
  const apages = adminPages(ui, PAGES, SETUP_PAGE).filter((p) => MAIN_PAGE_IDS.includes(p.id));
  const [page, setPage] = useState(() => apages[0].id);
  useOpenPageEvent(setPage, apages.map((p) => p.id));
  useActivityPage(page, apages.find((p) => p.id === page)?.label || page, 'all');   // activity log: the page this login opened
  const [takt] = useTakt();
  const today = useMemo(todayStr, []);
  const [tv, setTv] = useState(tvFromUrl);
  // Hourly analysis from Main: the api layer must know the line before the line page mounts, and 'all' again after it
  // (not remembered: a reload still opens Main)
  const [mline, setMline] = useState(LINE_IDS[0]);
  const wantLine = MAIN_LINE_PAGES.includes(page) ? mline : 'all';
  if (getLine() !== wantLine) setLine(wantLine, false);
  const changeLine = (l) => { if (!LINE_IDS.includes(String(l))) { setPage(apages[0].id); return; } setLine(String(l), false); setMline(String(l)); };
  return (
    <div className="min-h-screen flex bg-dixon-steel text-slate-950 antialiased font-sans">
      {tv && <TvStage base={1440} fill title={`Main — ${scopeLabel().toLowerCase() === 'all lines' ? 'all lines' : scopeLabel()}`} onClose={() => setTv(false)}><MainLive tv /></TvStage>}
      <Sidebar sections page={page} onChange={setPage} focusDate={today} loading={false} pages={apages} brand={ui.brand} folders={ui.folders} />
      <div className="flex-1 min-w-0 flex flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <Header title={!MAIN_SWITCH_PAGES.includes(page) ? (apages.find((p) => p.id === page)?.label || 'Main') : `${apages.find((p) => p.id === page)?.label || 'Main'} · ${scopeLabel()}`} onRefresh={() => window.location.reload()} loading={false}
          extra={<>{MAIN_SWITCH_PAGES.includes(page) && <LineSwitch line={line} onChange={onLineChange} />}<TvButton onClick={() => setTv(true)} /></>} />
        {/* Pages open with a short rise / fade (lp-anim); the live lines keep their own steady look */}
        <main className={`lp-main flex-1 w-full px-3 lg:px-5 py-3 flex flex-col gap-3${page === 'overview' || MAIN_LINE_PAGES.includes(page) ? '' : ' lp-anim'}`} data-page={page}>
          <BackupBanner line="all" />
          {page === 'overview' && (
            <ErrorBoundary key="overview">
              <div className="flex flex-col gap-3">
                <MainLive />
                <MainOverview latestDate={today} />
              </div>
            </ErrorBoundary>
          )}
          {page === 'control' && (
            <ErrorBoundary key="control">
              <Suspense fallback={<div className="bg-white border border-slate-200 rounded-xl shadow-sm py-16 text-center text-fs-14 font-semibold text-slate-600">Loading page…</div>}>
                {/* Main has no FilterBar, so the page keeps its own period / line / model controls (no range, company or model props). */}
                <ControlChartsPage line="all" companies={[]} latestDate={today} takt={takt} stds={{}} />
              </Suspense>
            </ErrorBoundary>
          )}
          {page === 'explorer' && (
            <ErrorBoundary key="explorer">
              <Suspense fallback={<div className="bg-white border border-slate-200 rounded-xl shadow-sm py-16 text-center text-fs-14 font-semibold text-slate-600">Loading page…</div>}>
                <ModelExplorerPage line="all" latestDate={today} />
              </Suspense>
            </ErrorBoundary>
          )}
          {page === 'ai' && (
            <ErrorBoundary key="ai">
              <Suspense fallback={<div className="bg-white border border-slate-200 rounded-xl shadow-sm py-16 text-center text-fs-14 font-semibold text-slate-600">Loading page…</div>}>
                <MainAIPage today={today} />
              </Suspense>
            </ErrorBoundary>
          )}
          {page === 'targets' && (
            <ErrorBoundary key="targets">
              <Suspense fallback={<div className="bg-white border border-slate-200 rounded-xl shadow-sm py-16 text-center text-fs-14 font-semibold text-slate-600">Loading page…</div>}>
                <TargetMethodsPage latestDate={today} />
              </Suspense>
            </ErrorBoundary>
          )}
          {page === 'setup' && (
            <ErrorBoundary key="setup"><Suspense fallback={PAGE_FALLBACK}><SetupPage /></Suspense></ErrorBoundary>
          )}
          {page === 'models' && (
            <ErrorBoundary key="models"><Suspense fallback={PAGE_FALLBACK}><MainModelsPage latestDate={today} /></Suspense></ErrorBoundary>
          )}
          {page === 'targetcheck' && (
            <ErrorBoundary key="targetcheck"><Suspense fallback={PAGE_FALLBACK}><TargetCheckPage canEdit /></Suspense></ErrorBoundary>
          )}
          {page === 'linetargets' && (
            <ErrorBoundary key="linetargets"><Suspense fallback={PAGE_FALLBACK}><LineTargetsPage canEdit /></Suspense></ErrorBoundary>
          )}
          {page === 'methodplan' && (
            <ErrorBoundary key="methodplan"><Suspense fallback={PAGE_FALLBACK}><MethodPlanPage canEdit /></Suspense></ErrorBoundary>
          )}
          {page === 'ole' && (
            <ErrorBoundary key="ole"><Suspense fallback={PAGE_FALLBACK}><OlePage /></Suspense></ErrorBoundary>
          )}
          {page === 'dash' && (
            <ErrorBoundary key="dash"><Suspense fallback={PAGE_FALLBACK}><DashboardPage onOpen={setPage} canOpen={apages.map((p) => p.id)} /></Suspense></ErrorBoundary>
          )}
          {page === 'reports' && (
            <ErrorBoundary key="reports"><Suspense fallback={PAGE_FALLBACK}><ReportsPage /></Suspense></ErrorBoundary>
          )}
          {page === 'repcmp' && (
            <ErrorBoundary key="repcmp"><Suspense fallback={PAGE_FALLBACK}><ReportComparePage /></Suspense></ErrorBoundary>
          )}
          {page === 'universe' && (
            <ErrorBoundary key="universe"><Suspense fallback={PAGE_FALLBACK}><ModelUniversePage /></Suspense></ErrorBoundary>
          )}
          {page === 'capa' && (
            <ErrorBoundary key="capa"><Suspense fallback={PAGE_FALLBACK}><CapaRegisterPage /></Suspense></ErrorBoundary>
          )}
          {page === 'master' && (
            <ErrorBoundary key="master"><Suspense fallback={PAGE_FALLBACK}><ModelMasterPage /></Suspense></ErrorBoundary>
          )}
          {page === 'olecal' && (
            <ErrorBoundary key="olecal"><Suspense fallback={PAGE_FALLBACK}><OleCalendarPage /></Suspense></ErrorBoundary>
          )}
          {page === 'olea' && (<ErrorBoundary key="olea"><Suspense fallback={PAGE_FALLBACK}><AvailabilityFocusPage /></Suspense></ErrorBoundary>)}
          {page === 'adash' && (<ErrorBoundary key="adash"><Suspense fallback={PAGE_FALLBACK}><FactorDashboardPage key="A" factor="A" /></Suspense></ErrorBoundary>)}
          {page === 'pdash' && (<ErrorBoundary key="pdash"><Suspense fallback={PAGE_FALLBACK}><FactorDashboardPage key="P" factor="P" /></Suspense></ErrorBoundary>)}
          {page === 'olep' && (<ErrorBoundary key="olep"><Suspense fallback={PAGE_FALLBACK}><PerformanceFocusPage /></Suspense></ErrorBoundary>)}
          {page === 'oleq' && (<ErrorBoundary key="oleq"><Suspense fallback={PAGE_FALLBACK}><QualityFocusPage /></Suspense></ErrorBoundary>)}
          {page === 'olemonth' && (
            <ErrorBoundary key="olemonth"><Suspense fallback={PAGE_FALLBACK}><OleMonthlyPage /></Suspense></ErrorBoundary>
          )}
          {page === 'entrydash' && (
            <ErrorBoundary key="entrydash"><Suspense fallback={PAGE_FALLBACK}><EntryDashboardPage onOpen={setPage} canOpen={apages.map((p) => p.id)} /></Suspense></ErrorBoundary>
          )}
          {page === 'oledrill' && (
            <ErrorBoundary key="oledrill"><Suspense fallback={PAGE_FALLBACK}><OleDrillPage /></Suspense></ErrorBoundary>
          )}
          {page === 'oleview' && (
            <ErrorBoundary key="oleview"><Suspense fallback={PAGE_FALLBACK}><OleOverviewPage onOpen={setPage} canOpen={apages.map((p) => p.id)} /></Suspense></ErrorBoundary>
          )}
          {page === 'oleentry' && (
            <ErrorBoundary key="oleentry"><Suspense fallback={PAGE_FALLBACK}><LossEntryPage canEdit isAdmin /></Suspense></ErrorBoundary>
          )}
          {page === 'qentry' && (
            <ErrorBoundary key="qentry"><Suspense fallback={PAGE_FALLBACK}><QualityEntryPage canEdit isAdmin /></Suspense></ErrorBoundary>
          )}
          {page === 'lqentry' && (
            <ErrorBoundary key="lqentry"><Suspense fallback={PAGE_FALLBACK}><LossQualityEntryPage canEdit isAdmin /></Suspense></ErrorBoundary>
          )}
          {page === 'rca' && (
            <ErrorBoundary key="rca"><Suspense fallback={PAGE_FALLBACK}><RcaPage isAdmin /></Suspense></ErrorBoundary>
          )}
          {(page === 'capaday' || page === 'idleday') && (
            <ErrorBoundary key={page}><Suspense fallback={PAGE_FALLBACK}><DailyCapaPage key={page} kind={page === 'capaday' ? 'rework' : 'idle'} isAdmin /></Suspense></ErrorBoundary>
          )}
          {page === 'rwkdash' && (
            <ErrorBoundary key="rwkdash"><Suspense fallback={PAGE_FALLBACK}><ReworkDashboardPage /></Suspense></ErrorBoundary>
          )}
          {page === 'qdash' && (
            <ErrorBoundary key="qdash"><Suspense fallback={PAGE_FALLBACK}><QualityDashboardPage onOpen={setPage} canOpen={apages.map((p) => p.id)} /></Suspense></ErrorBoundary>
          )}
          {page === 'custprod' && (
            <ErrorBoundary key="custprod"><Suspense fallback={PAGE_FALLBACK}><CustomerProductionPage /></Suspense></ErrorBoundary>
          )}
          {page === 'serials' && (
            <ErrorBoundary key="serials"><Suspense fallback={PAGE_FALLBACK}><SerialsPage /></Suspense></ErrorBoundary>
          )}
          {page === 'rcadash' && (
            <ErrorBoundary key="rcadash"><Suspense fallback={PAGE_FALLBACK}><RcaDashboardPage onOpen={setPage} canOpen={apages.map((p) => p.id)} /></Suspense></ErrorBoundary>
          )}
          {page === 'kpidash' && (
            <ErrorBoundary key="kpidash"><Suspense fallback={PAGE_FALLBACK}><KpiDashboardPage /></Suspense></ErrorBoundary>
          )}
          {page === 'kpientry' && (
            <ErrorBoundary key="kpientry"><Suspense fallback={PAGE_FALLBACK}><KpiEntryPage /></Suspense></ErrorBoundary>
          )}
          {page === 'daily' && (
            <ErrorBoundary key="daily"><Suspense fallback={PAGE_FALLBACK}><MorningEntryPage /></Suspense></ErrorBoundary>
          )}
          {page === 'lossan' && (
            <ErrorBoundary key="lossan"><Suspense fallback={PAGE_FALLBACK}><LossAnalysisPage onOpen={setPage} canOpen={apages.map((p) => p.id)} /></Suspense></ErrorBoundary>
          )}
          {(page === 'rejan' || page === 'rwkan') && (
            <ErrorBoundary key={page}><Suspense fallback={PAGE_FALLBACK}><QualityAnalysisPage key={page} kind={page === 'rejan' ? 'reject' : 'rework'} onOpen={setPage} canOpen={apages.map((p) => p.id)} /></Suspense></ErrorBoundary>
          )}
          {page === 'quality' && (
            <ErrorBoundary key="quality"><Suspense fallback={PAGE_FALLBACK}><QualityPage onOpen={setPage} isAdmin /></Suspense></ErrorBoundary>
          )}
          {MAIN_LINE_PAGES.includes(page) && (
            <ErrorBoundary key={`${mline}-${page}`}><Dashboard key={`${mline}-${page}`} line={mline} onLineChange={changeLine} embedded pageProp={page} /></ErrorBoundary>
          )}
          {page === 'formulas' && (
            <ErrorBoundary key="formulas"><Suspense fallback={PAGE_FALLBACK}><FormulasPage /></Suspense></ErrorBoundary>
          )}
          {!MAIN_PAGE_IDS.includes(page) && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm py-16 px-4 text-center text-fs-14 font-semibold text-slate-600">
              Main (all lines) includes <b>Overview</b>, <b>OLE</b>, <b>Line target method</b>, <b>Target rule & check</b>, <b>AI analysis</b>, <b>Target methods A/B/C/D</b>, <b>Model analysis</b>, <b>Model explorer</b> and <b>Control charts</b>. For the other pages, select Line 1–4 above.
            </div>
          )}
        </main>
      </div>
      {/* 23-11-2026: a model made today without a cycle time asks for it (admin) */}
      <MissingCycleWatch onOpenMaster={() => setPage('master')} />
    </div>
  );
}

/* ───────────── Single-line dashboard (unchanged behaviour, line comes from the api layer) ───────────── */
function Dashboard({ line, onLineChange, embedded = false, pageProp = null, readOnly = false, ui = null, pagesOverride = null, tvOnly = false, onExitTv = null }) {
  // line server offline → its numbers come from the backup / last saved data (utils/backup.js)
  const [bkState, setBkState] = useState(getBackupState);
  useEffect(() => subscribeBackup(setBkState), []);
  const offlineInfo = bkState[String(line)] || null;
  const apages = pagesOverride || (ui ? adminPages(ui, PAGES, SETUP_PAGE) : PAGES);
  const [pageS, setPage] = useState(() => apages[0].id);
  useOpenPageEvent(setPage, apages.map((p) => p.id));
  const page = pageProp || pageS;
  // activity log: the page opened on this line (a TV screen is not logged; inside Main the page is noted by Main)
  useActivityPage(tvOnly || embedded ? null : page, apages.find((p) => p.id === page)?.label || page, String(line));
  // pages with their own data (OLE, Dashboard, targets …): the line's scan data is not read / polled while they are open
  const idle = OWN_PERIOD_PAGES.includes(page) || page === 'setup';
  const d = useDashboard({ idle });
  const [cycleMode, setCycleMode] = useState('actual');
  const [expanded, setExpanded] = useState(null);
  const [takt, saveTakt] = useTakt();
  const [showTakt, setShowTakt] = useState(false);
  const [tv, setTv] = useState(tvFromUrl);
  const openTv = () => { if (!d.live) d.toggleLive(); setTv(true); };
  const an = useAnalytics({
    range: d.range, filters: d.filters, enabled: ANALYTICS_PAGES.includes(page), refreshKey: d.refreshKey, pollMs: d.liveActive ? 60000 : 0,
  });
  const loss = useLossData();
  // shared on the server for every screen: shift + lunch window, model targets, loss register
  const lsMaster = useLineSettings(String(line));
  // the morning entry of the focus day (supervisor: start, lunch, tea breaks, close) replaces the shift master for that day
  const daySetups = useDaySetups(d.focusDate);
  const daySu = daySetups[`${d.focusDate}|${line}`] || null;
  const dayShift = useMemo(() => setupShift(daySu), [JSON.stringify(daySu)]); // eslint-disable-line react-hooks/exhaustive-deps
  // 20-11-2026: the targets of the method in force on the focus day (target method by date)
  const lsDay0 = useMemo(() => settingsOn(lsMaster, d.focusDate), [lsMaster, d.focusDate]);
  // 27-11-2026: a model of the line with no target in its set takes the master's (Method D lines) — never blank
  const lsDay = useMemo(() => (lsDay0 ? { ...lsDay0, targets: withMasterFallback(lsDay0.targets, String(line), d.models || []) } : lsDay0), [lsDay0, line, d.models]);
  const ls = dayShift ? { ...lsDay, shift: dayShift, daySetup: daySu } : lsDay;
  const reg = useLosses(String(line), d.range?.start, d.range?.end);
  const [editor, setEditor] = useState(null);   // { tab, focus }
  const taktS = useMemo(() => ({ ...takt, shift: ls.shift }), [takt, ls.shift]);
  // scans inside the lunch window, per day and hour: the hourly matrix shows lunch as its own row
  const [lunchCounts, setLunchCounts] = useState(null);
  const lunchDone = React.useRef('');
  useEffect(() => {
    const ls0 = ls.shift?.lunchStart, le0 = ls.shift?.lunchEnd;
    if (!d.range || !ls0 || !le0) { setLunchCounts(null); lunchDone.current = ''; return undefined; }
    const key = JSON.stringify([d.range.start, d.range.end, ls0, le0, d.filters?.companyId, d.filters?.mmId, d.refreshKey]);
    if (idle || lunchDone.current === key) return undefined;   // not needed on an own-data page / already read
    lunchDone.current = key;
    let alive = true, got = false;
    setLunchCounts(null);
    api.windowCounts(d.range.start, d.range.end, ls0, le0, { companyId: d.filters?.companyId, mmId: d.filters?.mmId })
      .then((j) => { if (alive) { got = true; setLunchCounts(j?.days || {}); } })
      .catch(() => { if (alive) setLunchCounts(null); lunchDone.current = ''; });
    return () => { alive = false; if (!got) lunchDone.current = ''; };
  }, [d.range?.start, d.range?.end, ls.shift?.lunchStart, ls.shift?.lunchEnd, d.filters?.companyId, d.filters?.mmId, d.refreshKey, idle]); // eslint-disable-line react-hooks/exhaustive-deps
  // target cycle of a model (server) wins over the older per-browser standard cycle
  const stds = useMemo(() => {
    const o = { ...loss.stds };
    for (const [k, v] of Object.entries(ls.targets || {})) if (v?.cycle > 0) o[k] = v.cycle;
    return o;
  }, [loss.stds, ls.targets]);
  const setTargetCycle = (mmId, sec) => {
    const m = d.models.find((x) => String(x.mmId) === String(mmId));
    return ls.saveTarget({ mmId: Number(mmId), cycle: Number(sec) > 0 ? Number(sec) : null, model: m?.model || '', company: m?.companyTitle || '' }).catch(() => loss.setStd(mmId, sec));
  };
  const pick = (id) => d.changeModel(id);
  const doExport = () => exportWorkbook({
    range: d.range, focusDate: d.focusDate, filters: d.filters, settings: takt, summary: d.summary, daily: d.daily, modelData: d.modelData, analytics: an.data,
    companyName: d.companies.find((c) => c.CompanyId === d.companyId)?.CompanyTitle, modelName: d.models.find((m) => m.mmId === d.mmId)?.model,
  });
  const analysis = useMemo(
    () => computeAnalysis({ summary: d.summary, models: d.modelData?.models, rejection: d.rejection, settings: taktS, focusDate: d.focusDate }),
    // lastUpdated re-evaluates 'now' (live position) on every refresh
    [d.summary, d.modelData, d.rejection, taktS, d.focusDate, d.lastUpdated]
  );

  const lossCalc = useMemo(
    () => buildHourLoss({ summary: d.summary, models: d.modelData?.models, low: d.modelData?.lowVolumeModels, stds, settings: taktS, focusDate: d.focusDate }),
    // lastUpdated keeps the running hour's elapsed time fresh in live mode
    [d.summary, d.modelData, stds, taktS, d.focusDate, d.lastUpdated]
  );
  const rangeEntries = reg.entries;
  const dayEntries = useMemo(() => reg.entries.filter((e) => e.date === d.focusDate), [reg.entries, d.focusDate]);
  const lossMinByModel = useMemo(() => {
    const o = {}; rangeEntries.forEach((e) => { if (e.mmId != null) o[e.mmId] = (o[e.mmId] || 0) + e.minutes; }); return o;
  }, [rangeEntries]);
  const dayTotal = useMemo(() => (d.summary?.hours ? d.summary.hours.reduce((a, h) => a + (Number(h.quantity) || 0), 0) : null), [d.summary]);
  const liveRow = useMemo(() => {
    const r = lossCalc?.rows || [];
    return [...r].reverse().find((x) => x.qty > 0) || r[r.length - 1] || null;
  }, [lossCalc]);
  // running model: today = the model of the last scan (live); an older day = the biggest model of its last production hour
  const isToday = d.focusDate === todayStr();
  const liveRun = useRunningModel(String(line), isToday && d.live && !OWN_PERIOD_PAGES.includes(page) && page !== 'setup');
  const runningModel = useMemo(() => {
    if (isToday && liveRun?.model) return liveRun;
    const m = liveRow?.models?.[0];
    if (!m) return null;
    return { mmId: m.mmId, model: m.model, company: d.models.find((x) => String(x.mmId) === String(m.mmId))?.companyTitle || '' };
  }, [isToday, liveRun, liveRow, d.models]);
  const runTarget = targetOf(ls.targets, runningModel?.mmId);
  // lunch scans of the focus day per hour (null while unknown)
  const lunchDay = useMemo(() => (lunchCounts ? (lunchCounts[d.focusDate] || {}) : null), [lunchCounts, d.focusDate]);
  const avgCycleById = useMemo(() => Object.fromEntries((d.modelData?.models || []).filter((m) => m.avgActualCycleSeconds > 0).map((m) => [String(m.mmId), Number(m.avgActualCycleSeconds)])), [d.modelData]);
  const todayIds = useMemo(() => new Set((d.summary?.hours || []).flatMap((h) => (h.models || []).map((m) => String(m.mmId)))), [d.summary]);
  // AI analysis (offline): one context from the data already on screen
  const aiCtx = useMemo(() => (page === 'ai' && d.summary ? aiContext({
    line: String(line), focusDate: d.focusDate, now: serverNow(), summary: d.summary, days: d.daily?.days, matrix: d.matrix,
    models: d.modelData?.models, rejection: d.rejection, shift: ls.shift, targets: ls.targets, losses: reg.entries,
    lunchByHour: lunchDay, running: isToday ? liveRun : null,
  }) : null), [page, line, d.focusDate, d.summary, d.daily, d.matrix, d.modelData, d.rejection, ls.shift, ls.targets, reg.entries, lunchDay, isToday, liveRun, d.lastUpdated]);
  // target pieces of every hour (same maths as the hour-by-hour table): drawn next to the bars in TV mode
  const hourPlan = useMemo(() => {
    if (!d.summary?.hours) return null;
    const now = serverNow();
    // offline line shown from saved data: its targets run up to the time of that data, not up to now
    const up = offlineInfo?.upTo || '';
    const nowMin = d.focusDate === todayStr()
      ? (offlineInfo && up.slice(0, 10) === d.focusDate ? Number(up.slice(11, 13)) * 60 + Number(up.slice(14, 16)) : now.getHours() * 60 + now.getMinutes())
      : null;
    return hourPlanOf({ hours: d.summary.hours, shift: ls.shift, targets: ls.targets, nowMin, fallbackCycle: runTarget, lunchByHour: lunchDay });
  }, [d.summary, ls.shift, ls.targets, runTarget, lunchDay, d.focusDate, d.lastUpdated, offlineInfo]); // eslint-disable-line react-hooks/exhaustive-deps
  const hourTargets = hourPlan?.targets || null;
  // the line's live card (animation, tiles, hourly bars): Overview page and TV mode
  const modelCompany = useMemo(() => Object.fromEntries((d.models || []).map((m) => [String(m.mmId), m.companyTitle || ''])), [d.models]);
  // offline with nothing from today: the live card says OFFLINE instead of showing an older day
  const offlineOld = !!offlineInfo && String(offlineInfo.upTo || '').slice(0, 10) !== todayStr();
  const liveLineEl = offlineOld ? <OfflineToday l={{ name: `Line ${line}`, backup: offlineInfo }} /> : d.summary && (
    <LiveLine total={dayTotal} hourLabel={liveRow ? hourSpanLabel(ls.shift, liveRow.hour) : ''} hourQty={liveRow ? Math.max(0, liveRow.qty - (Number(lunchDay?.[String(liveRow.hour)]) || 0)) : null} model={runningModel?.model || liveRow?.models?.[0]?.model} currentCycle={null} modelCycle={isToday ? runCycleOf(ls.shift, liveRun) : null} run={isToday ? liveRun : null}
      company={runningModel?.company}
      targetPph={runTarget ? pphOf(runTarget) : null} targetCycle={runTarget}
      hourTarget={runTarget && liveRow && hourPlan?.noTarget?.[liveRow.hour] ? (hourTargets?.[liveRow.hour] ?? null) : runTarget && liveRow ? Math.round((d.focusDate === todayStr() && liveRow.hour === serverNow().getHours()
        ? workSecInHour(ls.shift, liveRow.hour, serverNow().getHours() * 60 + serverNow().getMinutes()) : workSecInHour(ls.shift, liveRow.hour)) / runTarget) : null}
      avgCycle={realCycleSec(ls.shift, liveRun?.firstScan, liveRun?.lastScan, liveRun?.total) ?? analysis?.kpis?.avgActual} hours={d.summary?.hours} nowHour={liveRow?.hour}
      active={d.liveActive} refreshing={d.loading} updated={fmtTime(d.lastUpdated)} focusDate={d.focusDate}
      lunch={ls.shift?.lunchStart ? { from: ls.shift.lunchStart, to: ls.shift.lunchEnd, qty: lunchDay ? Object.values(lunchDay).reduce((x, y) => x + y, 0) : null } : null}
      intervalSec={refreshSec('dash')} paused={!offlineInfo && !d.live && !!d.focusDate && d.focusDate === d.latestDate} onResume={d.toggleLive} hourTargets={hourTargets} hourNoTarget={hourPlan?.noTarget || null} offline={offlineInfo} modelCompany={modelCompany} />
  );
  const targetBoard = d.summary && (
    <TargetBoard hours={d.summary.hours} focusDate={d.focusDate} latestDate={d.latestDate} isToday={isToday}
      running={runningModel} models={d.models} settings={ls} filters={d.filters}
      onOpenSettings={readOnly ? null : (tab, focus) => setEditor({ tab, focus })} lunchByHour={lunchDay} line={String(line)} />
  );


  const pageTitle = page === 'setup' ? 'Setup' : idle ? (PAGES.find((p) => p.id === page)?.label ?? '') : `${PAGES.find((p) => p.id === page)?.label ?? ''} · Line ${line}`;   // own-data pages show every line: no line in the title
  const chartHour = d.selected?.date === d.focusDate ? d.selected.hour : null;
  const pickHour = (hour) => d.selectHour(d.focusDate, hour);

  // One definition per panel, reused by the grid and the full-screen modal.
  const panels = {
    trend: d.daily && (
      <DailyTrendChart days={d.daily.days} focusDate={d.focusDate} onSelectDay={d.setFocusDate} />
    ),
    hourly: d.summary && (
      <HourlyChart hours={d.summary.hours} cycleMode={cycleMode} onCycleModeChange={setCycleMode}
        shift={ls.shift} lunchByHour={lunchDay}
        onSelectHour={pickHour} selectedHour={chartHour} />
    ),
    rejection: (
      <RejectionAnalysis data={d.rejection} loading={d.dayLoading} selectedHour={chartHour} onSelectHour={pickHour} />
    ),
    matrix: d.daily && (
      <HourlyMatrix days={d.daily.days.map((x) => x.date)} matrix={d.matrix} loading={d.rangeLoading}
        selected={d.selected} onSelectCell={d.selectHour} shift={ls.shift} lunchCounts={lunchCounts}
        targets={ls.targets} models={d.modelData?.models} />
    ),
    models: (
      <ModelAnalysisTable models={d.modelData?.models} lowVolumeModels={d.modelData?.lowVolumeModels} minQty={d.minQty} shift={ls.shift} />
    ),
  };

  const shell = (id, className, props = {}) => (
    <PanelShell id={id} title={PANEL_TITLES[id]} onExpand={setExpanded} className={className} {...props}>
      {panels[id]}
    </PanelShell>
  );

  const multi = d.isMultiDay;

  // TV login: only the live line animation, full screen
  if (tvOnly) {
    return (
      <TvStage base={1280} fill title={`Line ${line}`} onClose={onExitTv || (() => {})} closeLabel="Change line">
        {liveLineEl ? React.cloneElement(liveLineEl, { tv: true, title: `Line ${line}` })
          : d.error ? <OfflineToday tv l={{ name: `Line ${line}`, error: d.error, backup: offlineInfo }} />
          : <div className="py-40 text-center text-fs-24 font-bold text-slate-300">Loading Line {line}…</div>}
      </TvStage>
    );
  }

  const MainTag = embedded ? 'div' : 'main';   // one <main> per page: inside the management view the line page is a plain block
  return (
    <div className={embedded ? 'min-w-0' : 'min-h-screen flex bg-dixon-steel text-slate-950 antialiased font-sans'}>
      <LoadingBar active={d.loading} />
      {!embedded && <Sidebar sections={!pagesOverride} page={page} onChange={setPage} focusDate={d.focusDate} loading={d.loading} pages={apages} brand={ui?.brand} folders={ui?.folders} />}

      <div className={embedded ? 'min-w-0 flex flex-col' : 'flex-1 min-w-0 flex flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0'}>
        {embedded ? (
          // management: line buttons 1–4, Excel and live switch above the line's page (no admin controls)
          // one row: line · filters (company, model, dates, quick periods, min pcs) · Excel · TV · live
          // 19-11-2026: in the top bar of the page (as every page's filters), not a card on the page
          <HeaderBar label="Line page filters">
            <div className={segGroup} role="group" aria-label="Line">
              {LINE_IDS.map((l) => <button key={l} type="button" aria-pressed={String(line) === l} onClick={() => onLineChange(l)} className={segBtn(String(line) === l, 'navy')}>Line {l}</button>)}
            </div>
            {d.range && !OWN_PERIOD_PAGES.includes(page) && <div className="contents"><FilterBar bare inline
                companies={d.companies} models={d.models} companyId={d.companyId} mmId={d.mmId}
                onCompanyChange={d.changeCompany} onModelChange={d.changeModel}
                range={d.range} onRangeChange={d.changeRange}
                minQty={d.minQtyInput} onMinQtyChange={d.setMinQtyInput} latestDate={d.latestDate}
              /></div>}
            {d.range && !OWN_PERIOD_PAGES.includes(page) && (
              // outlier settings: a small button that opens them (no extra row on the page)
              <details className="group relative">
                <summary className="lp-field inline-flex h-8 cursor-pointer select-none list-none items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-fs-13 font-semibold text-slate-700 hover:bg-slate-50" aria-label="Outlier settings">⚙ Outliers</summary>
                <div className="absolute right-0 top-full z-50 mt-1 w-[min(900px,92vw)] rounded-lg border border-slate-300 bg-white p-1 shadow-2xl">
                  <OutlierBar bare
                    outlier={d.outlier} onChange={d.setOutlier} onReset={() => d.setOutlier(d.outlierDefault)}
                    dayGaps={d.summary?.idleGaps} daySeconds={d.summary?.idleSeconds}
                    rangeGaps={d.daily?.days.reduce((a, x) => a + (x.idleGaps || 0), 0)}
                    rangeSeconds={d.daily?.days.reduce((a, x) => a + (x.idleSeconds || 0), 0)}
                  />
                </div>
              </details>
            )}
            <ExportBar onExcel={doExport} />
            <TvButton onClick={openTv} />
            <LiveControl live={d.live} active={d.liveActive} onToggle={d.toggleLive} lastUpdated={d.lastUpdated} />
          </HeaderBar>
        ) : (
          <Header title={pageTitle} onRefresh={idle ? () => window.location.reload() : d.refresh} loading={!idle && d.loading}
            extra={<>{/* OLE / Dashboard / targets pages pick their lines on the page: no second line switch in the header */}
              {!idle && <LineSwitch line={line} onChange={onLineChange} />}{!idle && <ExportBar onExcel={doExport} />}<TvButton onClick={openTv} />{!idle && <LiveControl live={d.live} active={d.liveActive} onToggle={d.toggleLive} lastUpdated={d.lastUpdated} />}</>} />
        )}

        <MainTag className={embedded ? 'w-full flex flex-col gap-3' : 'lp-main flex-1 w-full px-3 lg:px-5 py-3 flex flex-col gap-3'}>
          {page === 'setup' ? <ErrorBoundary key="setup"><Suspense fallback={PAGE_FALLBACK}><SetupPage /></Suspense></ErrorBoundary> : (<>
          <BackupBanner line={line} />
          {d.error && !OWN_PERIOD_PAGES.includes(page) && describeLoadError(d.error).kind !== 'error' && (
            <LineOffline lineName={`Line ${line}`} error={d.error}
              onRetry={() => { d.clearError(); d.refresh(); }}
              otherLines={[...LINE_IDS.filter((x) => x !== String(line)).map((x) => [x, `Line ${x}`]), ['all', 'Main (all lines)']]}
              onPickLine={onLineChange} />
          )}
          {d.error && !OWN_PERIOD_PAGES.includes(page) && describeLoadError(d.error).kind === 'error' && (
            <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-xl px-3 py-2.5 text-fs-14 font-semibold flex items-center justify-between gap-2 shadow-sm">
              <span className="break-all">{d.error}</span>
              <button type="button" onClick={d.clearError} className="shrink-0 px-2.5 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 font-bold">
                Close
              </button>
            </div>
          )}

          {OWN_PERIOD_PAGES.includes(page) ? null : d.range ? (embedded ? null : (
            // Filters and outlier settings in one compact card (two thin rows). Live status is in the header.
            // 25-11-2026: on a phone the card folds behind one "Filters" line, so the page's numbers come first
            <PhoneFold summary={`${d.range.start === d.range.end ? d.range.start.split('-').reverse().join('-') : `${d.range.start.slice(8)}-${d.range.start.slice(5, 7)} → ${d.range.end.slice(8)}-${d.range.end.slice(5, 7)}`} · ${(d.companies || []).find((c) => String(c.CompanyId) === String(d.companyId))?.CompanyTitle || 'All companies'} · ${(d.models || []).find((m) => String(m.mmId) === String(d.mmId))?.model || 'All models'}`}>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
              {!embedded && <FilterBar bare
                companies={d.companies} models={d.models} companyId={d.companyId} mmId={d.mmId}
                onCompanyChange={d.changeCompany} onModelChange={d.changeModel}
                range={d.range} onRangeChange={d.changeRange}
                minQty={d.minQtyInput} onMinQtyChange={d.setMinQtyInput} latestDate={d.latestDate}
              />}
              {embedded ? (
                <details className="group">
                  <summary className="cursor-pointer select-none list-none px-3 py-1.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-50">
                    <span className="inline-block transition-transform group-open:rotate-90">›</span> Outlier settings <span className="font-normal text-slate-500">(max gap, min gap, idle)</span>
                  </summary>
                  <OutlierBar bare
                    outlier={d.outlier} onChange={d.setOutlier} onReset={() => d.setOutlier(d.outlierDefault)}
                    dayGaps={d.summary?.idleGaps} daySeconds={d.summary?.idleSeconds}
                    rangeGaps={d.daily?.days.reduce((a, x) => a + (x.idleGaps || 0), 0)}
                    rangeSeconds={d.daily?.days.reduce((a, x) => a + (x.idleSeconds || 0), 0)}
                  />
                </details>
              ) : (
              <OutlierBar bare
                outlier={d.outlier} onChange={d.setOutlier} onReset={() => d.setOutlier(d.outlierDefault)}
                dayGaps={d.summary?.idleGaps} daySeconds={d.summary?.idleSeconds}
                rangeGaps={d.daily?.days.reduce((a, x) => a + (x.idleGaps || 0), 0)}
                rangeSeconds={d.daily?.days.reduce((a, x) => a + (x.idleSeconds || 0), 0)}
              />
              )}
            </div>
            </PhoneFold>
          )) : (
            !d.error && !OWN_PERIOD_PAGES.includes(page) && (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm text-slate-700 text-fs-14 font-semibold py-16 flex items-center justify-center">
                Finding available data…
              </div>
            )
          )}

          {d.range && !d.summary && !d.error && !OWN_PERIOD_PAGES.includes(page) && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm text-slate-700 text-fs-14 font-semibold py-16 flex items-center justify-center">
              Loading dashboard…
            </div>
          )}

          {OWN_PERIOD_PAGES.includes(page) && (
            // OLE pages read the line databases / backup themselves for their own period: they do not wait for the scan data above
            <ErrorBoundary key={page}><Suspense fallback={PAGE_FALLBACK}>
              {page === 'dash' && <DashboardPage onOpen={setPage} canOpen={apages.map((p) => p.id)} />}
              {page === 'oleview' && <OleOverviewPage onOpen={setPage} canOpen={apages.map((p) => p.id)} />}
              {page === 'olecal' && <OleCalendarPage />}
              {page === 'olea' && <AvailabilityFocusPage />}
              {page === 'adash' && <FactorDashboardPage key="A" factor="A" />}
              {page === 'pdash' && <FactorDashboardPage key="P" factor="P" />}
              {page === 'olep' && <PerformanceFocusPage />}
              {page === 'oleq' && <QualityFocusPage />}
              {page === 'olemonth' && <OleMonthlyPage />}
              {page === 'entrydash' && <EntryDashboardPage onOpen={setPage} canOpen={apages.map((p) => p.id)} />}
              {page === 'oledrill' && <OleDrillPage />}
              {page === 'master' && !readOnly && <ModelMasterPage />}
              {page === 'reports' && !readOnly && <ReportsPage />}
              {page === 'repcmp' && !readOnly && <ReportComparePage />}
              {page === 'universe' && !readOnly && <ModelUniversePage />}
              {page === 'capa' && !readOnly && <CapaRegisterPage />}
              {page === 'ole' && <OlePage />}
              {page === 'oleentry' && <LossEntryPage canEdit={!readOnly} isAdmin={!readOnly} />}
              {page === 'qentry' && <QualityEntryPage canEdit={!readOnly} isAdmin={!readOnly} />}
              {page === 'lqentry' && <LossQualityEntryPage canEdit={!readOnly} isAdmin={!readOnly} />}
              {page === 'rca' && <RcaPage isAdmin={!readOnly} />}
              {(page === 'capaday' || page === 'idleday') && <DailyCapaPage key={page} kind={page === 'capaday' ? 'rework' : 'idle'} isAdmin={!readOnly} />}
              {page === 'daily' && <MorningEntryPage />}
              {page === 'kpientry' && <KpiEntryPage />}
              {page === 'kpidash' && <KpiDashboardPage />}
              {page === 'rwkdash' && <ReworkDashboardPage />}
              {page === 'serials' && <SerialsPage />}
              {page === 'custprod' && <CustomerProductionPage />}
              {page === 'qdash' && <QualityDashboardPage onOpen={setPage} canOpen={apages.map((p) => p.id)} />}
              {page === 'rcadash' && <RcaDashboardPage onOpen={setPage} canOpen={apages.map((p) => p.id)} />}
              {page === 'lossan' && <LossAnalysisPage onOpen={setPage} canOpen={apages.map((p) => p.id)} />}
              {(page === 'rejan' || page === 'rwkan') && <QualityAnalysisPage key={page} kind={page === 'rejan' ? 'reject' : 'rework'} onOpen={setPage} canOpen={apages.map((p) => p.id)} />}
              {page === 'quality' && <QualityPage isAdmin={!readOnly} />}
              {page === 'targetcheck' && <TargetCheckPage fixedLine={String(line)} canEdit={!readOnly} />}
              {page === 'linetargets' && <LineTargetsPage canEdit={!readOnly} />}
              {page === 'methodplan' && !readOnly && <MethodPlanPage canEdit />}
            </Suspense></ErrorBoundary>
          )}

          {d.summary && !OWN_PERIOD_PAGES.includes(page) && (
            <ErrorBoundary key={page}>
            <Suspense fallback={<div className="bg-white border border-slate-200 rounded-xl shadow-sm py-16 text-center text-fs-14 font-semibold text-slate-600">Loading page…</div>}>
            <div className="grid grid-cols-12 gap-3 items-start">
              {/* ───────── OVERVIEW: full dashboard on one screen ───────── */}
              {page === 'overview' && (
                <>
                  <div className="col-span-12">
                    {/* live card in the MES light colours on the page (TV mode keeps the look chosen on the TV) */}
                    <div data-tv-light="1" style={TV_LOOKS.mes.vars}>{liveLineEl}</div>
                  </div>
                  <div className="col-span-12">{targetBoard}</div>
                  {multi && shell('trend', 'col-span-12', { busy: d.rangeLoading })}
                  {/* the rest lives on its own page — no copies here */}
                  <nav aria-label="More for this line" className="col-span-12 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <span className="text-fs-14 font-semibold text-slate-600 mr-1">More for Line {line}:</span>
                    {[['hourly', 'Hourly analysis & loss register'], ['models', 'Model analysis'], ['control', 'Control charts'], ['rejection', 'Rejections']]
                      .filter(([id]) => apages.some((p) => p.id === id))
                      .map(([id, label]) => <button key={id} type="button" onClick={() => setPage(id)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-fs-14 font-semibold text-slate-800 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-800">{label} →</button>)}
                  </nav>
                </>
              )}


              {page === 'analysis' && (
                <div className="col-span-12">
                  <AnalysisView analysis={analysis} focusDate={d.focusDate} busy={d.dayLoading} onOpenSettings={readOnly ? null : () => setShowTakt(true)} />
                </div>
              )}

              {page === 'targets' && (
                <div className="col-span-12">
                  <TargetMethodsPage latestDate={d.latestDate} fixedLine={String(line)} />
                </div>
              )}

              {page === 'ai' && (
                <div className="col-span-12">
                  <AIAnalysisPage ctx={aiCtx} busy={d.loading} onPickHour={pickHour} />
                </div>
              )}

              {/* Hour-by-hour report: only the hourly matrix, the whole page (no hourly chart, no loss register here) */}
              {page === 'hourly' && shell('matrix', 'col-span-12', { busy: d.rangeLoading })}
              {page === 'rejection' && shell('rejection', 'col-span-12', { scroll: true, busy: d.dayLoading })}
              {page === 'distribution' && <div className="col-span-12"><DistributionPage a={an.data} takt={takt} loading={an.loading} error={an.error} /></div>}
              {page === 'pareto' && <div className="col-span-12"><ParetoPage a={an.data} takt={takt} loading={an.loading} error={an.error} onPickModel={pick} /></div>}
              {page === 'trends' && <div className="col-span-12"><TrendsPage a={an.data} summary={d.summary} takt={takt} focusDate={d.focusDate} loading={an.loading} error={an.error} /></div>}
              {page === 'control' && (
                <div className="col-span-12">
                  {/* Period, company and model come from the FilterBar above, so the page shows no duplicate filters. */}
                  <ControlChartsPage
                    line={line} companies={d.companies} latestDate={d.latestDate} takt={takt}
                    stds={stds} onSetStd={readOnly ? null : setTargetCycle}
                    targets={ls.targets}
                    range={d.range} company={d.companyId} model={d.mmId} onModelChange={d.changeModel}
                  />
                </div>
              )}
              {page === 'stdcycle' && (
                <div className="col-span-12">
                  {/* Own period buttons (2 months default). Model follows the FilterBar model when one is picked. */}
                  <StdCyclePage latestDate={d.latestDate} models={d.models} mmId={d.mmId} companyId={d.companyId} />
                </div>
              )}
              {page === 'formulas' && <div className="col-span-12"><FormulasPage takt={takt} outlier={d.outlier} minQty={d.minQty} line={String(line)} /></div>}
              {page === 'explorer' && (
                <div className="col-span-12">
                  {/* period from the filter bar; companies, lines, classes … are chosen on the page (several at once) */}
                  <ModelExplorerPage line={line} latestDate={d.latestDate} range={d.range} />
                </div>
              )}
              {page === 'models' && (
                <div className="col-span-12">
                  <ModelsPage a={an.data} takt={takt} loading={an.loading} error={an.error} onPickModel={pick} meta={d.models}
                    line={String(line)} range={d.range} companyId={d.companyId} targets={ls.targets}>
                    {shell('models', '', { busy: d.modelLoading ?? d.rangeLoading })}
                  </ModelsPage>
                </div>
              )}
            </div>
            </Suspense>
            </ErrorBoundary>
          )}
          </>)}
        </MainTag>

        {expanded && (
          <MesDrawer title={`${PANEL_TITLES[expanded]}${expanded === 'hourly' ? ` — ${fmtDate(d.focusDate)}` : ''}`} icon={Maximize2} onClose={() => setExpanded(null)} method="fullscreen" canExpand={false} bodyClass="p-4">
            {panels[expanded]}
          </MesDrawer>
        )}

        {editor && (
          <TargetsEditor line={line} tab={editor.tab} focus={editor.focus} models={d.models} avgCycle={avgCycleById} todayIds={todayIds}
            settings={lsMaster} onClose={() => setEditor(null)} />
        )}
        {showTakt && <TaktSettings settings={takt} models={d.modelData?.models} onSave={saveTakt} onClose={() => setShowTakt(false)}
          shift={lsMaster.shift} onOpenShift={() => { setShowTakt(false); setEditor({ tab: 'shift' }); }} onOpenTargets={() => { setShowTakt(false); setEditor({ tab: 'targets' }); }} />}

        <HourDrawer detail={d.hourDetail} loading={d.hourLoading} onClose={d.closeDrawer} shift={ls.shift} />
        {!readOnly && !embedded && !tvOnly && <MissingCycleWatch />}
        {tv && (
          <TvStage base={1280} fill title={`Line ${line}`} onClose={() => setTv(false)}>
            {liveLineEl ? React.cloneElement(liveLineEl, { tv: true, title: `Line ${line}` })
          : d.error ? <OfflineToday tv l={{ name: `Line ${line}`, error: d.error, backup: offlineInfo }} />
          : <div className="py-40 text-center text-fs-24 font-bold text-slate-300">Loading Line {line}…</div>}
          </TvStage>
        )}
      </div>
    </div>
  );
}

/* ───────────── management login: the pages the admin chose on the Setup page (read only) ───────────── */
const LINE_PAGE_IDS = new Set(MGMT_CATALOG.filter((p) => p.kind === 'line').map((p) => p.id));
function ManagementView() {
  useActivityLogout();   // activity log: this login's log out
  const { ui, loaded } = useUiSettings();
  const me = useAuth();   // a line login the admin allowed fills the OLE entries of its lines
  // Line 1–4 at the top: that line's full dashboard, the same pages the admin sees (read only). Main: the management pages.
  const [view, setView] = useState(() => (tvFromUrl() ? getLine() : 'all'));   // ?tv=2 opens Line 2 on the TV
  const [tv, setTv] = useState(() => tvFromUrl() && getLine() === 'all');
  const changeView = (l) => { setLine(l === 'all' ? 'all' : l); if (l !== 'all') setMline(l); setView(l); };
  // the OLE page is made for Line 1 & 2: a login without those lines does not get it
  // the pages turned on in Setup; Loss entry is read only for a login that may not fill (Users and passwords)
  // a login can have its own page list (Setup → Users & logins); otherwise the pages of Setup → Management view.
  // Every page counts only when it is ticked: Loss entry does not bring Quality entry with it (and the other way round).
  const own = Array.isArray(me?.pages) && me.pages.length ? me.pages : null;
  const base = own ? mgmtPages({ ...ui, management: { ...ui.management, pages: ui.management.pages.map((p) => ({ ...p, on: own.includes(p.id) })) } }) : mgmtPages(ui);
  const pages0 = base.filter((p) => !['ole', 'daily', 'qdash', 'adash', 'pdash', 'rwkdash', 'rcadash', 'kpidash', 'kpientry', 'lqentry', 'oleentry', 'qentry', 'rca', 'capaday', 'idleday', 'lossan', 'rejan', 'rwkan', 'dash', 'oleview', 'olea', 'olep', 'oleq', 'olecal', 'olemonth', 'entrydash', 'oledrill', 'quality'].includes(p.id) || OLE_LINES.some((l) => LINE_IDS.includes(l)));
  // Morning entry is the first job of the day: first in the list (and the page a supervisor opens on)
  const pages = [...pages0.filter((p) => p.id === 'daily'), ...pages0.filter((p) => p.id !== 'daily')];
  // FPY / RTY only for a login that has the Quality page (the admin chooses: Setup → Management view or the login's own pages)
  const seesQuality = pages.some((p) => p.id === 'quality');
  const [pageS, setPageS] = useState(null);                 // null = the home page chosen by the admin
  const page = pages.some((p) => p.id === pageS) ? pageS : pages.some((p) => p.id === ui.management.home) ? ui.management.home : pages[0]?.id;   // own list: first of it
  const [mline, setMline] = useState(() => (LINE_IDS.includes(getLine()) ? getLine() : LINE_IDS[0]));
  useActivityPage(view === 'all' ? page : null, pages.find((p) => p.id === page)?.label || page, LINE_PAGE_IDS.has(page) ? mline : 'all');   // activity log
  // the api layer must know the line before a line page mounts (also when the home page itself is a line page)
  const wantLine = LINE_PAGE_IDS.has(page) ? mline : 'all';
  if (getLine() !== wantLine) setLine(wantLine);
  const setPage = (p) => { setLine(LINE_PAGE_IDS.has(p) ? mline : 'all'); setPageS(p); };
  useOpenPageEvent(setPage, pages.map((p) => p.id));
  const [takt] = useTakt();
  const changeLine = (l) => { setLine(l); setMline(l); };
  const today = useMemo(todayStr, []);
  // one title per screen, in the header: the page and the lines of this login (the page itself has no second title)
  const title = pages.find((p) => p.id === page)?.label || 'Management';   // no '· Line 1 & 2' after the title
  if (view !== 'all') {
    if (getLine() !== view) setLine(view);
    const linePages = adminPages(ui, PAGES, SETUP_PAGE).filter((p) => p.id !== SETUP_PAGE.id);
    return <QualityCtx.Provider value={seesQuality}><Dashboard key={`line-${view}`} line={view} onLineChange={changeView} readOnly ui={ui} pagesOverride={(linePages.length ? linePages : PAGES).filter((p) => p.id !== 'quality' || seesQuality)} /></QualityCtx.Provider>;
  }
  return (
    <div className="min-h-screen flex bg-dixon-steel text-slate-950 antialiased font-sans">
      {tv && <TvStage base={1440} fill title={`Main — ${scopeLabel().toLowerCase() === 'all lines' ? 'all lines' : scopeLabel()}`} onClose={() => setTv(false)}><MainLive tv /></TvStage>}
      <Sidebar page={page} onChange={setPage} focusDate={today} loading={!loaded} pages={pages} brand={ui.brand} folders={ui.folders} />
      <div className="flex-1 min-w-0 flex flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <Header title={title} onRefresh={() => window.location.reload()} loading={false}
          extra={<TvButton onClick={() => setTv(true)} />} />   {/* no Line 1–4 / Main switch for management: its pages are in the sidebar, line pages have their own line buttons */}
        {/* Pages open with a short rise / fade (lp-anim); the live lines keep their own steady look */}
        <main className={`lp-main flex-1 w-full px-3 lg:px-5 py-3 flex flex-col gap-3${page === 'overview' || MAIN_LINE_PAGES.includes(page) ? '' : ' lp-anim'}`} data-page={page}>
          <BackupBanner line="all" />
          <QualityCtx.Provider value={seesQuality}>
          <ErrorBoundary key={page}>
            <Suspense fallback={PAGE_FALLBACK}>
              {page === 'overview' && <CommandView settings={ui.management.oneView} />}
              {page === 'live' && <MainLive />}
              {page === 'summary' && <MainOverview latestDate={today} simple />}
              {page === 'targets' && <TargetMethodsPage latestDate={today} />}
              {page === 'losses' && <LossRecordPage latestDate={today} />}
              {page === 'control' && <ControlChartsPage line="all" companies={[]} latestDate={today} takt={takt} stds={{}} />}
              {page === 'ai' && <MainAIPage today={today} />}
              {page === 'explorer' && <ModelExplorerPage line="all" latestDate={today} />}
              {page === 'targetcheck' && <TargetCheckPage />}
              {page === 'linetargets' && <LineTargetsPage />}
              {page === 'dash' && <DashboardPage onOpen={setPage} canOpen={pages.map((p) => p.id)} />}
              {page === 'oleview' && <OleOverviewPage onOpen={setPage} canOpen={pages.map((p) => p.id)} />}
              {page === 'olecal' && <OleCalendarPage />}
              {page === 'olea' && <AvailabilityFocusPage />}
              {page === 'adash' && <FactorDashboardPage key="A" factor="A" />}
              {page === 'pdash' && <FactorDashboardPage key="P" factor="P" />}
              {page === 'olep' && <PerformanceFocusPage />}
              {page === 'oleq' && <QualityFocusPage />}
              {page === 'olemonth' && <OleMonthlyPage />}
              {page === 'entrydash' && <EntryDashboardPage onOpen={setPage} canOpen={pages.map((p) => p.id)} />}
              {page === 'oledrill' && <OleDrillPage />}
              {page === 'ole' && <OlePage />}
              {page === 'oleentry' && <LossEntryPage canEdit={!!me?.oleEdit} />}
              {page === 'qentry' && <QualityEntryPage canEdit={!!me?.oleEdit} />}
              {page === 'lqentry' && <LossQualityEntryPage canEdit={!!me?.oleEdit} />}
              {page === 'reports' && <ReportsPage />}
              {page === 'rca' && <RcaPage myDept={me?.dept || ''} />}
              {page === 'daily' && <MorningEntryPage />}
              {page === 'kpientry' && <KpiEntryPage />}
              {page === 'kpidash' && <KpiDashboardPage />}
              {page === 'rwkdash' && <ReworkDashboardPage />}
              {page === 'serials' && <SerialsPage />}
              {page === 'qdash' && <QualityDashboardPage onOpen={setPage} canOpen={pages.map((p) => p.id)} />}
              {page === 'custprod' && <CustomerProductionPage />}
              {page === 'rcadash' && <RcaDashboardPage onOpen={setPage} canOpen={pages.map((p) => p.id)} />}
              {(page === 'capaday' || page === 'idleday') && <DailyCapaPage key={page} kind={page === 'capaday' ? 'rework' : 'idle'} isAdmin={false} />}
              {page === 'lossan' && <LossAnalysisPage onOpen={setPage} canOpen={pages.map((p) => p.id)} />}
              {(page === 'rejan' || page === 'rwkan') && <QualityAnalysisPage key={page} kind={page === 'rejan' ? 'reject' : 'rework'} onOpen={setPage} canOpen={pages.map((p) => p.id)} />}
              {page === 'quality' && <QualityPage onOpen={setPage} />}
              {LINE_PAGE_IDS.has(page) && <Dashboard key={`${mline}-${page}`} line={mline} onLineChange={changeLine} embedded readOnly pageProp={page} />}
            </Suspense>
          </ErrorBoundary>
          </QualityCtx.Provider>
        </main>
      </div>
    </div>
  );
}

/* ───────────── root: login first; admin picks the line (remounting reloads everything for that line) ───────────── */
function AdminApp() {
  useActivityLogout();   // activity log: this login's log out
  const [line, setLineState] = useState(getLine);
  const { ui } = useUiSettings();
  const change = (l) => { setLine(l); setLineState(l); }; // api layer must know the line before the new view mounts
  return line === 'all'
    ? <MainView key="all" line={line} onLineChange={change} ui={ui} />
    : <Dashboard key={line} line={line} onLineChange={change} ui={ui} />;
}

/* ───────────── TV login: pick a line once (remembered on this TV), then only its live animation, full screen ───────────── */
const TV_KEY = 'ems.tvline';
function TvApp() {
  if (typeof window !== 'undefined') window.__LP_TV__ = true;   // a TV login: a new version reloads this screen by itself (main.jsx)
  const [view, setView] = useState(() => {
    try { const q = new URLSearchParams(window.location.search).get('tv'); if (q === 'main') return 'all'; if (LINE_IDS.includes(q)) return q; } catch { /* old browser */ }
    try { const v = localStorage.getItem(TV_KEY); return v === 'all' || LINE_IDS.includes(v) ? v : null; } catch { return null; }
  });
  const pick = (v) => { if (v) setLine(v); try { if (v) localStorage.setItem(TV_KEY, v); else localStorage.removeItem(TV_KEY); } catch { /* storage blocked */ } setView(v); };
  if (view && getLine() !== view) setLine(view);   // the api layer must know the line before the screen mounts
  if (view === 'all') return <TvStage base={1440} fill title="Main — all lines" onClose={() => pick(null)} closeLabel="Change line"><MainLive tv /></TvStage>;
  if (view) return <Dashboard key={view} line={view} onLineChange={pick} readOnly tvOnly onExitTv={() => pick(null)} />;
  return (
    <div className="min-h-screen bg-blue-950 text-white flex flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <div className="text-fs-34 font-extrabold">TV screen</div>
        <div className="text-fs-18 text-sky-100">Which line does this TV show? It is remembered on this screen.</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4" role="group" aria-label="Pick the line">
        {[...LINE_IDS.map((l) => [l, `Line ${l}`]), ['all', 'All lines']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => pick(k)} className="rounded-2xl border-2 border-sky-400/50 bg-white/10 px-8 py-6 text-fs-28 font-extrabold hover:bg-sky-500/30 focus-visible:outline focus-visible:outline-4 focus-visible:outline-sky-300">{l}</button>
        ))}
      </div>
      <div className="rounded-xl bg-white px-3 py-2"><UserMenu /></div>
    </div>
  );
}

export default function App() {
  // a management login limited to some lines (lines chosen by the admin) remounts when its lines change
  return <><GlobalBusyBar /><AuthGate>{(auth) => (auth.role === 'admin' ? <AdminApp key={auth.user} /> : auth.role === 'tv' ? <TvApp key={auth.user} /> : <ManagementView key={`${auth.user}|${(auth.lines || []).join()}|${auth.oleEdit ? 1 : 0}|${auth.dept || ''}|${(auth.pages || []).join()}`} />)}</AuthGate></>;
}