import { normEntry } from './ole';
/** The lines and the six quality stages of the plant's SAWM KPI report (small: used by Setup and the entry pages too). */
export const KPI_LINES = [
  { line: '1', fa: 'FA-01', sap: 1018, label: 'Line-1(C8)' },
  { line: '2', fa: 'FA-02', sap: 1018, label: 'Line-2(C8)' },
  { line: '3', fa: 'FA-03', sap: 1004, label: 'Line-3(C3)' },
  { line: '4', fa: 'FA-04', sap: 1004, label: 'Line-4(C2)' },
];
export const KPI_STAGES = ['HVIR', 'Leakage Inspection', 'Functional', 'Front Inspection', 'Pre-Final Inspection', 'Final Inspection'];

/** Stage (0 … 5) of a quality station by its name or code; null = none of the six. */
export function stageOf(name, code = '') {
  const s = `${name || ''} ${code || ''}`.toLowerCase();
  if (/hvir|hi[\s-]?pot|high[\s-]?volt|electrical safety|\bir\b/.test(s)) return 0;
  if (/leak/.test(s)) return 1;
  if (/function|\bfunc\b|run\s*\/?\s*performance|performance test|run test/.test(s)) return 2;
  if (/front|\blqc\b|line quality/.test(s)) return 3;
  if (/pre[\s-]?final/.test(s)) return 4;
  if (/final|\bfqc\b|\boqc\b|packing audit/.test(s)) return 5;
  return null;
}


/** stage (0 … 5) of a saved entry's station: the admin's station (name / old name / code) → its stage, else by the text */
export function stageLookup(stations = []) {
  const look = new Map();
  for (const s of stations || []) {
    const st = stageOf(s.reason, s.code);
    look.set(String(s.reason || '').toLowerCase(), st);
    for (const a of s.aliases || []) look.set(String(a).toLowerCase(), st);
    if (s.code) look.set(String(s.code).toLowerCase(), st);
  }
  return (name) => { const k = String(name || '').toLowerCase(); return look.has(k) ? look.get(k) : stageOf(name); };
}

/**
 * The FTY & RTY sheet of the KPI report on screen (19-11-2026): every day and line that made pieces —
 * production, defects (rejection + rework), dismantle (KPI entry, else the pieces marked dismantled on the quality rows), defects per stage, stage FPY = 1 − defects ÷ production,
 * RTY = Π stage FPY. rows(oleRange days) → [{ date, line, label, qty, defects, dismantle, stages[6], fpy[6], rty }]
 */
export function ftyRows(days, ids, stations = [], kpi = {}) {
  const st = stageLookup(stations);
  const out = [];
  for (const d of days || []) for (const l of ids) {
    const L = d.byLine?.[l];
    if (!L?.ok) continue;
    const rows = (L.rows || []).filter((r) => !r.closed && !r.future);
    const qty = rows.reduce((a, r) => a + (r.qty || 0), 0);
    if (!(qty > 0)) continue;
    const stages = [0, 0, 0, 0, 0, 0]; let defects = 0; let dis = 0;
    for (const r of rows) {
      const e = r.e || normEntry(r.entry);
      for (const x of [...(e.rejects || []), ...(e.rework || [])]) { const n = Number(x.qty) || 0; defects += n; dis += Number(x.dismantle) || 0; const s = st(x.station); if (s != null) stages[s] += n; }
    }
    const fpy = stages.map((n) => 1 - n / qty);
    const k = KPI_LINES.find((x) => x.line === String(l));
    out.push({ date: d.date, line: String(l), label: k?.label || `Line-${l}`, qty, defects, dismantle: kpi?.[`${d.date}|${l}`]?.dismantle ?? (dis || null), stages, fpy, rty: fpy.reduce((a, v) => a * v, 1) });
  }
  return out;
}

/**
 * 20-11-2026: the plant's "PAD Print Defect Tag" — the defects of each inspection stage (KPI stage index → defects)
 * and the defects for which the machine is dismantled ("Dismantle" sheet). Setup → Quality stations → "Use the defect
 * tag list" puts them on the stations; the entry ticks "Dismantled" by itself for a dismantle defect.
 */
