import React, { useMemo, useState } from 'react';
import { Card } from '../components/UiKit';
import { windowHours } from '../utils/analysis';
import { fmtSeconds, LINE_IDS } from '../api';
import { useAllLineSettings } from '../hooks/useLineSettings';
import useUiSettings from '../hooks/useUiSettings';
import { lineCfg, masterLoadedAt } from '../utils/targetMethods';
import { normShift, fmtMin, fmtDur, realCycleSec, workSecInHour } from '../utils/shift';
import { oleOf, oleConfig } from '../utils/ole';

/**
 * Admin: "How it's calculated" — every number of the software with its formula, in plain words, where it is set,
 * the settings in force right now (shift master, target method of each line) and worked examples that are computed with
 * the same code as the screens (so the example can never disagree with the screens).
 * Opened from Main (all lines) and from a line (then the line's analysis settings are shown too).
 */

// [name, formula, plain words, where it is set]
const S = (key, title, sub, items, short = title) => ({ key, title, sub, items, short });
const SECTIONS = [
  S('live', 'Live screen & TV', 'The line card, the TV and Plant overview — today, live.', [
    ['Produced today', 'COUNT of good scans of the line today (Status ≠ FALSE)', 'Every good scan is one piece. "Today" is the date of the database server, not of this PC.', ''],
    ['This hour', 'COUNT of good scans in the running clock hour', 'Scans inside the lunch window are shown as lunch, not as output of the hour.', ''],
    ['Hour target (live)', 'working seconds of the hour gone so far × share of pieces with a target ÷ target cycle of those models', 'Lunch and tea breaks are not working seconds. It rises through the hour. Several models in one hour: their target cycles weighted by their pieces. A model without a target adds nothing to the target.', 'Setup → Masters → Shift & lunch'],
    ['Target today (so far)', 'Σ hour targets of the hours worked up to now', 'An hour without scans keeps the target of the model before it, so a stop shows as a shortfall.', ''],
    ['Model cycle', '(last scan − first scan of the run − lunch / tea breaks) ÷ (pieces of the run − 1)', 'Run = the pieces of the running model since the line last changed to it. Every gap counts (no 22 s filter): it is the real speed of the model.', ''],
    ['Line avg cycle', '(last scan − first scan of the day − lunch / breaks) ÷ (pieces − 1)', 'The whole line today, every model and every stop.', ''],
    ['Against target', 'model cycle − target cycle  (≤ 0 = at or faster than target)', 'Shown only when the model has a target cycle.', ''],
    ['No target', 'model not in the Model master, or in it without a cycle time → no target ("—")', 'Its pieces are drawn hatched ("No target") on the hour bars, counted in production but not against the target. Click the model or the Model cycle tile for its details.', 'Model master'],
    ['Achieved', 'pieces of models with a target ÷ target pieces so far × 100', 'Pieces of a model without a target are left out (shown as "N no target" under Today).', ''],
  ]),
  S('shift', 'Shift & working time', 'Every target and OLE starts from the shift master of the line.', [
    ['Shift time', 'shift end − shift start', 'From the line\'s shift master — or, for one day, from that day\'s Morning entry of the line.', 'Setup → Masters → Shift & lunch · Morning entry'],
    ['Working time', 'shift time − lunch − tea breaks', 'Lunch and tea breaks are no working time: no target, not in OLE planned time (they never lower Availability).', 'Setup → Masters → Shift & lunch'],
    ['Working minutes of an hour', '60 − lunch / break minutes inside that hour (today: only up to now)', 'e.g. tea 11:00–11:10 → the 11:00 hour has 50 working minutes.', ''],
    ['Extra hour', 'a clock hour outside the shift with scans (early start / overtime)', 'Its pieces count in production and quality. It does not move OLE: its time = the std time of its pieces.', ''],
    ['Today in OLE', 'time of today ends at the line\'s last scan (never after now)', 'So an hour still running does not count as lost before it is over.', ''],
  ]),
  S('daily', 'Morning entry, loss analysis & HPR', 'The supervisor\'s morning entry, the management loss Pareto and the plant HPR Excel.', [
    ['Morning entry', 'manpower, line start, lunch, tea breaks and close time of one line for one day', 'For that day it replaces the shift master: hour targets, live screens, OLE and the HPR use these times. A line without an entry keeps the shift master.', 'Morning entry page'],
    ['Loss ₹ (lost time)', 'rate × minutes lost ÷ 60 × manpower × (overtime factor from the overtime time)', 'Manpower = that day\'s morning entry of the line; a line-day without it has no ₹. Default ₹65 per man-hour, ×2 from 18:00.', 'Setup → Masters → Loss ₹ & HPR'],
    ['Department Pareto', 'Σ minutes (or ₹ / pieces) of the entered losses per department, biggest first; cumulative % = running sum ÷ total', 'Blue bars make up the first 80 %. Click a department for the Pareto of its reasons.', 'Loss analysis page'],
    ['Drill-down', 'every click adds a step (department, reason, line, day, week, hour, model, owner, part); all charts and tables show only that slice', 'A list keeps all its own values (the picked one marked) so another can be picked; a second click or Back steps out. Compared with the same number of days just before.', 'Loss analysis page'],
    ['Lost vs target (HPR way)', 'short hour: working minutes ÷ target × (target − made); split over the reasons written in that hour by their minutes', 'A short hour without a reason counts as "Reason not written". The department totals equal the "Line Loss" block of the HPR Excel.', 'Loss analysis → Lost vs target (HPR)'],
    ['Reason written for %', '(lost time of short hours that have a reason) ÷ (lost time of all short hours) × 100', 'Shows how much of the lost time has a reason on the Loss entry page; the list of short hours without a reason says where to fill.', 'Loss analysis page'],
    ['HPR: Tgt of an hour', 'the hour\'s plan of the line screen (working seconds × share ÷ target cycle)', 'One row per model of the hour; the hour\'s cells are merged over its rows. Lunch hour: "13:30-14:00" with half the target.', 'Reports → HPR'],
    ['HPR: Gap · I/T · %Efficiency', 'TTL − Tgt · working minutes of the slot ÷ Tgt × Gap · TTL ÷ Tgt', 'I/T is negative when time was lost. Line loss by department (top of the sheet) = I/T of the hours with a reason, split by the minutes entered per department.', ''],
    ['HPR: UPH · UPPH', 'pieces ÷ working hours · pieces ÷ manpower (per hour) and pieces ÷ (manpower × working hours) for the day', '', ''],
  ]),
  S('targets', 'Targets', 'Each line has one target method (A, B, C or D) plus an allowance in seconds.', [
    ['Target pieces / hour', '3600 ÷ target cycle', '', ''],
    ['Method A — most common', 'the whole second with the most pieces (gaps from the low limit up to the gap limit) + allowance', 'Usually the strictest.', 'Line target method'],
    ['Method B — % rule', 'smallest whole second within which B % (default 70 %) of the valid pieces were made + allowance', 'Usually the easiest to reach.', 'Line target method'],
    ['Method C — average', 'mean of the valid gaps (low limit … gap limit), to 0.1 s + allowance', 'The average running speed.', 'Line target method'],
    ['Method D — Model master', 'cycle time in the Model master + allowance (normally 0)', 'Found by material code, else company + model name, else model name (the closest spelling). Not in the master or no cycle there → no target.', 'Model master · Line target method'],
    ['Valid gaps (A, B, C)', 'gap between two pieces of the same model from the low limit (default 1 s) up to the gap limit (default 22 s)', 'Longer gaps are stops, changeovers or breaks; shorter ones are double scans. A model needs at least the minimum number of gaps.', 'Target rule & check'],
    ['Data window (A, B, C)', 'scans from the rule\'s start date to its end date', 'A fixed window: later months do not change the targets.', 'Target rule & check'],
    ['Too few gaps on a line', 'the same model\'s target from another line (A, B, C lines only)', 'Marked "from Line N". A Method D line takes only the master.', ''],
    ['Locked target', 'a target the administrator locked always wins', 'A target locked from the master counts only while the master still has a cycle for it.', 'Line target method'],
  ]),
  S('hourly', 'Hourly analysis', 'Hour by hour against plan, for one line and one day.', [
    ['Plan of an hour', 'working seconds of the hour × share ÷ target cycle of the hour', 'Share = pieces of models with a target ÷ all pieces of the hour. Target cycle of the hour = Σ(pieces × target cycle) ÷ Σ pieces of the models that have a target.', ''],
    ['Mixed hour', 'a model without a target ran too → its share of the hour gets no target', 'e.g. 141 pcs without a target + 23 pcs at 20.57 s: target = 3600 s × 23 ÷ 164 ÷ 20.57 s ≈ 25, compared with the 23.', ''],
    ['Hour without scans', 'keeps the target cycle of the hour before (else after)', 'An idle hour gets a plan, so lost time is visible.', ''],
    ['Hour with pieces but no target', 'plan not defined ("—")', 'No model of that hour has a target cycle.', 'Model master'],
    ['Diff / %', 'pieces with a target − plan · pieces with a target ÷ plan × 100', 'OK ≥ 100 % · watch ≥ 90 % · behind below.', ''],
    ['Day / part of day', 'Σ pieces · Σ plan of its hours', 'Part 1 = shift start → lunch, Part 2 = lunch end → shift end. Lunch has no target.', ''],
    ['Needed per hour', '(day target − pieces) ÷ remaining working hours', 'Pieces per hour still needed to reach the day target.', ''],
  ]),
  S('ole', 'OLE — Overall OLE, OLE calendar, OLE dashboard', 'OLE = Availability × Performance × Quality.', [
    ['Total time', 'working time of the shift (lunch and tea breaks out)', 'Today: up to the last scan. A finished day: OLE_AEND', 'Setup → Masters → Shift & lunch / OLE formulas'],
    ['Idle time (loss)', 'OLE_ALOSS', 'Each reason has its department.', 'Loss entry'],
    ['Run time', 'OLE_RUN', '', ''],
    ['Ideal (std) time', 'Σ pieces of each model × its target cycle', 'Pieces of a model without a target cycle are left out of Performance.', ''],
    ['Availability  A', 'OLE_A', '', 'Setup → Masters → OLE formulas'],
    ['Performance  P', 'OLE_P', '(only the share of the time of the pieces with a target cycle)', 'Setup → Masters → OLE formulas'],
    ['Quality  Q', 'OLE_Q', '', 'Setup → Masters → OLE formulas'],
    ['OLE', 'A × P × Q', '', ''],
    ['Performance loss', 'OLE_PLOSS', 'The model ran below its std: stays in the run time, lowers Performance (not Availability).', 'Loss entry · Setup → OLE formulas'],
    ['Slow running', 'run time − ideal time', 'All the performance loss of the hour, written or not — it lowers Performance.', ''],
    ['Lost time', 'idle time + slow running', '', ''],
    ['Day, line, month, year', 'add the minutes and pieces first, then the same formulas', 'Never an average of percentages, so a short day weighs less than a full day.', ''],
    ['Closed day', 'no pieces and (line off all day or nothing entered) → no OLE', 'A day with no pieces but idle time entered counts: OLE 0 %.', 'Loss entry'],
  ], 'OLE'),
  S('quality', 'Quality — FPY / RTY', 'From the rejection and rework rows of Loss entry (station = where it was caught).', [
    ['FPY — first-pass yield', '(input − rejected − reworked) ÷ input', 'Right first time.', ''],
    ['Station FPY', '(input − rejected there − reworked there) ÷ input', '', 'Setup → Quality stations'],
    ['RTY — rolled throughput yield', 'Π station FPY of the stations counted in RTY', 'The chance a piece passes every station right first time.', 'Setup → Quality stations'],
    ['Final yield', '(input − rejected) ÷ input', '', ''],
    ['Rejection rate', 'false scans ÷ (good + false scans) × 100', 'Rejections page.', ''],
  ], 'Quality'),
  S('production', 'Analysis pages — production', 'Cycle time vs takt, spread, model analysis, trends.', [
    ['Quantity (pcs)', 'COUNT of successful scans (Status ≠ FALSE)', 'Each valid scan equals one piece.', ''],
    ['Active hours', 'COUNT of hours that have ≥ 1 scan', 'Zero-production hours are not counted.', ''],
    ['Pcs / active hour', 'Quantity ÷ Active hours', 'Productivity rate.', ''],
    ['Theoretical cycle', '3600 ÷ qty in the hour  (day: active hours × 3600 ÷ qty)', 'Average time per piece derived from output, including idle time.', ''],
  ], 'Production'),
  S('cycle', 'Analysis pages — actual cycle time', 'Per scan, from the gaps of the same model.', [
    ['Cycle (per scan)', 'scan time − previous scan time of the SAME model, SAME day', 'First scan = no cycle. An overnight gap is never a cycle.', ''],
    ['Average cycle', 'Σ valid cycles ÷ COUNT valid cycles', 'Combining hours or models: weighted by sample count, not a mean of means.', ''],
    ['Outlier (auto)', 'cycle > N × median(model, day)  [limit never below 20 s, never above max s]', 'Lunch, breakdown, changeover. Left out of cycle statistics, counted in quantity.', 'Outlier settings (line page)'],
    ['Outlier (fixed)', 'cycle > max seconds', '', 'Outlier settings (line page)'],
    ['Idle threshold', 'idle only if gap ≥ N seconds (default 60)', 'Short micro-stops are not counted as idle.', 'Outlier settings (line page)'],
    ['Min gap', 'cycle < min seconds → dropped', 'Removes double scans.', 'Outlier settings (line page)'],
    ['Line idle time', 'gaps between scans of ANY model > outlier cap AND ≥ idle threshold, each counted once, clipped per hour', 'The real line downtime of the analysis pages.', ''],
    ['Low-volume model', 'range qty < min pcs', 'Left out of the cycle average, included in quantity.', 'Min pcs (line page)'],
  ], 'Cycle statistics'),
  S('takt', 'Analysis pages — takt & plan', 'The takt of Cycle time vs takt.', [
    ['Available time', 'working hours of the takt window × 3600', 'From Cycle time vs takt → Set takt.', 'Cycle time vs takt'],
    ['Takt time', 'available time ÷ demand (target qty)', '', 'Cycle time vs takt'],
    ['Cycle vs takt', 'avg cycle ÷ takt × 100', '≤ 100 % = faster than takt.', ''],
    ['Demonstrated takt', 'elapsed window seconds ÷ qty', 'Takt actually achieved.', ''],
    ['Utilization', 'active seconds ÷ elapsed window seconds', '', ''],
    ['Projected end of day (live)', 'qty + (qty ÷ elapsed hrs) × remaining hrs', 'Today only.', ''],
  ], 'Takt'),
  S('stats', 'Statistics, SPC & Pareto', 'Spread, control charts, Pareto.', [
    ['Mean / Std dev', 'mean = Σx ÷ n · σ = √(Σ(x − mean)² ÷ (n − 1))', 'Sample std dev.', ''],
    ['CV (variation)', 'σ ÷ mean × 100', '< 15 % stable · 15–30 % watch · > 30 % unstable.', ''],
    ['Percentile P10 … P95', 'sorted value at rank (n − 1) · p, linear interpolation', 'Same as Excel PERCENTILE.INC.', ''],
    ['Cpk (vs takt)', '(takt − mean) ÷ (3σ)', '≥ 1.33 capable · 1–1.33 marginal · < 1 miss.', ''],
    ['Control limits', 'CL ± 3σ, σ = average |xᵢ − xᵢ₋₁| ÷ 1.128  (LCL ≥ 0)', 'Outside the limits = special cause; 7 points on one side = shift.', ''],
    ['Pareto class A / B / C', 'cumulative share before the item < 80 % / < 95 % / rest', 'A = the vital few.', ''],
    ['Model health', 'Attention: cycle/takt > 110 % or CV > 30 % or rej > 2 % · Watch: > 100 % / > 15 % / > 1 %', 'Scorecard.', ''],
  ], 'Statistics & SPC'),
];

