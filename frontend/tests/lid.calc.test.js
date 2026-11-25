// Calculation tests for the Control charts "Model-wise summary" additions:
//   achievedCycle (src/utils/spc.js)  — the whole second with the most valid cycles (tallest bar of the 1-second histogram)
//   lidType       (src/utils/lid.js)  — full glass / half glass / glass / no glass, from the master list or the model name
import { describe, it, expect } from 'vitest';
import { achievedCycle } from '../src/utils/spc';
import { lidType, LID, lidFromText } from '../src/utils/lid';

describe('achievedCycle — tallest bar of the 1-second histogram', () => {
  it('uses the same bins as the histogram: second s holds (s−1, s]', () => {
    // 14.2 → 15 · 14.9 → 15 · 15.0 → 15 · 15.1 → 16 · 13.0 → 13
    const a = achievedCycle([14.2, 14.9, 15.0, 15.1, 13.0]);
    expect(a.sec).toBe(15);
    expect(a.count).toBe(3);
    expect(a.share).toBeCloseTo(60, 6);
    expect(a.label).toBe('15 s');
    expect(a.range).toBe('14–15 s');
  });
  it('covered = every valid cycle at the achieved second or faster (pieces and share); target from achieved', () => {
    // achieved 15 s: 13.0 (→13) + 14.2, 14.9, 15.0 (→15) are ≤ 15 s; 15.1 (→16) is slower
    const a = achievedCycle([14.2, 14.9, 15.0, 15.1, 13.0]);
    expect(a.upTo).toBe(4);
    expect(a.upToShare).toBeCloseTo(80, 6);
    expect(a.targetPph).toBe(240);
    const b = achievedCycle([16, 16, 16, 14, 14, 30]);
    expect([b.sec, b.count, b.upTo]).toEqual([16, 3, 5]);   // 14 s pieces are faster → covered too; 30 s is not
  });
  it('a tie goes to the faster second', () => {
    expect(achievedCycle([12, 12, 18, 18, 20]).sec).toBe(12);
  });
  it('whole-second data (most lines) is counted as is', () => {
    expect(achievedCycle([16, 16, 16, 14, 14, 30]).sec).toBe(16);
  });
  it('no valid cycles → null', () => {
    expect(achievedCycle([])).toBe(null);
    expect(achievedCycle(null)).toBe(null);
  });
  it('real-sized sample stays fast and exact', () => {
    const vals = [];
    for (let i = 0; i < 50000; i++) vals.push(10 + (i % 13) + (i % 7 === 0 ? 0.5 : 0));
    const t = Date.now();
    const a = achievedCycle(vals);
    expect(Date.now() - t).toBeLessThan(200);
    const counts = {};
    for (const v of vals) { const s = Math.ceil(v); counts[s] = (counts[s] || 0) + 1; }
    const best = Math.max(...Object.values(counts));
    expect(a.count).toBe(best);
  });
});

describe('lidFromText — words used in the master list', () => {
  it('half glass spellings', () => {
    for (const t of ['FA WM T5B4 AKAI AKSA-75DBHG HALF GLASS', 'FA WM FELTRON T9B9 HALFGLASS FIPL80SWMRG', 'FA WM T4B4 VEWTRON VTW7020TFLR HGLASS',
      'FA WM T9B9 LIFEBIRD LBR80GLSBK1 H.GLASS', 'FA WM T10B10 AKAI AKSA-125DRFG H.GL', 'FA WM T7B7 SHARP ES-SD120NB-HS HGL', 'FA WM KENSTAR T9B9 H.GLA WM KSAZ685HG-BG']) {
      expect(lidFromText(t)).toBe('half');
    }
  });
  it('full glass spellings', () => {
    for (const t of ['FA WM T3B2 AKAI AKSA-85DRTG FULL GLASS', 'FA WM T2B2 BELTEK BTK-10001-FG FULLGLASS', 'FA WM T2B2 BELTEK BTK-10003-FG FULL GLAS',
      'FA WM P2 KELVINATOR KWS-N10EFTKD F.GL DG', 'FA WM T7B7 SHARP ES-SD140NB-GS FGL']) {
      expect(lidFromText(t)).toBe('full');
    }
  });
  it('glass without the type', () => {
    for (const t of ['FA WM T5B4 DAIWA D75WMG01A (GLASS)', 'FA WM LLOYD T4B4 LWMS65BE1 - BLUE (GL)', 'FA WM T5B4 TELESTONE SA-TWD75BLHG GL LID', 'FA WM T2B1 VOLTAS GLASS BL WTT80DBLG']) {
      expect(lidFromText(t)).toBe('glass');
    }
  });
  it('no lid word → null (the model name may still give a hint)', () => {
    expect(lidFromText('FA WM T1B1 SAMSUNG WT70C3000RR')).toBe(null);
  });
});

