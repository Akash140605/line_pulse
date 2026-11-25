import { activityNote } from '../api';

/**
 * 25-11-2026: every file Line Pulse gives (Excel, CSV, PDF, the screen as Excel, the CAPA form …) is written to the
 * activity log: which report (the page open), which file, of which days and lines (Setup → Activity log). Many
 * downloads by one login in a short time raise a security alert for the admin (backend api/activity.php).
 * One hook for all of them: a link with "download" that is clicked (by the user or by the code).
 */
const DATE = /(\d{4})-(\d{2})-(\d{2})/g;
export function rangeOf(name = '') {
  const d = [...String(name).matchAll(DATE)].map((m) => `${m[3]}-${m[2]}-${m[1]}`);
  return d.length ? (d.length > 1 && d[0] !== d[d.length - 1] ? `${d[0]} – ${d[d.length - 1]}` : d[0]) : '';
}
export function lineOf(name = '') {
  const m = String(name).match(/Line[\s_-]*(\d{1,2}(?:\s*[,&]\s*\d{1,2})*)/i);
  return m ? m[1].replace(/\s+/g, '') : /all lines|all_lines|plant/i.test(name) ? 'all' : '';
}
const kindOf = (name = '') => { const e = String(name).split('.').pop().toLowerCase(); return ['xlsx', 'xls', 'csv', 'pdf', 'txt', 'png', 'docx', 'html'].includes(e) ? e : 'file'; };
const pageTitle = () => (document.querySelector('header h1')?.textContent || document.title || '').trim().slice(0, 80);

let last = { k: '', t: 0 };
export function noteDownload(fileName) {
  const name = String(fileName || '').slice(0, 120);
  const k = name; const now = Date.now();
  if (k === last.k && now - last.t < 1500) return;   // the same file twice in a moment: once
  last = { k, t: now };
  activityNote({ action: 'download', report: pageTitle(), file: name, range: rangeOf(name), line: lineOf(name), kind: kindOf(name) });
}

let installed = false;
export function installDownloadLog() {
  if (installed || typeof window === 'undefined' || !window.HTMLAnchorElement) return;
  installed = true;
  const click = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function patchedClick(...a) {
    try { if (this.hasAttribute('download')) noteDownload(this.getAttribute('download') || this.href); } catch { /* never in the way */ }
    return click.apply(this, a);
  };
  // a real click on a download link (RCA evidence …)
  document.addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[download]');
    if (a && e.isTrusted) noteDownload(a.getAttribute('download') || a.href);
  }, true);
}