const METHOD_TEXT = { A: 'A · most common', B: 'B · % rule', C: 'C · average', D: 'D · Model master' };
const chip = 'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2';
const label = 'text-fs-11 uppercase tracking-wide font-extrabold text-slate-600';
const pc = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

/** Worked example: computed with the same functions as the screens. */
function Examples() {
  const ex = useMemo(() => {
    const shift = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30', breaks: [{ name: 'Tea', start: '11:00', end: '11:10' }, { name: 'Tea', start: '17:00', end: '17:10' }] };
    const n = normShift(shift);
    const work = n.end - n.start - n.off.reduce((a, [x, y]) => a + (y - x), 0);
    const o = oleOf({ totalMin: work, stopMin: 0, plannedMin: work, lossMin: 70, actualMin: work - 70, qty: 1500, stdSec: 1500 * 22, noStdQty: 0, rejects: 15, rework: 0 });
    const hourSec = workSecInHour(shift, 11);
    const cyc = realCycleSec(shift, '2026-11-16 10:00:00', '2026-11-16 11:20:00', 201);
    return { work, o, hourSec, cyc };
  }, []);
  const { work, o, hourSec, cyc } = ex;
  const Step = ({ k, f, v }) => (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-1.5">
      <span className="text-fs-13 font-bold text-slate-900">{k}</span>
      <span className="font-mono text-fs-12 text-slate-700 break-words">{f}</span>
      <span className="font-mono text-fs-14 font-extrabold text-blue-800 text-right whitespace-nowrap">{v}</span>
    </div>
  );
  return (
    <div className="grid gap-3 xl:grid-cols-3">
      <Card title="Example · OLE of one day" sub="Shift 09:00–21:00, lunch 13:00–13:30, tea 11:00–11:10 and 17:00–17:10 · 1 500 pcs, target cycle 22 s, 15 rejected">
        <div className="mt-2 divide-y divide-slate-100">
          <Step k="Total time" f="720 − 30 − 10 − 10" v={`${work} min`} />
          <Step k="Run time" f={`${work} − 70 idle time`} v={`${o.actualMin} min`} />
          <Step k="Ideal time" f="1 500 × 22 s ÷ 60" v={`${o.stdSec / 60} min`} />
          <Step k="Availability" f={`${o.actualMin} ÷ ${o.plannedMin}`} v={pc(o.A)} />
          <Step k="Performance" f={`${o.stdSec / 60} ÷ ${oleConfig().pBase === 'planned' ? o.plannedMin : o.actualMin}`} v={pc(o.P)} />
          <Step k="Quality" f="(1 500 − 15) ÷ 1 500" v={pc(o.Q)} />
          <Step k="OLE" f="A × P × Q" v={pc(o.ole)} />
          <Step k="Slow running" f={`${o.actualMin} − ${o.stdSec / 60}`} v={`${Math.round(o.speedMin)} min`} />
          <Step k="Lost time" f={`70 + ${Math.round(o.speedMin)}`} v={`${70 + Math.round(o.speedMin)} min`} />
        </div>
      </Card>
      <Card title="Example · hour target" sub="The 11:00 hour with tea 11:00–11:10, model target cycle 20 s">
        <div className="mt-2 divide-y divide-slate-100">
          <Step k="Working time" f="60 − 10 min tea" v={`${hourSec / 60} min`} />
          <Step k="Hour target" f={`${hourSec} s ÷ 20 s`} v={`${Math.round(hourSec / 20)} pcs`} />
          <Step k="At 11:30 (live)" f={`${(30 - 10) * 60} s ÷ 20 s`} v={`${(30 - 10) * 3} pcs`} />
          <Step k="Two models" f="(100 × 20 s + 50 × 26 s) ÷ 150" v={`${((100 * 20 + 50 * 26) / 150).toFixed(1)} s`} />
          <Step k="No-target model" f="3600 s × 23 ÷ 164 ÷ 20 s" v={`${Math.round((3600 * 23) / 164 / 20)} pcs`} />
        </div>
        <p className="mt-2 text-fs-12 text-slate-600">Two models in one hour (100 pcs with a 20 s target, 50 pcs with 26 s): the hour's target cycle is weighted by their pieces. 141 pcs of a model without a target + 23 with one: only the 23's share of the hour gets a target.</p>
      </Card>
      <Card title="Example · model cycle" sub="Model ran 10:00:00 → 11:20:00 without changing, 201 pcs, tea 11:00–11:10">
        <div className="mt-2 divide-y divide-slate-100">
          <Step k="Time of the run" f="11:20 − 10:00" v="80 min" />
          <Step k="Minus tea" f="80 − 10" v="70 min" />
          <Step k="Gaps" f="201 − 1" v="200" />
          <Step k="Model cycle" f="70 × 60 ÷ 200" v={fmtSeconds(cyc)} />
        </div>
        <p className="mt-2 text-fs-12 text-slate-600">A stop inside the run counts — it is the real speed. Another model in between starts a new run.</p>
      </Card>
    </div>
  );
}

