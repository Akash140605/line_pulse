// Screen refresh (Setup → Screen refresh): src/utils/refreshConfig.js, ui settings, the new ready themes
import { describe, it, expect } from 'vitest';
import { normalizeRefresh, setRefreshConfig, refreshSec, refreshMs, REFRESH_DEFAULT } from '../src/utils/refreshConfig';
import { normalizeUi } from '../src/utils/uiSettings';
import { THEME_PRESETS, contrastWithWhite } from '../src/utils/themeEngine';

describe('screen refresh', () => {
  it('defaults 20 s · 10 s · 60 s; limits kept; junk ignored', () => {
    expect(normalizeRefresh(null)).toEqual(REFRESH_DEFAULT);
    expect(normalizeRefresh({ ole: 2, dash: 9999, masters: 'x' })).toEqual({ ole: 10, dash: 300, masters: 60 });
    expect(normalizeRefresh({ ole: '45' }).ole).toBe(45);
  });
  it('the pages read the admin value', () => {
    setRefreshConfig({ ole: 60, dash: 30 });
    expect([refreshSec('ole'), refreshMs('dash'), refreshSec('masters')]).toEqual([60, 30000, 60]);
    setRefreshConfig(null);
    expect(refreshSec('ole')).toBe(20);
  });
  it('kept in the ui settings', () => {
    expect(normalizeUi({}).refresh).toEqual(REFRESH_DEFAULT);
    expect(normalizeUi({ refresh: { ole: 30 } }).refresh.ole).toBe(30);
  });
});

describe('ready themes', () => {
  it('nine looks; white text readable on every header and menu', () => {
    expect(Object.keys(THEME_PRESETS).length).toBeGreaterThanOrEqual(9);
    for (const [k, p] of Object.entries(THEME_PRESETS)) {
      expect(contrastWithWhite(p.primary ?? '#0B3A74'), k).toBeGreaterThanOrEqual(4.5);
      expect(contrastWithWhite(p.sidebar ?? '#0B2545'), k).toBeGreaterThanOrEqual(4.5);
    }
  });
});
