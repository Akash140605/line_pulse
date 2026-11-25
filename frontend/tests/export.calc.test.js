// Calculation tests for chart axes (src/utils/axisTicks.js) and the exports
// (src/utils/stdReport.js, src/utils/xlsxWriter.js, src/utils/exportExcel.js).
import { describe, it, expect } from 'vitest';
import { axisTicks, qtyAxisFor, secondsTicks, secLabel } from '../src/utils/axisTicks';
import { dmy, dmyTime, REPORT_COLUMNS, reportMeta, reportHtml } from '../src/utils/stdReport';
import { colName, zebra, STYLE, buildXlsx } from '../src/utils/xlsxWriter';
import { buildSheets } from '../src/utils/exportExcel';
import day from './fixtures/day_overview.json';
import range from './fixtures/range_overview.json';
import analytics from './fixtures/analytics.json';

const sum = (a) => a.reduce((s, v) => s + v, 0);

describe('axisTicks (quantity axis from a base)', () => {
  it('daily: base 1000, one step below a low day', () => {
    expect(axisTicks(1500, 1000, 200, 1002).ticks).toEqual([800, 1000, 1200, 1400, 1600]);      // 1002 → 800
    expect(axisTicks(1500, 1000, 200, 1200).ticks).toEqual([1000, 1200, 1400, 1600]);           // high enough → base
    expect(axisTicks(1300, 1000, 200, 850).ticks).toEqual([600, 800, 1000, 1200, 1400]);        // 850 → 600
  });
  it('top tick is the first step at or above the maximum', () => {
    const a = axisTicks(1400, 1000, 200, 1100);
    expect(a.ticks).toEqual([1000, 1200, 1400]);
    expect(a.domain).toEqual([1000, 1400]);
  });
  it('hourly: base 100, step 20; never below 0', () => {
    expect(axisTicks(150, 100, 20, 40).ticks).toEqual([20, 40, 60, 80, 100, 120, 140, 160]);
    expect(axisTicks(150, 100, 20, 5).ticks[0]).toBe(0);
  });
  it('no data keeps a valid range', () => {
    expect(axisTicks(0, 1000, 200).ticks).toEqual([1000, 1200]);
    expect(axisTicks(NaN, 100, 20, null).domain).toEqual([100, 120]);
  });
  it('fromZero: 0, then the base and its steps', () => {
    expect(axisTicks(1300, 1000, 200, null, { fromZero: true }).ticks).toEqual([0, 1000, 1200, 1400]);
    expect(axisTicks(0, 100, 20, null, { fromZero: true }).ticks).toEqual([0, 100]);
  });
  it('qtyAxisFor ignores zeros and non-numbers', () => {
    expect(qtyAxisFor([0, 1002, 1500, null, 'x'], 1000, 200).ticks).toEqual([800, 1000, 1200, 1400, 1600]);
    expect(qtyAxisFor([], 1000, 200).ticks).toEqual([1000, 1200]);
    // fixture: daily quantities 818 … 865 → min 818 → (818 − 100) / 200 → 600
    expect(qtyAxisFor(range.daily.days.map((d) => d.quantity), 1000, 200).ticks).toEqual([600, 800, 1000]);
    // fixture: hourly 70 … 81 → (70 − 10) / 20 = 3 → 60 ; max 81 → 100
    expect(qtyAxisFor(day.hourly.hours.map((h) => h.quantity), 100, 20).ticks).toEqual([60, 80, 100]);
  });
});

describe('secondsTicks / secLabel', () => {
  it('round steps, 0 first, last tick ≥ max', () => {
    expect(secondsTicks(22).ticks).toEqual([0, 10, 20, 30]);
    expect(secondsTicks(4).ticks).toEqual([0, 1, 2, 3, 4]);
    expect(secondsTicks(20).ticks).toEqual([0, 5, 10, 15, 20]);
    expect(secondsTicks(100).ticks).toEqual([0, 30, 60, 90, 120]);
    expect(secondsTicks(3600).ticks).toEqual([0, 900, 1800, 2700, 3600]);
    expect(secondsTicks(20000).ticks).toEqual([0, 7200, 14400, 21600]);
  });
  it('no / invalid max → 0 … 10 s', () => {
    expect(secondsTicks(0).ticks).toEqual([0, 5, 10]);
    expect(secondsTicks(-5).domain).toEqual([0, 10]);
    expect(secondsTicks(null).domain).toEqual([0, 10]);
  });
  it('labels: seconds below 2 min, minutes from 2 min', () => {
    expect([0, 45, 90, 119].map(secLabel)).toEqual(['0s', '45s', '90s', '119s']);
    expect([120, 150, 130, 600].map(secLabel)).toEqual(['2m', '2.5m', '2.2m', '10m']);
    expect(secLabel(NaN)).toBe('');
  });
});

