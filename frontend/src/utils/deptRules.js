/**
 * 27-11-2026: every loss, rejection and rework has a department — never "Not set".
 * The department written on the entry wins; without one it comes from the defect's category (Moulding, Part, Assy …)
 * and then from words in the reason (shortage → store, scan / XML → IT, machine → maintenance, scratch → moulding …).
 * The names are the plant's departments (AuthGate DEPTS).
 */
const CAT_DEPT = {
  moulding: 'Moulding QA', part: 'Supplier', assy: 'Prod', process: 'Prod', production: 'Prod',
  'kitting store': 'Kitting Store', 'plastic store': 'Moulding Store', 'sub assy': 'Sub Assy', supplier: 'Supplier',
};
const RULES = [
  // as the plant's own reason master: plastic parts short → Moulding Store, the rest → Kitting Store
  [/(panel|pulsator|control table|cascade|lid|tub|base|cover|cap|knob|plastic|moulded).*(shortage|short|not available)/i, 'Moulding Store'],
  [/shortage|short supply|not available|not received|material not|no material|kitting/i, 'Kitting Store'],
  [/touching|colour variation|color variation/i, 'Moulding QA'],
  [/drain.*leak|drain assy|hose/i, 'Supplier'],
  [/barcode|bar code|xml|scan(ner)? error|scan|software|system|server|network|label print|printer|sap|mes\b|rentomojo/i, 'IT'],
  [/breakdown|machine|jig|fixture|conveyor|power cut|power fail|compressor|air pressure|nut ?runner|tester|tool|robot|leak tester|maint/i, 'Maint'],
  [/model change|changeover|change over|manpower|operator|absent|training|meeting|trial|line setting|productivity|line balancing/i, 'Prod'],
  [/scratch|broken|crack|flash|bubble|burr|dent|short shot|warp|silver|black spot|weld line|moulding|mould|deco|colour|color|shade|sink mark|damage/i, 'Moulding QA'],
  [/motor|pcb|wire|harness|sensor|valve|switch|ir fail|no power|electrical|buzzer|display|board|capacitor|pump|supplier|vendor/i, 'Supplier'],
  [/leak|loose|not tight|screw|missing|miss|touching|noise|angle|wrong|reverse|gap|fitment|not fixed|not fit|bend|assembly|assy|glass|lid|cap/i, 'Prod'],
];
const tidy = (s) => String(s ?? '').trim();
const QUALITY = new Set(['reject', 'rejects', 'rework', 'Rejection', 'Rework']);

/** the department a reason most likely belongs to (category first, then the words of the reason) */
export function guessDept(kind, reason, cat = '') {
  const c = CAT_DEPT[tidy(cat).toLowerCase()];
  if (c) return c;
  const r = tidy(reason);
  for (const [re, d] of RULES) if (re.test(r)) return d;
  return QUALITY.has(kind) ? 'Quality' : 'Prod';
}

/** the department of an entry row: as written, else the guess — never empty */
export const deptOfRow = (x, kind, written = (d) => tidy(d)) => written(x?.dept) || guessDept(kind, x?.reason, x?.cat);

/** 6M — the category of a root cause (RCA / CAPA) */
export const RCA_CATS = ['Man', 'Machine', 'Material', 'Method', 'Measurement', 'Environment'];
export const RCA_CAT_HINT = {
  Man: 'operator skill, training, absence, handling',
  Machine: 'machine, jig, fixture, tool, tester, breakdown',
  Material: 'part, supplier, moulding, shortage',
  Method: 'process, SOP, sequence, layout, model change',
  Measurement: 'gauge, tester setting, inspection, scan / data',
  Environment: 'power, air, temperature, dust, light',
};
/** a likely 6M category from the reason and its department (the RCA form starts with it; the department changes it) */
export function guessRcaCat(reason, dept = '') {
  const r = `${tidy(reason)} ${tidy(dept)}`;
  if (/operator|manpower|absent|training|handling|negligen/i.test(r)) return 'Man';
  if (/machine|jig|fixture|tool|tester|breakdown|maint|robot|conveyor/i.test(r)) return 'Machine';
  if (/shortage|supplier|moulding|part|scratch|broken|crack|flash|motor|pcb|store|material/i.test(r)) return 'Material';
  if (/scan|barcode|xml|gauge|inspection|measure|it\b/i.test(r)) return 'Measurement';
  if (/power|air|temperature|dust|light|rain|water/i.test(r)) return 'Environment';
  return 'Method';
}
