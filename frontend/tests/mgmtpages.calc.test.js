// Management review pages (utils/uiSettings.js normalizeUi): switched on once for an older Setup (mgmtV < 2), then the admin's choice stays.
import { describe, it, expect } from 'vitest';
import { normalizeUi, mgmtPages, MGMT_CATALOG, MGMT_REVIEW, MGMT_DEFAULT_ON } from '../src/utils/uiSettings';

const ids = MGMT_CATALOG.map((p) => p.id);
const onOf = (ui) => ui.management.pages.filter((p) => p.on).map((p) => p.id);

describe('management review pages', () => {
  it('every review page is a management page and on by default', () => {
    for (const id of MGMT_REVIEW) { expect(ids).toContain(id); expect(MGMT_DEFAULT_ON).toContain(id); }
    const d = normalizeUi({});
    for (const id of ['qdash', 'rwkdash', 'rcadash', 'kpidash', 'oleview', 'reports']) expect(onOf(d)).toContain(id);
  });
  it('an older Setup gets the review pages switched on once, its own pages and home kept', () => {
    const old = normalizeUi({ management: { pages: ids.map((id) => ({ id, on: id === 'live' })), home: 'live' } });
    const on = onOf(old);
    for (const id of MGMT_REVIEW) expect(on).toContain(id);
    expect(on).toContain('live');
    expect(old.management.home).toBe('live');
    expect(old.mgmtV).toBe(2);
  });
  it('after the migration a review page switched off stays off', () => {
    const old = normalizeUi({ management: { pages: ids.map((id) => ({ id, on: true })) } });
    const next = { ...old, management: { ...old.management, pages: old.management.pages.map((p) => (p.id === 'rcadash' ? { ...p, on: false } : p)) } };
    expect(onOf(normalizeUi(next))).not.toContain('rcadash');
  });
  it('mgmtPages lists the review dashboards for a management login', () => {
    const list = mgmtPages(normalizeUi({})).map((p) => p.id ?? p);
    for (const id of ['qdash', 'rwkdash', 'rcadash']) expect(list).toContain(id);
  });
});
