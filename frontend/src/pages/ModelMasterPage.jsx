import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, ClipboardPaste, Download, Plus, Trash2, Save, Search, X, Target, RotateCcw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, LINE_IDS } from '../api';
import { readSheetFile, parseDelimited } from '../utils/sheetRead';
import { buildXlsx, downloadXlsx } from '../utils/xlsxWriter';
import { PageLoader } from '../components/Loader';
import { loadAutoTargets } from '../hooks/useAutoTargets';
import { setMasterRows, masterFor } from '../utils/targetMethods';

/*
 * Model master: company · model · target cycle time · the lines the model runs on.
 *   - Bulk import from Excel (.xlsx / .csv) or cells pasted from Excel, with a PREVIEW: every row marked New / Update /
 *     Same / Error, every cell can be edited, rows can be left out, lines can be given to all rows at once.
 *   - The master itself is edited in place (add, change, remove) and saved in one go.
 *   - One model can run on several lines.
 *   - "Set targets on lines": the cycle time of the master becomes the locked target ("Master") of the model on every
 *     line it is mapped to (matched by model name in that line's model list). Saved in line_settings.json only;
 *     the line databases are never written.
 */
const card = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const inp = 'h-8 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-fs-13 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40';
const btn = 'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-fs-13 font-bold transition disabled:opacity-50';
const btnW = `${btn} border-slate-300 bg-white text-slate-800 hover:bg-slate-50`;
const btnB = `${btn} border-blue-700 bg-blue-700 text-white hover:bg-blue-800`;
const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
const keyOf = (r) => `${norm(r.company)}|${norm(r.model)}`;
const newId = () => `m${Math.random().toString(36).slice(2, 12)}`;
const cyc = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.').replace(/[^0-9.]/g, '')));
const sameLines = (a, b) => [...(a || [])].sort().join(',') === [...(b || [])].sort().join(',');

/** "1, 2" / "Line 1 & Line 3" / "L1/L2" / "all" → [1, 2] */
function parseLines(v) {
  const s = String(v || '').trim();
  if (!s) return [];
  if (/^all/i.test(s)) return LINE_IDS.map(Number);
  return [...new Set((s.match(/\d+/g) || []).map(Number).filter((n) => LINE_IDS.includes(String(n))))].sort((a, b) => a - b);
}

/** the columns of an imported sheet: found from the header row by name, else the order Company · Model · Cycle · Lines */
const FIELDS = [
  ['company', 'Company', /company|customer|brand|make|party/i],
  ['model', 'Model', /model|item|product|sku/i],
  ['cycle', 'Cycle time (s)', /cycle|target|takt|\bct\b|sec/i],
  ['lines', 'Lines', /line/i],
  ['note', 'Note', /note|remark|comment/i],
  ['code', 'Material code', /material\s*code|mat\.?\s*code|item\s*code|^code$|sap/i],
  ['desc', 'Description', /desc/i],
  ['segment', 'Segment', /segment/i],
  ['capacity', 'Capacity', /capacit|\bkg\b/i],
  ['type', 'Glass / Plastic', /glass|plastic|^type$/i],
];
/** extra details of a model (kept in the master, shown and exported; not needed for the targets) */
const EXTRA = [['code', 'Material code', 'w-40'], ['desc', 'Description', 'w-72'], ['segment', 'Segment', 'w-20'], ['capacity', 'Capacity', 'w-20'], ['type', 'Glass / Plastic', 'w-24']];
const PAGE = 200;
/** 28-11-2026: how complete a master row is — company, model, cycle, lines and the 5 extra columns; a row not saved = 99 (top) */
const fillOf = (r) => (!r ? 99 : [r.company, r.model, Number(String(r.cycle ?? '').replace(',', '.')) > 0, (r.lines || []).length, ...EXTRA.map(([k]) => r[k])].filter((v) => v && String(v).trim() !== '').length);
function guessMap(rows) {
  const head = rows[0] || [];
  const map = {};
  FIELDS.forEach(([k, , re]) => { const i = head.findIndex((h, j) => re.test(h) && !Object.values(map).includes(j)); if (i >= 0) map[k] = i; });
  const hasHead = map.model != null;
  if (!hasHead) { map.company = 0; map.model = 1; map.cycle = 2; map.lines = 3; map.note = 4; }
  return { map, hasHead };
}

