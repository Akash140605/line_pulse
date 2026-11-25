import { clearCaches } from './freshStart';

const DEPLOY = 'ems.lastDeploy';   // the last deploy id this browser ran (dev server)
// New version on the server: every 2 min the build id is read.
//   dist build (index.html sets window.__LP_BUILD__): ./version.json against that id.
//   dev server (npm run dev, :5173 — the screens open 192.168.2.111:5173): src is served live, so the id of the last
//   deploy (/dist/version.json, written with every update) is read once at start and watched for a change (
//   TVs on the dev server never got the new code when Vite's live reload could not reach them).
// A TV screen (TV mode, the TV login, ?tv=) and any screen nobody has touched for 10 min reload by themselves; a screen
// in use gets a small "New version — Refresh" bar instead (nothing typed is lost). A TV also reloads once it has been
// open for 6 h (safety net), when nobody is typing.
export function watchVersion({ everyMs = 2 * 60 * 1000 } = {}) {
  if (typeof window === 'undefined' || window.location.protocol === 'file:') return;
  const built = window.__LP_BUILD__ || null;
  const url = built ? 'version.json' : '/dist/version.json';
  let base = built;
  const born = Date.now();
  let shown = false;
  let lastUse = Date.now();
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, () => { lastUse = Date.now(); }, { passive: true, capture: true });
  const bar = () => {
    if (shown) return; shown = true;
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'New version of Line Pulse — click to refresh';
    b.setAttribute('style', 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;background:#0B2545;color:#fff;font:600 14px Poppins,Arial,sans-serif;padding:10px 18px;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.25);border:0;cursor:pointer');
    b.onclick = () => { clearCaches(); window.location.reload(); };
    document.body.appendChild(b);
  };
  const isTv = () => !!document.querySelector('[role="dialog"][aria-label^="TV mode"]') || !!window.__LP_TV__ || /[?&]tv=/.test(window.location.search);
  const check = async () => {
    const tv = isTv();
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    let fresh = false;
    try {
      const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      if (j?.build) {
        if (!base) {
          base = j.build;
          // dev server: a deploy this browser has not seen yet — what it kept from the old code goes, and the screen
          // is drawn once more without it (dist builds do this at start: freshStart with the build id)
          if (!built) {
            let seen = null; try { seen = localStorage.getItem(DEPLOY); localStorage.setItem(DEPLOY, j.build); } catch { /* storage blocked */ }
            if (seen && seen !== j.build && clearCaches() > 0) { window.location.reload(); return; }
          }
        } else fresh = j.build !== base;
      }
    } catch { /* offline for a moment, or no version file: try again next time */ }
    const old = tv && Date.now() - born > 6 * 3600 * 1000;
    if (!fresh && !old) return;
    const idle = Date.now() - lastUse > 10 * 60 * 1000;
    // a new version: the numbers kept from the old one go first (they would show old targets until they expire)
    if ((tv || idle) && !typing) { if (fresh) clearCaches(); window.location.reload(); } else if (fresh) bar();
  };
  if (!built) check();   // dev server: the id of the code just loaded
  setInterval(check, everyMs);
}