describe('stdReport', () => {
  it('dates', () => {
    expect(dmy('2026-10-23')).toBe('23-10-2026');
    expect(dmy('2026-10-23 10:00:00')).toBe('23-10-2026');
    expect(dmy('')).toBe('—');
    expect(dmy(null)).toBe('—');
    expect(dmy('abc')).toBe('abc');
    expect(dmyTime(new Date(2026, 9, 5, 7, 3))).toBe('05-10-2026 07:03');
  });
  it('report columns: row number, one-decimal values, B vs A', () => {
    const col = (h) => REPORT_COLUMNS.find((c) => c[0] === h)[2];
    expect(col('#')({}, 4)).toBe(5);
    expect(col('Standard A (s)')({ aStd: 16.04 })).toBe(16);
    expect(col('Standard B (s)')({ bStd: 12.36 })).toBe(12.4);
    expect(col('B vs A (%)')({ diff: -12.345 })).toBe(-12.3);
    expect(col('B vs A (%)')({ diff: null })).toBeNull();
    expect(col('B vs A (%)')({ diff: NaN })).toBeNull();
    expect(col('Weight source')({})).toBe('not set');
  });
  const meta = {
    lineLabel: 'Line 1', start: '2026-08-24', end: '2026-10-23', generatedAt: new Date(2026, 9, 23, 9, 5), count: 1, overallA: 16,
    bDone: false, query: '', settings: { minSec: 1, maxSec: 22, minPieces: 200, maxRework: 3, breakSec: 300 },
  };
  it('meta lines', () => {
    const m = Object.fromEntries(reportMeta(meta));
    expect(m.Period).toBe('24-08-2026 to 23-10-2026');
    expect(m['Method A window']).toBe('1 – 22 s (gaps outside are ignored)');
    expect(m['Method B runs']).toMatch(/not computed/);
    expect(m.Filter).toBeUndefined();
    const m2 = Object.fromEntries(reportMeta({ ...meta, bDone: true, query: 'wt' }));
    expect(m2['Method B runs']).toBe('≥ 200 pcs per run · ≤ 3 rework pcs · run breaks at a stop > 300 s');
    expect(m2.Filter).toBe('"wt"');
  });
  it('printable HTML escapes text and formats numbers', () => {
    const html = reportHtml([{ model: 'A<B & C', code: 'X1', n: 1234, aStd: 16, diff: 2.5 }], meta);
    expect(html).toContain('A&lt;B &amp; C');
    expect(html).toContain('1,234');
    expect(html).toContain('+2.5');
    expect(html).toContain('<td class="n a">16.0</td>');
    expect(reportHtml([], { ...meta, overallA: null })).toContain('No models');
  });
});

/* ── an independent ZIP reader for the .xlsx checks ── */
const CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) >>> 0 : c >>> 1; t.push(c >>> 0); }
  return t;
})();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = (CRC[(c ^ x) & 0xFF] ^ (c >>> 8)) >>> 0; return (c ^ 0xFFFFFFFF) >>> 0; };
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
  const count = dv.getUint16(eocd + 10, true), cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
  expect(cdOff + cdSize).toBe(eocd);
  const files = {};
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 20, true), nameLen = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    expect(dv.getUint32(off, true)).toBe(0x04034b50);
    const lNameLen = dv.getUint16(off + 26, true), lExtra = dv.getUint16(off + 28, true);
    const data = bytes.subarray(off + 30 + lNameLen + lExtra, off + 30 + lNameLen + lExtra + size);
    expect(crc32(data)).toBe(crc);
    files[name] = new TextDecoder().decode(data);
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return files;
}