function LineChips({ value, onChange, small = false, label }) {
  return (
    <div className="flex flex-nowrap gap-1" role="group" aria-label={label}>
      {LINE_IDS.map((l) => {
        const on = (value || []).includes(Number(l));
        return (
          <button key={l} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== Number(l)) : [...(value || []), Number(l)].sort((a, b) => a - b))}
            className={`rounded-md border font-bold ${small ? 'px-1.5 py-0.5 text-fs-11' : 'px-2 py-1 text-fs-12'} ${on ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-100'}`}>L{l}</button>
        );
      })}
    </div>
  );
}

// 28-11-2026: readOnly — a view login sees and exports the master; it cannot change it (the server refuses writes too)
export default function ModelMasterPage({ readOnly = false }) {
  const [rows, setRows] = useState(null);       // the master as it is on the screen (edited)
  const [saved, setSaved] = useState([]);       // the master as saved on the server
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [lineF, setLineF] = useState('all');
  const [preview, setPreview] = useState(null); // { raw, map, hasHead, list, allLines, source }
  const [paste, setPaste] = useState(null);     // text of the paste box (null = closed)
  const [apply, setApply] = useState(null);     // result of "Set targets on lines"
  const fileRef = useRef(null);

  const load = async () => {
    setErr('');
    try { const j = await api.modelMaster({ fresh: true }); const r = (j?.rows || []).map((x) => ({ ...x })); setRows(r); setSaved(r); } catch (e) { setErr(`The master could not be read: ${e.message}`); setRows([]); }
  };
  useEffect(() => { load(); }, []);

  const dirty = rows && JSON.stringify(rows) !== JSON.stringify(saved);
  const problems = useMemo(() => {
    const out = {}; const seen = {};
    (rows || []).forEach((r) => {
      const p = [];
      if (!String(r.model || '').trim()) p.push('Model name is empty');
      const c = cyc(r.cycle);
      if (r.cycle !== '' && r.cycle != null && (!Number.isFinite(c) || c < 1 || c > 3600)) p.push('Cycle time must be 1 – 3600 s');
      const k = keyOf(r); if (seen[k]) p.push('Same company + model twice'); seen[k] = true;
      if (p.length) out[r.id] = p;
    });
    return out;
  }, [rows]);
  const nProb = Object.keys(problems).length;

  const savedById = useMemo(() => new Map((saved || []).map((x) => [x.id, x])), [saved]);
  const shown = useMemo(() => (rows || []).filter((r) => (lineF === 'all' || (lineF === 'none' ? !(r.lines || []).length : (r.lines || []).includes(Number(lineF))))
    && (!q || `${r.company} ${r.model} ${r.note || ''} ${r.code || ''} ${r.desc || ''} ${r.segment || ''} ${r.type || ''}`.toLowerCase().includes(q.toLowerCase())))
    // 28-11-2026: the properly filled models on top (by the saved row, so a row does not jump while it is typed in;
    // a new row not saved yet stays on top)
    .map((r, i) => ({ r, i, f: fillOf(savedById.get(r.id)) }))
    .sort((a, b) => b.f - a.f || a.i - b.i).map((x) => x.r), [rows, q, lineF, savedById]);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [q, lineF]);
  const [bulk, setBulk] = useState([]);   // lines to add to / remove from every row shown
  const bulkApply = (add) => { const ids = new Set(shown.map((r) => r.id)); setRows((rs) => rs.map((r) => (ids.has(r.id) ? { ...r, lines: (add ? [...new Set([...(r.lines || []), ...bulk])] : (r.lines || []).filter((x) => !bulk.includes(x))).sort((a, b) => a - b) } : r))); };

  const edit = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id) => setRows((rs) => rs.filter((r) => r.id !== id));
  const add = () => { setRows((rs) => [{ id: newId(), company: '', model: '', cycle: '', lines: [], note: '', code: '', desc: '', segment: '', capacity: '', type: '' }, ...rs]); setQ(''); setLineF('all'); };

  const save = async (list = rows) => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const body = list.map((r) => ({ ...r, cycle: r.cycle === '' || r.cycle == null ? null : cyc(r.cycle) }));
      const j = await api.saveModelMaster(body);
      const r = (j?.rows || []).map((x) => ({ ...x })); setRows(r); setSaved(r);
      setMsg(`Master saved · ${r.length} models`);
      loadAutoTargets(true).catch(() => {});   // Method D lines: new cycle times become their targets at once
      return true;
    } catch (e) { setErr(`Could not save: ${e.message}`); return false; } finally { setBusy(false); }
  };

  /* ── import ── */
  const startPreview = (raw, source) => {
    if (!raw.length) { setErr('The sheet is empty'); return; }
    const { map, hasHead } = guessMap(raw);
    setPreview({ raw, map, hasHead, source, allLines: [], show: 300, list: buildList(raw, map, hasHead) });
  };
  const buildList = (raw, map, hasHead) => {
    const body = hasHead ? raw.slice(1) : raw;
    return body.map((cells, i) => {
      const g = (k) => (map[k] != null && map[k] >= 0 ? String(cells[map[k]] ?? '').trim() : '');
      return { pid: i, use: true, company: g('company'), model: g('model'), cycle: g('cycle'), lines: parseLines(g('lines')), note: g('note'),
        ...Object.fromEntries(EXTRA.map(([k]) => [k, g(k)])) };
    }).filter((r) => r.model || r.company);   // rows with neither company nor model (empty / filler rows) are left out
  };
  const statusOf = (p, list) => {
    if (!String(p.model).trim()) return ['Error', 'Model name is empty'];
    const c = cyc(p.cycle);
    if (p.cycle !== '' && (!Number.isFinite(c) || c < 1 || c > 3600)) return ['Error', 'Cycle time must be 1 – 3600 s'];
    if (list.some((o) => o.use && o.pid < p.pid && keyOf(o) === keyOf(p))) return ['Error', 'Twice in this file'];
    const old = (rows || []).find((r) => keyOf(r) === keyOf(p));
    if (!old) return ['New', ''];
    const changed = [];
    if ((cyc(old.cycle) ?? null) !== (p.cycle === '' ? null : c)) changed.push(`cycle ${old.cycle ?? '—'} → ${p.cycle || '—'}`);
    if (p.lines.length && !sameLines(old.lines, p.lines)) changed.push(`lines ${(old.lines || []).join(',') || '—'} → ${p.lines.join(',')}`);
    if (p.note && p.note !== (old.note || '')) changed.push('note');
    const ex = EXTRA.filter(([k]) => p[k] && p[k] !== (old[k] || '')).map(([, l]) => l.toLowerCase());
    if (ex.length) changed.push(ex.join(', '));
    return changed.length ? ['Update', changed.join(' · ')] : ['Same', ''];
  };
  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setErr(''); setMsg('');
    try { startPreview(await readSheetFile(f), f.name); } catch (x) { setErr(String(x.message || x)); }
  };
  const confirmImport = async () => {
    const list = preview.list.filter((p) => p.use);
    const bad = list.filter((p) => statusOf(p, preview.list)[0] === 'Error');
    if (bad.length) { setErr(`${bad.length} row(s) have an error — fix them or untick them`); return; }
    const next = [...(rows || [])];
    for (const p of list) {
      const i = next.findIndex((r) => keyOf(r) === keyOf(p));
      const row = { company: p.company, model: p.model, cycle: p.cycle === '' ? null : cyc(p.cycle), note: p.note };
      const ex = Object.fromEntries(EXTRA.map(([k]) => [k, p[k] || '']));
      if (i >= 0) next[i] = { ...next[i], ...row, ...Object.fromEntries(EXTRA.filter(([k]) => p[k]).map(([k]) => [k, p[k]])), lines: p.lines.length ? p.lines : next[i].lines, note: p.note || next[i].note || '' };
      else next.push({ id: newId(), ...row, ...ex, lines: p.lines });
    }
    if (await save(next)) { setPreview(null); setMsg(`Imported ${list.length} rows · master saved (${next.length} models)`); }
  };

  /* ── export / template ── */
  const sheetOf = (list, name) => ({
    name, cols: [{ width: 18 }, { width: 26 }, { width: 20 }, { width: 44 }, { width: 10 }, { width: 10 }, { width: 13 }, { width: 14 }, { width: 12 }, { width: 26 }],
    rows: [['Company', 'Model', 'Material code', 'Description', 'Segment', 'Capacity', 'Glass/Plastic', 'Cycle time (s)', 'Lines', 'Note'].map((v) => ({ v, s: 'head' })),
      ...list.map((r) => [{ v: r.company || '', s: 'text' }, { v: r.model || '', s: 'textBold' }, ...['code', 'desc', 'segment', 'capacity', 'type'].map((k) => ({ v: r[k] || '', s: 'text' })),
        { v: r.cycle ?? '', s: r.cycle != null && r.cycle !== '' ? 'dec1' : 'text' }, { v: (r.lines || []).join(', '), s: 'text' }, { v: r.note || '', s: 'text' }])],
    freezeRow: 1, headerRow: 1, autoFilter: list.length ? `A1:J${list.length + 1}` : null,
  });
  const template = () => downloadXlsx(buildXlsx([sheetOf([{ company: 'SAMSUNG', model: 'WT70C4260GG', cycle: 14, lines: [1, 2], note: 'example — replace' }], 'Model master')]), 'Model master template.xlsx');
  const exportAll = () => downloadXlsx(buildXlsx([sheetOf(rows || [], 'Model master')]), `Model master ${new Date().toISOString().slice(0, 10)}.xlsx`);

  /* ── targets on the lines ── */
  const checkTargets = async () => {
    setBusy(true); setErr(''); setApply(null);
    try {
      const out = [];
      for (const l of LINE_IDS) {
        const mine = (rows || []).filter((r) => (r.lines || []).includes(Number(l)) && cyc(r.cycle) > 0);
        if (!mine.length) continue;
        let models = [];
        try { models = await api.lineModels(l); } catch (e) { out.push({ line: l, error: `Line ${l}: model list could not be read (${e.message})`, items: [], missing: mine.map((r) => r.model) }); continue; }
        // every model of the line is looked up in the master (the same matching as Method D: code, name, name part)
        setMasterRows(rows || []);
        const items = []; const hit = new Set();
        for (const m of models || []) {
          const mm = masterFor({ model: m.model, company: m.companyTitle, modelCode: m.modelCode });
          if (!mm || !(mm.lines || []).includes(Number(l)) || !(cyc(mm.cycle) > 0)) continue;
          hit.add(mm.id);
          items.push({ mmId: m.mmId, cycle: cyc(mm.cycle), model: m.model, company: m.companyTitle || mm.company, manual: true, source: 'master' });
        }
        const missing = mine.filter((r) => !hit.has(r.id)).map((r) => r.model);
        out.push({ line: l, items, missing });
      }
      setApply(out);
    } finally { setBusy(false); }
  };
  const doTargets = async () => {
    setBusy(true); setErr(''); let n = 0;
    try {
      for (const a of apply) { if (!a.items.length) continue; await api.saveLineSettings(a.line, { action: 'targets', items: a.items }); n += a.items.length; }
      setApply(null); setMsg(`${n} targets set on the lines from the master (shown as "Master", locked)`);
    } catch (e) { setErr(`Targets not saved: ${e.message}`); } finally { setBusy(false); }
  };

  if (!rows) return <PageLoader label="Reading the model master" steps={['Connecting to the server', 'Reading the master', 'Preparing the screen']} />;
  const counts = LINE_IDS.map((l) => [l, rows.filter((r) => (r.lines || []).includes(Number(l))).length]);

  return (
    <div className="flex flex-col gap-3" aria-label="Model master page">
      <section className={`${card} p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={onFile} aria-label="Excel or CSV file" />
            {!readOnly && <>
            <button type="button" className={btnB} onClick={() => fileRef.current?.click()}><Upload size={15} />Import Excel / CSV</button>
            <button type="button" className={btnW} onClick={() => setPaste('')}><ClipboardPaste size={15} />Paste from Excel</button>
            <button type="button" className={btnW} onClick={template}><Download size={15} />Template</button>
            </>}
            <button type="button" className={btnW} onClick={exportAll} disabled={!rows.length}><Download size={15} />Export</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-fs-13">
          <span className="rounded-md bg-slate-100 px-2.5 py-1 font-semibold">Models <b className="font-mono">{rows.length}</b></span>
          {counts.map(([l, n]) => <span key={l} className="rounded-md bg-slate-100 px-2.5 py-1 font-semibold">Line {l} <b className="font-mono">{n}</b></span>)}
          <span className="rounded-md bg-slate-100 px-2.5 py-1 font-semibold">No line <b className="font-mono">{rows.filter((r) => !(r.lines || []).length).length}</b></span>
          <span className="rounded-md bg-slate-100 px-2.5 py-1 font-semibold">No cycle time <b className="font-mono">{rows.filter((r) => !(cyc(r.cycle) > 0)).length}</b></span>
        </div>
      </section>

      {err && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-fs-13 font-semibold text-red-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{err}<button type="button" className="ml-auto" onClick={() => setErr('')} aria-label="Close"><X size={15} /></button></div>}
      {msg && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-fs-13 font-semibold text-emerald-800"><CheckCircle2 size={16} />{msg}<button type="button" className="ml-auto" onClick={() => setMsg('')} aria-label="Close"><X size={15} /></button></div>}

      {/* paste box */}
      {paste != null && (
        <section className={`${card} p-4`} aria-label="Paste from Excel">
          <div className="flex items-center justify-between gap-2"><h3 className="text-fs-16 font-extrabold">Paste from Excel</h3><button type="button" onClick={() => setPaste(null)} aria-label="Close paste"><X size={18} /></button></div>
          
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={8} aria-label="Pasted cells" className="mt-2 w-full rounded-lg border border-slate-300 p-2 font-mono text-fs-13" placeholder={'Company\tModel\tCycle time\tLines\nSAMSUNG\tWT70C4260GG\t14\t1,2'} />
          <div className="mt-2 flex gap-2"><button type="button" className={btnB} disabled={!paste.trim()} onClick={() => { startPreview(parseDelimited(paste), 'pasted cells'); setPaste(null); }}>Show preview</button></div>
        </section>
      )}

      {/* import preview */}
      {preview && (() => {
        const st = preview.list.map((p) => statusOf(p, preview.list));
        const used = preview.list.filter((p) => p.use);
        const c = { New: 0, Update: 0, Same: 0, Error: 0 };
        preview.list.forEach((p, i) => { if (p.use) c[st[i][0]] += 1; });
        const setP = (pid, patch) => setPreview((v) => ({ ...v, list: v.list.map((p) => (p.pid === pid ? { ...p, ...patch } : p)) }));
        const remap = (k, i) => setPreview((v) => { const map = { ...v.map, [k]: i }; return { ...v, map, list: buildList(v.raw, map, v.hasHead) }; });
        const head = preview.raw[0] || [];
        const ncol = Math.max(...preview.raw.map((r) => r.length));
        return (
          <section className={`${card} border-blue-300 p-4 ring-2 ring-blue-100`} aria-label="Import preview">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-fs-17 font-extrabold text-slate-900">Import preview <span className="text-fs-13 font-semibold text-slate-500">· {preview.source}</span></h3>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-fs-12 font-bold text-emerald-800">New {c.New}</span>
              <span className="rounded bg-blue-100 px-2 py-0.5 text-fs-12 font-bold text-blue-800">Update {c.Update}</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-fs-12 font-bold text-slate-700">Same {c.Same}</span>
              <span className={`rounded px-2 py-0.5 text-fs-12 font-bold ${c.Error ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-500'}`}>Error {c.Error}</span>
              <button type="button" className="ml-auto" onClick={() => setPreview(null)} aria-label="Cancel import"><X size={18} /></button>
            </div>
            {/* column mapping */}
            <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-2.5">
              <label className="flex items-center gap-1.5 text-fs-13 font-semibold"><input type="checkbox" checked={preview.hasHead} onChange={(e) => setPreview((v) => ({ ...v, hasHead: e.target.checked, list: buildList(v.raw, v.map, e.target.checked) }))} />First row is the header</label>
              {FIELDS.map(([k, label]) => (
                <label key={k} className="flex flex-col text-fs-12 font-bold text-slate-600">{label}
                  <select value={preview.map[k] ?? -1} onChange={(e) => remap(k, Number(e.target.value))} className="mt-0.5 h-8 rounded-md border border-slate-300 bg-white px-1.5 text-fs-13 font-semibold" aria-label={`Column for ${label}`}>
                    <option value={-1}>— not in file —</option>
                    {Array.from({ length: ncol }, (_, i) => <option key={i} value={i}>{preview.hasHead && head[i] ? head[i] : `Column ${String.fromCharCode(65 + (i % 26))}`}</option>)}
                  </select>
                </label>
              ))}
              <div className="flex flex-col text-fs-12 font-bold text-slate-600">Lines for every row
                <div className="mt-0.5 flex items-center gap-2"><LineChips small label="Lines for every row" value={preview.allLines} onChange={(v) => setPreview((p) => ({ ...p, allLines: v }))} />
                  <button type="button" className="h-7 rounded-md border border-slate-300 bg-white px-2 text-fs-12 font-bold hover:bg-slate-100" onClick={() => setPreview((p) => ({ ...p, list: p.list.map((x) => ({ ...x, lines: [...p.allLines] })) }))}>Give to all</button></div>
              </div>
            </div>
            <div className="mt-3 max-h-[52vh] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-fs-13">
                <thead className="sticky top-0 z-10 bg-slate-100"><tr className="text-left text-fs-12 text-slate-600">{['Use', 'Status', 'Company', 'Model', 'Cycle time (s)', 'Lines', ...EXTRA.filter(([k]) => preview.map[k] != null && preview.map[k] >= 0).map(([, l]) => l), 'Note'].map((h) => <th key={h} className="px-2 py-1.5 font-bold whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>
                  {preview.list.map((p, i) => {
                    if (i >= preview.show) return null;
                    const [s, why] = st[i];
                    const tone = s === 'New' ? 'bg-emerald-100 text-emerald-800' : s === 'Update' ? 'bg-blue-100 text-blue-800' : s === 'Error' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-600';
                    return (
                      <tr key={p.pid} className={`border-t border-slate-100 ${p.use ? '' : 'opacity-40'} ${s === 'Error' && p.use ? 'bg-red-50/60' : ''}`}>
                        <td className="px-2"><input type="checkbox" checked={p.use} onChange={(e) => setP(p.pid, { use: e.target.checked })} aria-label={`Use row ${i + 1}`} /></td>
                        <td className="px-2 py-1"><span className={`rounded px-1.5 py-0.5 text-fs-11 font-bold ${tone}`} title={why}>{s}</span>{why && <div className="max-w-[180px] truncate text-fs-11 text-slate-500" title={why}>{why}</div>}</td>
                        <td className="px-1 py-1"><input className={inp} value={p.company} onChange={(e) => setP(p.pid, { company: e.target.value })} aria-label={`Company row ${i + 1}`} /></td>
                        <td className="px-1 py-1"><input className={inp} value={p.model} onChange={(e) => setP(p.pid, { model: e.target.value })} aria-label={`Model row ${i + 1}`} /></td>
                        <td className="w-28 px-1 py-1"><input className={`${inp} font-mono`} inputMode="decimal" value={p.cycle} onChange={(e) => setP(p.pid, { cycle: e.target.value })} aria-label={`Cycle time row ${i + 1}`} /></td>
                        <td className="px-1 py-1"><LineChips small label={`Lines row ${i + 1}`} value={p.lines} onChange={(v) => setP(p.pid, { lines: v })} /></td>
                        {EXTRA.filter(([k]) => preview.map[k] != null && preview.map[k] >= 0).map(([k, l, w]) => <td key={k} className="px-1 py-1"><input className={`${inp} ${w}`} value={p[k] || ''} onChange={(e) => setP(p.pid, { [k]: e.target.value })} aria-label={`${l} row ${i + 1}`} /></td>)}
                        <td className="px-1 py-1"><input className={inp} value={p.note} onChange={(e) => setP(p.pid, { note: e.target.value })} aria-label={`Note row ${i + 1}`} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {preview.list.length > preview.show && <button type="button" className="mt-1 text-fs-13 font-bold text-blue-700 hover:underline" onClick={() => setPreview((v) => ({ ...v, show: v.show + 300 }))}>Showing {preview.show} of {preview.list.length} rows — show 300 more (all rows are imported)</button>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className={btnB} disabled={busy || !used.length || c.Error > 0} onClick={confirmImport}><Save size={15} />Import {used.length} rows into the master</button>
              <button type="button" className={btnW} onClick={() => setPreview(null)}>Cancel</button>
              <span className="text-fs-12 text-slate-500">New rows are added; a model already in the master (same company + model) is updated. Empty lines in the file keep the lines already in the master.</span>
            </div>
          </section>
        );
      })()}

      {/* the master */}
      <section className={`${card} p-4`} aria-label="Master list">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1"><Search size={15} className="absolute left-2.5 top-2.5 text-slate-400" /><input className={`${inp} h-9 pl-8`} placeholder="Search company, model, material code, segment …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the master" /></div>
          <select value={lineF} onChange={(e) => setLineF(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-fs-13 font-semibold" aria-label="Show line">
            <option value="all">All lines</option>{LINE_IDS.map((l) => <option key={l} value={l}>Line {l}</option>)}<option value="none">No line yet</option>
          </select>
          {readOnly && <span className="rounded-md bg-slate-100 px-2.5 py-1 text-fs-12 font-semibold text-slate-600">View only</span>}
          {!readOnly && <button type="button" className={btnW} onClick={add}><Plus size={15} />Add model</button>}
          {!readOnly && <button type="button" className={btnW} disabled={busy || dirty || !rows.length} onClick={checkTargets} title={dirty ? 'Save the master first' : 'Cycle time of the master → locked target on the mapped lines'}><Target size={15} />Set targets on lines</button>}
        </div>
        {!rows.length ? <p className="mt-6 text-center text-fs-14 text-slate-500">The master is empty — import an Excel file, paste cells or add a model.</p> : (
          <div className="mt-3 max-h-[64vh] overflow-auto rounded-lg border border-slate-200">
            <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <table className="w-full text-fs-13">
              <thead className="sticky top-0 z-10 bg-slate-100"><tr className="text-left text-fs-12 text-slate-600">{['#', 'Company', 'Model', 'Cycle time (s)', 'Pcs / hr', 'Lines', ...EXTRA.map(([, l]) => l), 'Note', ''].map((h, i) => <th key={i} className="px-2 py-1.5 font-bold whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {shown.slice(0, limit).map((r, i) => {
                  const p = problems[r.id]; const changed = JSON.stringify(r) !== JSON.stringify(saved.find((x) => x.id === r.id));
                  const c = cyc(r.cycle);
                  return (
                    <tr key={r.id} className={`border-t border-slate-100 ${p ? 'bg-red-50/60' : changed ? 'bg-amber-50/60' : ''}`}>
                      <td className="px-2 font-mono text-fs-12 text-slate-400">{i + 1}</td>
                      <td className="px-1 py-1"><input className={inp} value={r.company || ''} onChange={(e) => edit(r.id, { company: e.target.value })} aria-label={`Company of ${r.model || 'new model'}`} /></td>
                      <td className="px-1 py-1" style={{ minWidth: 170 }}><input className={`${inp} font-bold`} value={r.model || ''} title={r.model || ''} onChange={(e) => edit(r.id, { model: e.target.value })} aria-label={`Model name ${i + 1}`} />{p && <div className="text-fs-11 font-semibold text-red-700">{p.join(' · ')}</div>}</td>
                      <td className="w-28 px-1 py-1"><input className={`${inp} font-mono`} inputMode="decimal" value={r.cycle ?? ''} onChange={(e) => edit(r.id, { cycle: e.target.value })} aria-label={`Cycle time of ${r.model || 'new model'}`} /></td>
                      <td className="px-2 font-mono text-slate-600">{c > 0 ? Math.round(3600 / c) : '—'}</td>
                      <td className="px-1 py-1"><LineChips small label={`Lines of ${r.model || 'new model'}`} value={r.lines || []} onChange={(v) => edit(r.id, { lines: v })} /></td>
                      {EXTRA.map(([k, l, w]) => <td key={k} className="px-1 py-1"><input className={`${inp} ${w}`} value={r[k] || ''} onChange={(e) => edit(r.id, { [k]: e.target.value })} aria-label={`${l} of ${r.model || 'new model'}`} title={r[k] || ''} /></td>)}
                      <td className="px-1 py-1"><input className={inp} value={r.note || ''} onChange={(e) => edit(r.id, { note: e.target.value })} aria-label={`Note of ${r.model || 'new model'}`} /></td>
                      <td className="px-1"><button type="button" onClick={() => remove(r.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700" aria-label={`Remove ${r.model || 'row'}`} title="Remove (saved when you save the master)"><Trash2 size={15} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </fieldset>
            {shown.length > limit && <button type="button" className="w-full bg-slate-50 py-2 text-fs-13 font-bold text-blue-700 hover:bg-slate-100" onClick={() => setLimit((n) => n + PAGE)}>Showing {limit} of {shown.length} — show {Math.min(PAGE, shown.length - limit)} more</button>}
          </div>
        )}
        {rows.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-fs-13">
            <span className="font-bold text-slate-700">Lines for the {shown.length} models shown{q || lineF !== 'all' ? ' (search / filter)' : ''}:</span>
            <LineChips small label="Lines for the models shown" value={bulk} onChange={setBulk} />
            <button type="button" className="h-7 rounded-md border border-slate-300 bg-white px-2 text-fs-12 font-bold hover:bg-slate-100 disabled:opacity-50" disabled={!bulk.length || !shown.length} onClick={() => bulkApply(true)}>Add to all shown</button>
            <button type="button" className="h-7 rounded-md border border-slate-300 bg-white px-2 text-fs-12 font-bold hover:bg-slate-100 disabled:opacity-50" disabled={!bulk.length || !shown.length} onClick={() => bulkApply(false)}>Remove from all shown</button>
          </div>
        )}
      </section>

      {/* set targets on the lines: what will happen, then confirm */}
      {apply && (
        <section className={`${card} border-blue-300 p-4 ring-2 ring-blue-100`} aria-label="Targets from the master">
          <div className="flex items-center justify-between gap-2"><h3 className="text-fs-17 font-extrabold">Set targets on the lines from the master</h3><button type="button" onClick={() => setApply(null)} aria-label="Close targets"><X size={18} /></button></div>
          {!apply.length ? <p className="mt-2 text-fs-13 text-slate-600">No model of the master has both a cycle time and a line.</p> : (
            <>
              <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {apply.map((a) => (
                  <div key={a.line} className="rounded-lg border border-slate-200 p-3">
                    <div className="text-fs-15 font-extrabold">Line {a.line}</div>
                    {a.error ? <div className="text-fs-13 font-semibold text-red-700">{a.error}</div> : <div className="text-fs-13"><b className="font-mono text-emerald-700">{a.items.length}</b> targets will be set</div>}
                    {a.missing.length > 0 && <div className="mt-1 text-fs-12 text-slate-500" title={a.missing.slice(0, 60).join(', ')}><b>{a.missing.length}</b> master models are not made on this line (not in its model list)</div>}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className={btnB} disabled={busy || !apply.some((a) => a.items.length)} onClick={doTargets}><Target size={15} />Set {apply.reduce((s, a) => s + a.items.length, 0)} targets</button>
                <span className="text-fs-12 text-slate-500">The target is locked ("Master"): it is used instead of the automatic Method A target until it is changed in the master or on the line.</span>
              </div>
            </>
          )}
        </section>
      )}

      {/* save bar */}
      {dirty && !readOnly && (
        <div className="sticky bottom-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 shadow-lg">
          <span className="text-fs-13 font-bold text-amber-900">Unsaved changes{nProb ? ` · ${nProb} row(s) to fix` : ''}</span>
          <button type="button" className={`${btnB} ml-auto`} disabled={busy || nProb > 0} onClick={() => save()}><Save size={15} />Save master</button>
          <button type="button" className={btnW} disabled={busy} onClick={() => { setRows(saved); setMsg(''); }}><RotateCcw size={15} />Undo changes</button>
        </div>
      )}
    </div>
  );
}
