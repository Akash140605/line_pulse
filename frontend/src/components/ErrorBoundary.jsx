import React from 'react';
import { notePageError, currentPage } from '../utils/activityTrack';

/**
 * A crash in one page must never blank the whole dashboard.
 * 25-11-2026: the error is noted in the activity log for the admin (Setup → Activity log → Page errors), and
 * "Copy details" gives the exact text (page, build, message, where) to send on.
 */
export default class ErrorBoundary extends React.Component {
  state = { err: null, info: null, copied: false };
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('Page error:', err); this.setState({ info }); notePageError(err, info); }
  details() {
    const { err, info } = this.state; const p = currentPage();
    return [`Page: ${p.title || p.page || '—'}`, `Build: ${window.__LP_BUILD__ || '—'}`, `Time: ${new Date().toLocaleString('en-IN')}`, `Error: ${String(err?.message || err)}`,
      String(err?.stack || '').split('\n').slice(1, 5).join('\n'), String(info?.componentStack || '').split('\n').filter((x) => x.trim()).slice(0, 4).join('\n')].filter(Boolean).join('\n');
  }
  copy = () => {
    const t = this.details();
    const done = () => { this.setState({ copied: true }); setTimeout(() => this.setState({ copied: false }), 2000); };
    try { navigator.clipboard.writeText(t).then(done, () => { window.prompt('Copy the details', t); }); } catch { window.prompt('Copy the details', t); }
  };
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="col-span-12 bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-fs-14 text-red-800" role="alert" data-testid="page-error">
        <div className="font-extrabold text-fs-16 mb-1">An error occurred on this page</div>
        <div className="font-mono break-all mb-2">{String(this.state.err?.message || this.state.err)}</div>
        <div className="mb-2 text-fs-12 text-red-700">The admin can see this error in Setup → Activity log → Page errors.</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => this.setState({ err: null, info: null })} className="px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 font-bold">Retry</button>
          <button type="button" onClick={this.copy} className="px-3 py-1.5 rounded-lg border border-red-300 bg-white hover:bg-red-200 font-bold">{this.state.copied ? 'Copied' : 'Copy details'}</button>
        </div>
      </div>
    );
  }
}