describe('lidType — master list first, then the model name, then manual', () => {
  it('master list words win', () => {
    expect(lidType({ model: 'AKSA-85DRTG' })).toMatchObject({ type: 'full', source: 'list' });
    expect(lidType({ model: 'ES-SD80NB-HS' })).toMatchObject({ type: 'half', source: 'list' });
    expect(lidType({ model: 'WTT80DBLG' }).type).toBe('glass');
  });
  it('model name hint when the list has no lid word: FG = full, HG = half, GL / TG = glass', () => {
    expect(lidType({ model: 'AKSA-85DGBFG' })).toMatchObject({ type: 'full', source: 'name' });
    expect(lidType({ model: 'AKSA-70DBHG' })).toMatchObject({ type: 'half', source: 'name' });
    expect(lidType({ model: 'SA-TWD90BKFG' }).type).toBe('full');
    expect(lidType({ model: 'KSAZ6120HG-BG' }).type).toBe('half');
    expect(lidType({ model: 'PRISHA7501DGL' }).type).toBe('glass');
  });
  it('model in the master list without any glass word or hint → no glass', () => {
    expect(lidType({ model: 'WT70C3000RR', modelCode: '1N57' })).toMatchObject({ type: 'none', source: 'list' });
  });
  it('model not in the list and no hint → unknown', () => {
    expect(lidType({ model: 'ZZ-UNKNOWN-123' })).toMatchObject({ type: null, source: null });
  });
  it('manual value from the page always wins', () => {
    expect(lidType({ model: 'AKSA-85DRTG' }, 'half')).toMatchObject({ type: 'half', source: 'manual' });
    expect(lidType({ model: 'AKSA-85DRTG' }, 'none')).toMatchObject({ type: 'none', source: 'manual' });
    expect(lidType({ model: 'AKSA-85DRTG' }, '')).toMatchObject({ type: 'full', source: 'list' });
  });
  it('every type has a symbol and a label', () => {
    for (const k of ['full', 'half', 'glass', 'none', 'unknown']) {
      expect(LID[k].sym.length).toBeGreaterThan(0);
      expect(LID[k].label.length).toBeGreaterThan(0);
    }
    expect(new Set(Object.values(LID).map((x) => x.sym)).size).toBe(5);
  });
});

describe('names with a space before "/" are found in the master list (lid and weight)', () => {
  it('WTT80DBLG /BLSSWH5GBDE', async () => {
    const { weightInfo } = await import('../src/config/modelWeights');
    expect(lidType({ model: 'WTT80DBLG /BLSSWH5GBDE', modelCode: '1200759' }).source).toBe('list');
    expect(weightInfo({ model: 'WTT80DBLG /BLSSWH5GBDE', modelCode: '1200759' }).kg).toBe(8);
  });
});

describe('more master-list spellings', () => {
  it('"GLAS" (missing S) is glass; "70DLIM 5" finds "WTT70DLIM5 K"', async () => {
    const { weightInfo } = await import('../src/config/modelWeights');
    expect(lidFromText('FA WM T2B1 VOLTAS GLAS BL WTT80DBLG/FLRS')).toBe('glass');
    expect(weightInfo({ model: '70DLIM 5', modelCode: '1200751' }).kg).toBe(7);
  });
});
