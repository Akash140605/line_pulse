import React from 'react';
import { createRoot } from 'react-dom/client';
import { watchVersion } from './utils/versionWatch';
import { freshStart } from './utils/freshStart';
import App from './App.jsx';
import './index.css';
import { syncServerTime, hasSavedClock } from './utils/serverTime';
import { applySavedTheme } from './utils/themeEngine';
import { normalizeUi } from './utils/uiSettings';
import { api } from './api';
import { leaveDevServer } from './utils/fastLink';
import { Bar } from 'recharts';

// 25-11-2026: a chart with one or two bars (one day, one month) never draws them wall-wide — a bar is at most 64 px
// (a chart that sets its own maxBarSize keeps it)
try { Bar.defaultProps = { ...(Bar.defaultProps || {}), maxBarSize: 64 }; } catch { /* another Recharts */ }

// :5173 (development server, slow) → the built copy on :8080; TVs stay where they are (utils/fastLink.js)
if (!leaveDevServer()) boot();

function boot() {
  // a version this browser has not run yet: the numbers it kept from the old version (targets, line data) are dropped first
  freshStart();
  // the theme kept in this browser goes on before the first paint (the server copy follows in useUiSettings)
  try { applySavedTheme(normalizeUi(JSON.parse(localStorage.getItem('ems.ui') || '{}')).theme); } catch { /* private window */ }
  // …and the server copy right away (no login needed), so the login screen of a new browser has the plant's look too
  api.uiSettings().then((j) => {
    if (!j) return;
    const n = normalizeUi(j);
    applySavedTheme(n.theme);
    // the admin's setup (target method of every line) is kept here at once: TV and management screens never open the
    // setup, and their targets must be worked out with the rule the admin saved (Method D), not an old copy or the default
    try { localStorage.setItem('ems.ui', JSON.stringify(n)); } catch { /* storage blocked */ }
  }).catch(() => { /* offline: keep the local look */ });

  // Is PC ki ghadi galat ho sakti hai: pehle DB server ka time le lo (max 3 s ruko), phir screen banao.
  // Har 5 min mein dobara sync, taaki "aaj" / "abhi" hamesha DB ke hisaab se rahe.
  const render = () => createRoot(document.getElementById('root')).render(<App />);
  // A clock offset from an earlier visit (kept 12 h) is used at once: the screen is drawn without waiting, the fresh time follows.
  if (hasSavedClock()) { syncServerTime(); render(); }
  else Promise.race([syncServerTime(), new Promise((r) => setTimeout(r, 3000))]).finally(render);
  setInterval(syncServerTime, 5 * 60 * 1000);

  // a new version on the server reloads the TVs (and idle screens); the others get a refresh bar (utils/versionWatch.js)
  watchVersion();
}