describe('xlsxWriter', () => {
  it('column names', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
  it('zebra style ids', () => {
    expect(zebra('title')).toBe(STYLE.title);           // not a body style → unchanged
    expect(zebra('text')).toBe(17);                     // 17 base styles, text (6) is the first zebra copy
    expect(zebra('valueB')).toBe(24);
  });
  it('builds a valid ZIP with correct CRCs, cell values and escaping', () => {
    const bytes = buildXlsx([{
      name: "Std 'Cycle'", title: 'T', cols: [{ width: 10 }],
      rows: [[{ v: 'a<b & "c"', s: 'text' }, { v: 1.5, s: 'dec1' }], [null, { v: NaN, s: 'int' }, { v: '', s: 'text' }]],
      merges: ['A1:B1'], headerRow: 1, freezeRow: 1, autoFilter: 'A1:C2',
    }]);
    const f = unzip(bytes);
    expect(Object.keys(f).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    const s = f['xl/worksheets/sheet1.xml'];
    expect(s).toContain('<c r="B1" s="9"><v>1.5</v></c>');
    expect(s).toContain('a&lt;b &amp; &quot;c&quot;');
    expect(s).toContain('<c r="B2" s="8" t="inlineStr"><is><t xml:space="preserve">NaN</t></is></c>'); // non-finite → text, never <v>NaN</v>
    expect(s).toContain('<c r="C2" s="6"/>');
    expect(s).toContain('<dimension ref="A1:C2"/>');
    expect(s).toContain('<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>');
    expect(f['xl/workbook.xml']).toContain("'Std ''Cycle'''!$A$1:$C$2");
    expect(f['xl/workbook.xml']).toContain("'Std ''Cycle'''!$1:$1");
  });
});

describe('exportExcel.buildSheets (fixtures)', () => {
  const sheets = buildSheets({
    range: { start: '2026-10-01', end: '2026-10-05' }, focusDate: '2026-10-05',
    filters: { outlierMode: 'fixed', outlierMax: 300, outlierMin: 1 }, settings: { taktSec: 45, startHour: 9, endHour: 21, lunchHour: 13 },
    summary: day.hourly, daily: range.daily, modelData: range.models, analytics,
  });
  const info = Object.fromEntries(sheets.Info.map((r) => [r.Parameter, r.Value]));

  it('hourly sheet: producing hours only, quantities add up to the day total', () => {
    expect(sheets['Hourly (focus day)']).toHaveLength(11);
    expect(sum(sheets['Hourly (focus day)'].map((r) => r.Qty))).toBe(day.hourly.totalQuantity);
    const h12 = sheets['Hourly (focus day)'].find((r) => r.Hour === '12:00-13:00');
    expect(h12['Line idle (min)']).toBe(0.5);                    // 30 s
  });
  it('daily / model sheets add up to the range total', () => {
    expect(sum(sheets.Daily.map((r) => r.Qty))).toBe(range.daily.totalQuantity);
    expect(sum(sheets.Models.map((r) => r.Qty))).toBe(range.daily.totalQuantity);
    expect(sheets.Daily.find((r) => r.Date === '2026-10-03')['Model gap time (min)']).toBe(120);   // 7200 s
  });
  it('histogram sheet: bin edges and counts', () => {
    const H = sheets.Histogram;
    expect(H).toHaveLength(20);
    expect([H[6]['From (s)'], H[6]['To (s)'], H[6].Count]).toEqual([30, 35, 629]);
    expect(sum(H.map((r) => r.Count))).toBe(analytics.overall.n);
  });
  it('info sheet describes the filters', () => {
    expect(info['Outlier filter']).toBe('Fixed > 300s');
    expect(info['Working window']).toBe('9:00-21:00 (lunch 13)');
    expect(Object.fromEntries(buildSheets({ filters: { outlierMode: 'off' } }).Info.map((r) => [r.Parameter, r.Value]))['Outlier filter']).toBe('Off');
    expect(Object.fromEntries(buildSheets({ filters: { outlierMode: 'auto', outlierMult: 3 } }).Info.map((r) => [r.Parameter, r.Value]))['Outlier filter']).toBe('Auto > 3 x median (max 300s)');
  });
});