/** The settings every screen uses right now: shift master and target method of each line. */
function InForce({ lines }) {
  const all = useAllLineSettings(lines);
  const { ui } = useUiSettings();
  const rule = ui.targetRule;
  const mAt = masterLoadedAt();
  const dmy = (d) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : 'today');
  return (
    <Card title="Settings in force right now" sub="Every screen uses these. Change them where the last column says.">
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[760px] text-fs-13" aria-label="Settings of each line">
          <thead>
            <tr className="border-b border-slate-200 text-left text-fs-12 text-slate-500">
              {['Line', 'Shift', 'Lunch', 'Tea / other breaks', 'Working time', 'Target method', 'Models with a target'].map((h) => <th key={h} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const s = all[l] || {};
              const n = normShift(s.shift);
              const work = n.end - n.start - n.off.reduce((a, [x, y]) => a + (y - x), 0);
              const c = lineCfg(rule, l);
              const nt = Object.values(s.targets || {}).filter((t) => t?.cycle > 0).length;
              return (
                <tr key={l} className="border-b border-slate-100 last:border-0">
                  <td className="px-2 py-1.5 font-extrabold text-slate-900 whitespace-nowrap">Line {l}</td>
                  <td className="px-2 py-1.5 font-mono whitespace-nowrap">{fmtMin(n.start)}–{fmtMin(n.end)}</td>
                  <td className="px-2 py-1.5 font-mono whitespace-nowrap">{n.lunchStart != null ? `${fmtMin(n.lunchStart)}–${fmtMin(n.lunchEnd)}` : '—'}</td>
                  <td className="px-2 py-1.5 font-mono">{n.breaks.length ? n.breaks.map((b) => `${b.name} ${fmtMin(b.from)}–${fmtMin(b.to)}`).join(' · ') : '—'}</td>
                  <td className="px-2 py-1.5 font-mono font-bold whitespace-nowrap">{fmtDur(work)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{METHOD_TEXT[c.method]}{c.add ? ` + ${c.add} s` : ''}{c.method === 'B' ? ` (${c.pct} %)` : ''}</td>
                  <td className="px-2 py-1.5 font-mono">{nt}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className={chip}><div className={label}>Data window (A, B, C)</div><div className="font-mono font-extrabold text-slate-900 text-fs-14">{dmy(rule.from)} → {dmy(rule.to)}</div><div className="text-fs-12 text-slate-600">Target rule & check</div></div>
        <div className={chip}><div className={label}>Valid gaps</div><div className="font-mono font-extrabold text-slate-900 text-fs-14">{rule.low} s – {rule.cap} s</div><div className="text-fs-12 text-slate-600">at least {rule.min} gaps per model</div></div>
        <div className={chip}><div className={label}>Model master</div><div className="font-mono font-extrabold text-slate-900 text-fs-14">{mAt ? String(mAt).slice(0, 16).replace('T', ' ') : 'read when a line uses Method D'}</div><div className="text-fs-12 text-slate-600">Method D targets, segment, details</div></div>
        <div className={chip}><div className={label}>Shift, lunch, tea breaks</div><div className="font-extrabold text-slate-900 text-fs-14">Setup → Masters</div><div className="text-fs-12 text-slate-600">Shift & lunch of each line</div></div>
      </div>
    </Card>
  );
}

/** The line's analysis settings (only when opened from a line page). */
function LineParams({ takt, outlier, minQty }) {
  const hrs = windowHours(takt);
  const rows = [
    ['Idle threshold', `${outlier.idle ?? 60}s`, 'Line idle = no scan ≥ this long'],
    ['Outlier filter', outlier.mode === 'auto' ? `Auto · ${outlier.mult}× median · max ${outlier.max}s` : outlier.mode === 'fixed' ? `Fixed · ${outlier.max}s` : 'Off', `min gap ${outlier.min}s`],
    ['Takt window', `${String(takt.startHour).padStart(2, '0')}:00 – ${String(takt.endHour).padStart(2, '0')}:00`, takt.lunchHour != null ? `lunch ${takt.lunchHour}:00 excluded → ${hrs.length} hr` : `${hrs.length} hr`],
    ['Takt (global)', takt.taktSec > 0 ? fmtSeconds(takt.taktSec) : 'not set', takt.taktSec > 0 ? `target ${Math.round((hrs.length * 3600) / takt.taktSec)} pcs/day` : 'Cycle time vs takt → Set takt'],
    ['Model-wise takt overrides', Object.keys(takt.models || {}).length, ''],
    ['Low-volume threshold', `${minQty} pcs`, 'Range total per model'],
  ];
  return (
    <Card title="Parameters in force right now" sub="Analysis pages of this line (cycle time vs takt, spread, trends, control charts)">
      <div className="mt-2 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        {rows.map(([k, v, s]) => (
          <div key={k} className={chip}>
            <div className={label}>{k}</div>
            <div className="font-mono font-extrabold text-slate-900 text-fs-14">{v}</div>
            <div className="text-fs-12 text-slate-600 font-medium">{s}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function FormulasPage({ takt = null, outlier = null, minQty = null, line = null }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const cfg = oleConfig();
  const fill = (t) => String(t)
    .replace('OLE_AEND', cfg.aEnd === 'shiftEnd' ? 'up to the shift close.' : 'up to its last scan (hours after the last piece with no loss written are not counted).')
    .replace('OLE_PLOSS', cfg.lossIn === 'avail' ? 'off (admin choice: model loss counts in Availability)' : 'minutes entered on Loss entry against a model')
    .replace('OLE_ALOSS', `${cfg.lossIn === 'avail' ? 'every minute entered on Loss entry' : 'minutes entered on Loss entry without a model (line stood)'}${cfg.aLoss === 'unplanned' ? ' (old planned stops come off the time first)' : ' + planned stops'}${cfg.aIdle === 'idle' ? ' + hours without scans and nothing written' : ''}`)
    .replace('OLE_RUN', cfg.aLoss === 'unplanned' ? 'total time − planned stop − loss' : 'total time − loss')
    .replace('OLE_A', cfg.aLoss === 'unplanned' ? 'run time ÷ (total time − planned stop)' : 'run time ÷ total time')
    .replace('OLE_P', `ideal time ÷ ${cfg.pBase === 'planned' ? 'planned time' : 'run time'}${cfg.pCap ? ' (max 100 %)' : ''}${cfg.pNoStd === 'avg' ? '; pieces without a std cycle take the hour\'s average std' : ''}`)
    .replace('OLE_Q', `${cfg.qMode === 'rejRework' ? '(pieces − rejected − rework) ÷ pieces' : '(pieces − rejected) ÷ pieces'}${cfg.qStations === 'final' ? ' (only what final-check stations found)' : ''}`);
  const SECT = SECTIONS.map((s) => ({ ...s, items: s.items.map((it) => it.map(fill)) }));
  const shown = useMemo(() => SECT.map((s) => ({ ...s, items: query ? s.items.filter((it) => it.join(' ').toLowerCase().includes(query) || s.title.toLowerCase().includes(query)) : s.items })).filter((s) => s.items.length), [query, JSON.stringify(cfg)]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = line && LINE_IDS.includes(String(line)) ? [String(line)] : LINE_IDS;
  const go = (k) => { try { document.getElementById(`calc-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* old browser */ } };
  return (
    <div className="flex flex-col gap-3" role="region" aria-label="How it is calculated">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a number — e.g. OLE, idle, target, cycle"
          aria-label="Search the formulas" className="h-9 w-full sm:w-80 rounded-lg border border-slate-300 bg-white px-3 text-fs-14 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        <nav className="flex flex-wrap gap-1.5" aria-label="Sections">
          {shown.map((s) => (
            <button key={s.key} type="button" onClick={() => go(s.key)} className="rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-fs-12 font-bold text-slate-700 hover:bg-blue-50 hover:border-blue-300">{s.short}</button>
          ))}
        </nav>
      </div>
      {!query && <InForce lines={lines} />}
      {!query && takt && outlier && <LineParams takt={takt} outlier={outlier} minQty={minQty} />}
      {!query && <Examples />}
      {query && !shown.length && <div className="rounded-xl border border-slate-200 bg-white py-10 text-center text-fs-14 font-semibold text-slate-600">Nothing found for “{q}”.</div>}
      <div className="grid gap-3 xl:grid-cols-2">
        {shown.map((s) => (
          <section key={s.key} id={`calc-${s.key}`} className="scroll-mt-20" aria-label={s.title}>
            <Card title={s.title} sub={s.sub} className="h-full">
              <div className="mt-1 divide-y divide-slate-100">
                {s.items.map(([n, f, note, where]) => (
                  <div key={n} className="py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-fs-14 font-extrabold text-slate-900">{n}</div>
                      {where && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-fs-11 font-bold text-slate-600">Set in: {where}</span>}
                    </div>
                    <div className="font-mono text-fs-13 text-blue-800 bg-blue-50/60 rounded px-2 py-1 mt-1">ƒ {f}</div>
                    {note && <div className="text-fs-12 text-slate-600 font-medium mt-1">{note}</div>}
                  </div>
                ))}
              </div>
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