export const DEFECT_TAG = {
  0: ['HV fail', 'IR fail'],
  1: ['Seal bellow leakage', '3 way leak', 'Drain assy leak', 'Drain belt stuck in CT', 'Drain cap leakage', '2 way leak', 'Tub assy leak', 'Brake belt stuck in CT'],
  2: ['Pulsator touching', 'Angle NG', 'Gear box noise', 'Brake belt broken', 'Pulsator warpage', 'No Buzzer', 'Pulley Noise', 'Lid spring miss/noise', 'Spin motor not work', 'No Power', 'S T Loose', 'Water selector NG', 'Wash motor not work', 'V Belt miss', 'S T fitting NG', 'Brake rod lock open NG', 'No Wiring', 'Wiring Wrong', 'Supply Not Cut', 'Panel fitment NG'],
  3: ['Tub scratch', 'Base flow mark', 'Base short mold/broken', 'Tub flow mark', 'Sticker miss', 'CT flow mark/scratch', 'Tub Sink mark', 'Tub short mold/broken'],
  4: ['CT lock NG', 'CT screw miss', 'Printing NG', 'Base scratch/black line', 'Knob scratch', 'Balancer screw miss', 'Panel scratch/black line', 'Pulsator Scratch'],
  5: ['Base screw miss', 'Panel flow mark', 'Manual miss', 'CT screw miss', 'Filter miss', 'Pulsator cap miss', 'Panel screw miss', 'Dirty'],
};
export const DISMANTLE_DEFECTS = ['Tub leakage', 'Tub flow mark', 'Base flow mark', 'Seal bellow leakage', 'Gear box leakage', 'Drain assy leakage', 'Drain short mould', 'Base breakage', 'Control table breakage'];
const tidyD = (s) => String(s || '').toLowerCase().replace(/leakage/g, 'leak').replace(/[^a-z0-9]+/g, ' ').trim();
const DIS = new Set(DISMANTLE_DEFECTS.map(tidyD));
/** a defect for which the machine is dismantled (Tub leak, Drain assy leak, Base breakage …) */
export const isDismantleDefect = (name) => DIS.has(tidyD(name)) || (/\bleak/.test(tidyD(name)) && /\b(tub|drain assy|seal bellow|gear box)\b/.test(tidyD(name)));

/**
 * 25-11-2026: the assembly stages of a period (Quality dashboard): pieces made, defects found at each of the six stages,
 * stage FPY = 1 − defects ÷ pieces, RTY = Π stage FPY (as the SAWM KPI "FTY & RTY" sheet), defects at no known stage.
 * rows = ftyRows(...) (optionally of one line) → { qty, defects, stages[6], fpy[6], rty, unmapped }
 */
export function stageSummary(rows = []) {
  const qty = rows.reduce((a, r) => a + (r.qty || 0), 0);
  const stages = [0, 0, 0, 0, 0, 0];
  let defects = 0;
  for (const r of rows) { defects += r.defects || 0; (r.stages || []).forEach((n, i) => { stages[i] += n || 0; }); }
  const fpy = stages.map((n) => (qty > 0 ? 1 - n / qty : null));
  const rty = qty > 0 ? fpy.reduce((a, v) => a * v, 1) : null;
  return { qty, defects, stages, fpy, rty, unmapped: Math.max(0, defects - stages.reduce((a, n) => a + n, 0)) };
}

/**
 * 25-11-2026: the detail of one assembly stage (Quality dashboard → click a stage): the rework / rejection rows of the
 * period (reworkSheet rows) caught at that stage. idx = 0 … 5, or -1 = rows at no known stage. line = '' (all) or one line.
 * → { rows, total, dismantle, withCause, defects, models, lines, cats, days, hours: [{ key, total, dismantle }] most first (hours / days in order) }
 */
export function stageDetail(sheetRows = [], stations = [], idx = 0, line = '') {
  const st = stageLookup(stations);
  const rows = (sheetRows || []).filter((r) => { const s = r.stage ? st(r.stage) : null; return (idx < 0 ? s == null : s === idx) && (!line || String(r.line) === String(line)); });
  const group = (keyOf) => {
    const m = new Map();
    for (const r of rows) for (const [k, n, d] of keyOf(r)) { const o = m.get(k) || { key: k, total: 0, dismantle: 0 }; o.total += n; o.dismantle += d; m.set(k, o); }
    return [...m.values()];
  };
  const one = (f) => (r) => [[f(r) || '—', r.total, r.dismantle || 0]];
  const most = (a) => a.sort((p, q) => q.total - p.total || String(p.key).localeCompare(String(q.key)));
  return {
    rows,
    total: rows.reduce((a, r) => a + r.total, 0),
    dismantle: rows.reduce((a, r) => a + (r.dismantle || 0), 0),
    withCause: rows.filter((r) => r.cause).reduce((a, r) => a + r.total, 0),
    defects: most(group(one((r) => r.defect))),
    models: most(group(one((r) => r.model))),
    lines: most(group(one((r) => String(r.line)))),
    cats: most(group(one((r) => r.cat))),
    stations: most(group(one((r) => r.stage))),
    days: group(one((r) => r.date)).sort((p, q) => p.key.localeCompare(q.key)),
    hours: group((r) => Object.entries(r.hours || {}).map(([h, n]) => [Number(h), n, 0])).sort((p, q) => p.key - q.key),
  };
}
