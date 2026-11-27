<?php
/**
 * ole.php — what the OLE page needs that the scans cannot know, one entry per line, day and hour (09 … 20):
 *   stops    [{model, reason, min}]   PLANNED stoppage minutes (tea break, meeting, PM, no plan …), optionally the model
 *   losses   [{model, reason, min}]   UNPLANNED loss minutes (breakdown, material, power …) with the model; stops + losses ≤ the hour
 *   OLE: planned time = total − stops, actual time = planned time − losses, Availability = actual ÷ planned (frontend utils/ole.js)
 *   rejects  [{station, model, reason, qty, cat?, cause?, action?, dismantle?}]   rejected pieces: the quality station that caught them (LQC, FQC, leak test …), defect;
 *            cat = Production / Assy / Part / Process, cause / action = root cause and action, dismantle = pieces opened up (≤ qty)
 *   rework   [{station, model, reason, qty}]   reworked pieces, the same (they stay in the actual qty)
 *   note     free text
 * Every reason belongs to a responsible department and has an owner (admin list, data/ole_reasons.json); department and
 * owner are stored with each row when it is saved, so later changes of the list do not rewrite history. A loss row may
 * also name the part involved (part). The default unplanned-loss list is the plant's HPR list.
 * Morning entry: POST { action:'setup', date, line, mp, start, end, lunchStart, lunchEnd, breaks:[{name,start,end}] }
 *   (same logins as save; clear:true removes it) — that day's manpower and shift of the line; GET returns setup:
 *   { "date|line": {...} } of the period. The screens use it instead of the shift master for that line and day.
 *
 * GET  ?start=YYYY-MM-DD&end=YYYY-MM-DD      → { entries: { "YYYY-MM-DD|N|H": {...} }, reasons: {stop:[{reason,dept}], loss, reject, rework, station:[{reason: station name, dept: owner}]} }
 * POST { action:'save', entries:[{date, line, hour, stops, rejects, rework, note, noLoss?, noQ?, part?}] }   noLoss = the line checked the hour: no time lost;
 *      noQ = quality checked the hour, no defect (23-11-2026); part = 'loss' | 'quality' | 'both': the part of the hour written
 *      (kept only without loss rows; saved with noLossBy / noLossAt)
 *        admin, or a line login that the admin allowed to fill entries — only for its own lines
 * POST { action:'reasons', reasons:{stop, loss, reject, rework, station, quality} }   admin only (station list and quality targets
 *        optional: kept when not sent; station rows: see OLE_DEFAULT_STATIONS)
 * POST { action:'rca', items:[{date, line, kind, reason, cat (6M), rootCause, whys, action, preventive, owner, targetDate, closeDate, status, evidence:[{id}], capa:{…} }] }
 *      capa (24-11-2026, the paper CAPA form): equip, hall, problem, correction, whyQ[5], caTarget, caResp, paTarget, paResp, implemented, verifiedBy, verifyDate, verifyNote
 *        evidence = photos / files uploaded through files.php (20-11-2026)
 *        RCA of one loss (one reason of one kind on one line and day): admin, or a login of the responsible department
 * GET also returns rca: { "date|line|kind|reason": {...} } of the period,
 *     and days: { "date|line": {reason, note, by, at} } — whole-day planned stops (holiday, no plan, shutdown …)
 * POST { action:'day', date, line, off:true|false, reason, note }   whole-day planned stop of one line on one day
 *        (same logins as save): that line-day is left out of OLE (no time, no OLE), so a closed day does not lower the month
 * POST { action:'kpi', date, line, osd, bom, otPlan, otUnplan, wo7, trc3, wip7, dismantle, note }   (19-11-2026) what the
 *        SAWM KPI report needs that Line Pulse cannot know — OS&D value, BOM value, OT man-hours, open work orders, TRC / WIP
 *        lying, dismantled pieces — one row per line and day (page "KPI entry"; all empty = removed). GET returns kpi: { "date|line": {...} }
 * Kept in backend/data — the line databases are not touched.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/capa.php';
$me = auth_guard('view', true);
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/ui.php';
require_once __DIR__ . '/../lib/clock.php';

const OLE_KINDS = ['stop', 'loss', 'reject', 'rework'];
const OLE_QCATS = ['Production', 'Assy', 'Part', 'Process', 'Moulding', 'Kitting Store', 'Plastic Store'];   // category of a rejection / rework row (20-11-2026)
/** KPI entry fields (SAWM KPI report) and their upper limit */
const OLE_KPI_FIELDS = ['osd' => 1e9, 'bom' => 1e6, 'otPlan' => 1e5, 'otUnplan' => 1e5, 'wo7' => 1e7, 'trc3' => 1e9, 'wip7' => 1e9, 'dismantle' => 1e5];
const OLE_DEFAULT_REASONS = [
    'stop' => [ // planned stoppage
        ['reason' => 'Tea break', 'dept' => 'Prod'], ['reason' => 'Meeting / training', 'dept' => 'Prod'],
        ['reason' => 'Planned maintenance (PM)', 'dept' => 'Maint'], ['reason' => 'Planned model changeover', 'dept' => 'Prod'],
        ['reason' => 'No production plan', 'dept' => 'PPC'], ['reason' => 'Trial / sample run', 'dept' => 'Engineering'],
        ['reason' => '5S / cleaning', 'dept' => 'Prod'], ['reason' => 'Other planned', 'dept' => 'Prod'],
    ],
    'loss' => [ // unplanned loss — the reasons of the plant's HPR (Oct-26), each with its department and owner
        ['reason' => 'Model Change', 'dept' => 'Prod', 'owner' => 'Ajay Kumar'],
        ['reason' => 'T-9 Model / Efficiency issue', 'dept' => 'Prod', 'owner' => 'Shatrughan'],
        ['reason' => 'Productivity Issue', 'dept' => 'Prod', 'owner' => 'Ajay Kumar'],
        ['reason' => 'Motor Shortage', 'dept' => 'Kitting Store', 'owner' => 'Arvind Pandey'],
        ['reason' => 'Control Table Shortage', 'dept' => 'Moulding Store', 'owner' => 'Madan Yadav'],
        ['reason' => 'Pulsator Shortage', 'dept' => 'Moulding Store', 'owner' => 'Madan Yadav'],
        ['reason' => 'Carton Box Shortage', 'dept' => 'Kitting Store', 'owner' => 'Neeraj Mishra'],
        ['reason' => 'Panel Shortage', 'dept' => 'Moulding Store', 'owner' => 'Madan Yadav'],
        ['reason' => 'Pulsator Touching', 'dept' => 'Moulding QA', 'owner' => 'Shailesh Singh'],
        ['reason' => 'Drain Assy Leakage', 'dept' => 'Supplier', 'owner' => 'Vikas Pal'],
        ['reason' => 'Barcode / XML scan error', 'dept' => 'IT', 'owner' => 'Pradeep Kumar'],
        ['reason' => 'New model running for first time', 'dept' => 'Prod', 'owner' => 'Sachidanand'],
        ['reason' => 'Colour Variation', 'dept' => 'Moulding QA', 'owner' => 'Shailesh Singh'],
        ['reason' => 'Panel Cover Shortage', 'dept' => 'Moulding Store', 'owner' => 'Madan Yadav'],
        ['reason' => 'Cascade Shortage', 'dept' => 'Moulding Store', 'owner' => 'Madan Yadav'],
        ['reason' => 'Lift / Pick & Lift breakdown', 'dept' => 'Maint', 'owner' => 'Rajnikant'],
        ['reason' => 'Power Cord Issue', 'dept' => 'Supplier', 'owner' => 'Vikas Pal'],
        ['reason' => 'Tub Shortage', 'dept' => 'Moulding Store', 'owner' => 'Anjani Tiwari'],
        ['reason' => 'Angle NG', 'dept' => 'Prod', 'owner' => 'Ajay Kumar'],
        ['reason' => 'Break Plate Shortage', 'dept' => 'Kitting Store', 'owner' => 'Ganesh Chandra'],
        ['reason' => 'Back Cover Shortage', 'dept' => 'Moulding Store', 'owner' => 'Madan Yadav'],
        ['reason' => 'Trial run (R&D)', 'dept' => 'R&D', 'owner' => 'Chandan Kumar'],
        ['reason' => 'Striping Machine not working', 'dept' => 'Maint', 'owner' => 'Rajnikant'],
        ['reason' => 'EPS Shortage', 'dept' => 'Kitting Store', 'owner' => 'Neeraj Mishra'],
        ['reason' => 'Wash Lid Shortage', 'dept' => 'Moulding Store', 'owner' => 'Madan Yadav'],
        ['reason' => 'Leg Shortage', 'dept' => 'Moulding Store', 'owner' => 'Kundan Singh'],
        ['reason' => 'Overflow Pipe Leakage', 'dept' => 'Supplier', 'owner' => 'Kosh'],
        ['reason' => 'Wrong water selector assembly', 'dept' => 'Prod', 'owner' => 'Shatrughan'],
        ['reason' => 'Tub Scratch', 'dept' => 'Moulding Store', 'owner' => 'Ram Sewak'],
        ['reason' => 'Drain Assy Shortage', 'dept' => 'Outsourcing', 'owner' => 'Upendra Shukla'],
        ['reason' => 'No Break Issue', 'dept' => 'Supplier', 'owner' => 'Vikas Pal'],
        ['reason' => 'Glass Shortage', 'dept' => 'Sub Assy', 'owner' => 'Gaurav Chauhan'],
        ['reason' => 'Printing NG in Carton Box', 'dept' => 'Supplier', 'owner' => 'Krishna Packers'],
        ['reason' => 'Manpower Setting', 'dept' => 'Prod', 'owner' => 'Mukesh'],
        ['reason' => 'Bubble in Deco', 'dept' => 'Moulding Store', 'owner' => 'Madan Yadav'],
        ['reason' => 'Drain Cap Leakage', 'dept' => 'Supplier', 'owner' => 'Kosh'],
        ['reason' => 'Jig / fixture broken', 'dept' => 'Prod', 'owner' => 'Sachidanand'],
        ['reason' => 'No Movement of FG', 'dept' => 'Logistics', 'owner' => 'Randhir Rai'],
        ['reason' => 'Knob Shortage', 'dept' => 'Moulding Store', 'owner' => 'Madan Yadav'],
        ['reason' => 'Motor NG', 'dept' => 'Supplier', 'owner' => 'Vikas Pal'],
        ['reason' => 'Pulsator Cap Shortage', 'dept' => 'Moulding Store', 'owner' => 'Madan Yadav'],
        ['reason' => 'Gun not working', 'dept' => 'Maint', 'owner' => 'Rajnikant'],
        ['reason' => 'Seal Bellow Leakage', 'dept' => 'Moulding Store', 'owner' => 'Ram Sewak'],
        ['reason' => 'Wrong Pulsator on line', 'dept' => 'Moulding Store', 'owner' => 'Harikesh Singh'],
        ['reason' => 'Pick & Turn not working', 'dept' => 'Maint', 'owner' => 'Rajnikant'],
        ['reason' => 'Rework', 'dept' => 'Prod', 'owner' => 'Shatrughan'],
        ['reason' => 'Panel Mouth Shortage', 'dept' => 'Moulding Store', 'owner' => 'Madan Yadav'],
        ['reason' => 'Thermocol Shortage', 'dept' => 'Kitting Store', 'owner' => 'Neeraj Mishra'],
        ['reason' => 'Wrong Carton Box', 'dept' => 'Kitting Store', 'owner' => 'Neeraj Mishra'],
        ['reason' => 'Server Issue', 'dept' => 'IT', 'owner' => 'Pradeep Kumar'],
        ['reason' => 'Other', 'dept' => 'Prod', 'owner' => 'Shatrughan'],
    ],
    'reject' => [ // washing machine defects
        ['reason' => 'Water leak', 'dept' => 'Prod'], ['reason' => 'Noise / vibration', 'dept' => 'Engineering'],
        ['reason' => 'Electrical safety fail (Hi-pot / earth)', 'dept' => 'Quality'], ['reason' => 'Functional fail', 'dept' => 'Quality'],
        ['reason' => 'Cosmetic damage', 'dept' => 'Quality'], ['reason' => 'Supplier part defect', 'dept' => 'Supplier'],
        ['reason' => 'Handling damage', 'dept' => 'Prod'], ['reason' => 'Wrong part', 'dept' => 'Kitting Store'],
        ['reason' => 'Missing part', 'dept' => 'Kitting Store'], ['reason' => 'Other', 'dept' => 'Quality'],
    ],
    'rework' => [
        ['reason' => 'Assembly mistake', 'dept' => 'Prod'], ['reason' => 'Leak repair', 'dept' => 'Prod'],
        ['reason' => 'Wiring / connector', 'dept' => 'Prod'], ['reason' => 'Fitment issue', 'dept' => 'Engineering'],
        ['reason' => 'Missing part', 'dept' => 'Kitting Store'], ['reason' => 'Test fail', 'dept' => 'Quality'],
        ['reason' => 'Cosmetic touch-up', 'dept' => 'Prod'], ['reason' => 'Other', 'dept' => 'Prod'],
    ],
];
/** Reasons of a whole-day planned stop (the line does not run that day: no OLE for it). */
const OLE_DAY_REASONS = ['Holiday / weekly off', 'No production plan', 'Planned maintenance shutdown', 'Stock taking / audit', 'Planned power shutdown', 'Model trial / line setting', 'Other'];

/**
 * Quality stations of a washing machine line where a piece is rejected or sent to rework — the admin sets them up:
 *   reason = station name, dept = owner, code = short name on screens (LQC, FQC …), type = inline | test | final | audit,
 *   rty = counts in RTY, active = offered in Loss entry, rework = pieces can be sent to rework there,
 *   lines = lines that have it ([] = every line), defects = its defects ([] = the whole rejection / rework list),
 *   aliases = its old names (entries saved under an old name count for it). The order of the list is the order on the line.
 */
const OLE_STATION_TYPES = ['inline', 'test', 'final', 'audit'];
// the six stages of the plant's SAWM KPI report (FTY & RTY sheet), in its order; the old default names stay as aliases
const OLE_DEFAULT_STATIONS = [
    ['reason' => 'HVIR', 'dept' => 'Quality', 'code' => 'HVIR', 'type' => 'test', 'aliases' => ['Hi-pot / electrical safety', 'HIPOT']],
    ['reason' => 'Leakage Inspection', 'dept' => 'Quality', 'code' => 'LEAK', 'type' => 'test', 'aliases' => ['Leak test']],
    ['reason' => 'Functional', 'dept' => 'Quality', 'code' => 'FUNC', 'type' => 'test', 'aliases' => ['Run / performance test', 'RUN']],
    ['reason' => 'Front Inspection', 'dept' => 'Quality', 'code' => 'FRONT', 'type' => 'inline', 'aliases' => ['LQC (line quality check)', 'LQC']],
    ['reason' => 'Pre-Final Inspection', 'dept' => 'Quality', 'code' => 'PREFINAL', 'type' => 'inline'],
    ['reason' => 'Final Inspection', 'dept' => 'Quality', 'code' => 'FINAL', 'type' => 'final', 'aliases' => ['FQC (final quality check)', 'FQC']],
];
/** FPY / RTY targets (%), the admin's. */
const OLE_DEFAULT_QUALITY = ['fpyTarget' => 98.0, 'rtyTarget' => 97.0];   // RTY 97 % as the SAWM KPI report

function ole_txt($v, int $max): string { return mb_substr(trim(strip_tags((string)$v)), 0, $max); }

/** The reason lists (admin's, or the default). */
function ole_reasons(): array
{
    $r = store_read('ole_reasons', []);
    $out = [];
    foreach (OLE_KINDS as $k) $out[$k] = !empty($r[$k]) && is_array($r[$k]) ? array_values($r[$k]) : OLE_DEFAULT_REASONS[$k];
    $st = !empty($r['station']) && is_array($r['station']) ? array_values($r['station']) : OLE_DEFAULT_STATIONS;
    $out['station'] = array_values(array_filter(array_map(fn($x) => ole_clean_station((array)$x), $st)));
    $out['quality'] = ole_clean_quality((array)($r['quality'] ?? []));
    return $out;
}

/** One quality station, cleaned (null without a name). Old rows with only reason / dept get the defaults. */
function ole_clean_station(array $r): ?array
{
    $name = ole_txt($r['reason'] ?? '', 60);
    if ($name === '') return null;
    $type = in_array($r['type'] ?? '', OLE_STATION_TYPES, true) ? $r['type'] : 'inline';
    $flag = fn(string $k, bool $def) => array_key_exists($k, $r) ? !empty($r[$k]) && $r[$k] !== 'false' : $def;
    $lines = [];
    foreach ((array)($r['lines'] ?? []) as $l) { $n = filter_var($l, FILTER_VALIDATE_INT); if ($n !== false && $n >= 1 && $n <= 20) $lines[$n] = $n; }
    ksort($lines);
    $texts = function ($list, int $max) use ($name) { $o = []; foreach ((array)$list as $t) { $t = ole_txt($t, 60); if ($t !== '' && strcasecmp($t, $name) !== 0) $o[strtolower($t)] ??= $t; if (count($o) >= $max) break; } return array_values($o); };
    $dept = ole_txt($r['dept'] ?? '', 40);
    return ['reason' => $name, 'dept' => $dept !== '' ? $dept : 'Not set', 'code' => ole_txt($r['code'] ?? '', 12), 'type' => $type,
        'rty' => $flag('rty', true), 'active' => $flag('active', true), 'rework' => $flag('rework', true),
        'lines' => array_values($lines), 'defects' => $texts($r['defects'] ?? [], 80), 'aliases' => $texts($r['aliases'] ?? [], 10)];
}

/** FPY / RTY targets: 50 … 100 %. */
function ole_clean_quality(array $q): array
{
    $out = OLE_DEFAULT_QUALITY;
    foreach ($out as $k => $v) if (isset($q[$k]) && is_numeric($q[$k])) $out[$k] = round(max(50, min(100, (float)$q[$k])), 2);
    return $out;
}

/** Cleans the admin's reason lists: 1–40 rows each, reason and department text, no duplicate reason. */
function ole_clean_reasons(array $in): array
{
    $out = [];
    foreach (OLE_KINDS as $k) {
        $seen = []; $rows = [];
        foreach ((array)($in[$k] ?? []) as $r) {
            $reason = ole_txt($r['reason'] ?? '', 60); $dept = ole_txt($r['dept'] ?? '', 40); $owner = ole_txt($r['owner'] ?? '', 60);
            if ($reason === '' || isset($seen[strtolower($reason)])) continue;
            $seen[strtolower($reason)] = true;
            $rows[] = ['reason' => $reason, 'dept' => $dept !== '' ? $dept : 'Not set', 'owner' => $owner];
            if (count($rows) >= 80) break;
        }
        if (!$rows) throw new InvalidArgumentException("The $k list needs at least one reason");
        $out[$k] = $rows;
    }
    // quality stations: older screens do not send them (kept); up to 30, no duplicate name; an old name of a station
    // cannot be another station's name
    if (!isset($in['station'])) $out['station'] = ole_reasons()['station'];
    else {
        $seen = []; $rows = [];
        foreach ((array)$in['station'] as $r) {
            $c = ole_clean_station((array)$r);
            if (!$c || isset($seen[strtolower($c['reason'])])) continue;
            $seen[strtolower($c['reason'])] = true; $rows[] = $c;
            if (count($rows) >= 30) break;
        }
        if (!$rows) throw new InvalidArgumentException('The quality station list needs at least one station');
        foreach ($rows as &$c) $c['aliases'] = array_values(array_filter($c['aliases'], fn($a) => !isset($seen[strtolower($a)])));
        unset($c);
        $out['station'] = $rows;
    }
    $out['quality'] = isset($in['quality']) ? ole_clean_quality((array)$in['quality']) : ole_reasons()['quality'];
    return $out;
}

/** A whole-day planned stop, cleaned: date, line, off, a reason of the list, note. */
function ole_clean_day(array $b): array
{
    $d = (string)($b['date'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) || !checkdate((int)substr($d, 5, 2), (int)substr($d, 8, 2), (int)substr($d, 0, 4))) throw new InvalidArgumentException('date must be YYYY-MM-DD');
    $line = filter_var($b['line'] ?? null, FILTER_VALIDATE_INT);
    if ($line === false || $line < 1 || $line > 20) throw new InvalidArgumentException('line must be a line number');
    $off = !empty($b['off']);
    $reason = ole_txt($b['reason'] ?? '', 60);
    $known = null;
    foreach (OLE_DAY_REASONS as $r) if (strcasecmp($r, $reason) === 0) $known = $r;
    if ($off && $known === null) throw new InvalidArgumentException('Choose the reason of the whole-day stop');
    return ['date' => $d, 'line' => (int)$line, 'off' => $off, 'reason' => $known ?? '', 'note' => ole_txt($b['note'] ?? '', 200)];
}

/**
 * Morning entry of one line and day, cleaned: manpower and that day's shift (start, lunch, tea breaks, close) as 'HH:MM'.
 * Lunch and breaks must lie inside the shift; up to 6 breaks. Throws InvalidArgumentException on bad input.
 */
function ole_clean_setup(array $b): array
{
    $d = (string)($b['date'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) || !checkdate((int)substr($d, 5, 2), (int)substr($d, 8, 2), (int)substr($d, 0, 4))) throw new InvalidArgumentException('date must be YYYY-MM-DD');
    $line = filter_var($b['line'] ?? null, FILTER_VALIDATE_INT);
    if ($line === false || $line < 1 || $line > 20) throw new InvalidArgumentException('line must be a line number');
    $min = function ($t, string $what): int {
        if (!preg_match('/^([01]?\d|2[0-3]):([0-5]\d)$/', trim((string)$t), $m)) throw new InvalidArgumentException("$what must be a time HH:MM");
        return (int)$m[1] * 60 + (int)$m[2];
    };
    $hm = fn(int $m): string => sprintf('%02d:%02d', intdiv($m, 60), $m % 60);
    $st = $min($b['start'] ?? '', 'Start time'); $en = $min($b['end'] ?? '', 'Close time');
    if ($en <= $st) throw new InvalidArgumentException('Close time must be after the start time');
    $out = ['date' => $d, 'line' => (int)$line, 'start' => $hm($st), 'end' => $hm($en), 'lunchStart' => '', 'lunchEnd' => '', 'breaks' => []];
    if (trim((string)($b['lunchStart'] ?? '')) !== '' || trim((string)($b['lunchEnd'] ?? '')) !== '') {
        $ls = $min($b['lunchStart'] ?? '', 'Lunch start'); $le = $min($b['lunchEnd'] ?? '', 'Lunch end');
        if ($le <= $ls || $ls <= $st || $le >= $en) throw new InvalidArgumentException('Lunch must be inside the shift and end after it starts');
        $out['lunchStart'] = $hm($ls); $out['lunchEnd'] = $hm($le);
    }
    foreach (array_slice((array)($b['breaks'] ?? []), 0, 6) as $i => $x) {
        $x = (array)$x;
        if (trim((string)($x['start'] ?? '')) === '' && trim((string)($x['end'] ?? '')) === '') continue;
        $a = $min($x['start'] ?? '', 'Break start'); $z = $min($x['end'] ?? '', 'Break end');
        if ($z <= $a || $a < $st || $z > $en) throw new InvalidArgumentException('A tea break must be inside the shift and end after it starts');
        $out['breaks'][] = ['name' => ole_txt($x['name'] ?? '', 30) ?: 'Tea break', 'start' => $hm($a), 'end' => $hm($z)];
    }
    usort($out['breaks'], fn($p, $q) => strcmp($p['start'], $q['start']));
    $mp = $b['mp'] ?? null;
    if ($mp === null || $mp === '') $out['mp'] = null;
    else {
        $n = filter_var($mp, FILTER_VALIDATE_INT);
        if ($n === false || $n < 0 || $n > 1000) throw new InvalidArgumentException('Manpower must be a whole number 0–1000');
        $out['mp'] = $n;
    }
    // manpower at the close of the day too (the morning one is 'mp')
    $mc = $b['mpClose'] ?? null;
    if ($mc === null || $mc === '') $out['mpClose'] = null;
    else {
        $n = filter_var($mc, FILTER_VALIDATE_INT);
        if ($n === false || $n < 0 || $n > 1000) throw new InvalidArgumentException('Manpower at close must be a whole number 0–1000');
        $out['mpClose'] = $n;
    }
    $out['note'] = ole_txt($b['note'] ?? '', 200);
    return $out;
}

/** RCA evidence: [{id}] → [{id, name, type, size}] of files uploaded for an RCA (files.php), at most 10, unknown ids dropped */
function ole_evidence(array $list, array $files): array
{
    $types = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif', 'pdf' => 'application/pdf'];
    $out = [];
    foreach ($list as $x) {
        $id = is_array($x) ? (string)($x['id'] ?? '') : (string)$x;
        $f = $files[$id] ?? null;
        if (!preg_match('/^[a-f0-9]{24}$/', $id) || !$f || ($f['for'] ?? '') !== 'rca' || isset($out[$id])) continue;
        $ext = (string)($f['ext'] ?? '');
        $out[$id] = ['id' => $id, 'name' => (string)($f['name'] ?? "file.$ext"), 'type' => $types[$ext] ?? 'file', 'size' => (int)($f['size'] ?? 0)];
        if (count($out) >= 10) break;
    }
    return array_values($out);
}

/** One entry, cleaned (rows with 0 are dropped, departments looked up). Throws InvalidArgumentException on bad input. */
function ole_clean(array $e, array $reasons): array
{
    $d = (string)($e['date'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) || !checkdate((int)substr($d, 5, 2), (int)substr($d, 8, 2), (int)substr($d, 0, 4))) throw new InvalidArgumentException('date must be YYYY-MM-DD');
    $line = filter_var($e['line'] ?? null, FILTER_VALIDATE_INT);
    if ($line === false || $line < 1 || $line > 20) throw new InvalidArgumentException('line must be a line number');
    $hour = filter_var($e['hour'] ?? null, FILTER_VALIDATE_INT);
    if ($hour === false || $hour < 0 || $hour > 23) throw new InvalidArgumentException('hour must be 0–23');
    $stations = [];
    foreach (($reasons['station'] ?? []) as $r) {
        $stations[strtolower((string)$r['reason'])] = (string)$r['reason'];
        foreach ((array)($r['aliases'] ?? []) as $a) $stations[strtolower((string)$a)] ??= (string)$r['reason'];   // an old name → the station now
    }
    $rows = function (string $field, string $kind, string $numKey, int $max) use ($e, $reasons, $stations) {
        $dept = [];
        foreach ($reasons[$kind] as $r) $dept[strtolower($r['reason'])] = [$r['reason'], $r['dept'], (string)($r['owner'] ?? '')];
        $out = [];
        foreach ((array)($e[$field] ?? []) as $r) {
            $r = (array)$r;
            $v = $r[$numKey] ?? null;
            if ($v === null || $v === '' || (string)$v === '0') continue;
            $n = filter_var($v, FILTER_VALIDATE_INT);
            if ($n === false || $n < 1 || $n > $max) throw new InvalidArgumentException("$field: $numKey must be a whole number 1–$max");
            $reason = ole_txt($r['reason'] ?? '', 60);
            $manual = false;
            if (isset($dept[strtolower($reason)])) [$reason, $dp, $own] = $dept[strtolower($reason)];
            elseif ($reason === '') [$reason, $dp, $own] = ['Not given', 'Not set', ''];
            else {   // a reason typed on the entry page is kept as written, with the department chosen there
                $dp = ole_txt($r['dept'] ?? '', 40); $dp = $dp !== '' ? $dp : 'Not set'; $own = ''; $manual = true;
            }
            $row = ['model' => ole_txt($r['model'] ?? '', 80), 'reason' => $reason, 'dept' => $dp, $numKey => $n];
            if ($manual) $row['manual'] = true;
            if ($own !== '') $row['owner'] = $own;                                    // owner of the reason (HPR "Owner")
            $part = ole_txt($r['part'] ?? '', 60);
            if ($part !== '') $row['part'] = $part;                                   // part involved (HPR "Parts Involved")
            if ($numKey === 'qty') {   // rejection / rework: the quality station (the list's spelling, or the text as given)
                $st = ole_txt($r['station'] ?? '', 60);
                $row = ['station' => $stations[strtolower($st)] ?? $st] + $row;
                // 20-11-2026: category (Production / Assy / Part / Process), root cause, action, pieces dismantled
                $cat = ole_txt($r['cat'] ?? '', 20);
                foreach (OLE_QCATS as $c) if (strcasecmp($c, $cat) === 0) { $row['cat'] = $c; break; }
                $cause = ole_txt($r['cause'] ?? '', 200); if ($cause !== '') $row['cause'] = $cause;
                $act = ole_txt($r['action'] ?? '', 200); if ($act !== '') $row['action'] = $act;
                $dm = $r['dismantle'] ?? null;
                if ($dm !== null && $dm !== '' && $dm !== false && (string)$dm !== '0') {
                    $dn = filter_var($dm, FILTER_VALIDATE_INT);
                    if ($dn === false || $dn < 0 || $dn > $n) throw new InvalidArgumentException("$field: dismantled pieces must be a whole number 0–$n");
                    if ($dn > 0) $row['dismantle'] = $dn;
                }
            }
            $out[] = $row;
            if (count($out) > 20) throw new InvalidArgumentException("$field: at most 20 rows in one hour");
        }
        return $out;
    };
    $stops = $rows('stops', 'stop', 'min', 60);
    $losses = $rows('losses', 'loss', 'min', 60);
    if (array_sum(array_column($stops, 'min')) > 60) throw new InvalidArgumentException('Planned stoppage of one hour cannot be more than 60 minutes');
    if (array_sum(array_column($stops, 'min')) + array_sum(array_column($losses, 'min')) > 60) throw new InvalidArgumentException('Planned stoppage + unplanned loss of one hour cannot be more than 60 minutes');
    $rejects = $rows('rejects', 'reject', 'qty', 100000); $rework = $rows('rework', 'rework', 'qty', 100000);
    $out = ['date' => $d, 'line' => (int)$line, 'hour' => (int)$hour, 'stops' => $stops, 'losses' => $losses,
            'rejects' => $rejects, 'rework' => $rework,
            'note' => ole_txt($e['note'] ?? '', 300)];
    // 20-11-2026: "No loss" saved by the line — the hour is checked and lost no time (only when no loss row is written)
    if (!empty($e['noLoss']) && filter_var($e['noLoss'], FILTER_VALIDATE_BOOLEAN) && !$stops && !$losses) $out['noLoss'] = true;
    // 23-11-2026: "No defects" saved by the quality page — the hour was checked, no rejection / rework found
    if (!empty($e['noQ']) && filter_var($e['noQ'], FILTER_VALIDATE_BOOLEAN) && !$rejects && !$rework) $out['noQ'] = true;
    return $out;
}

$body = store_begin();
if ($body === null) {
    $ymd = '/^\d{4}-\d{2}-\d{2}$/';
    $start = $_GET['start'] ?? '0000-01-01'; $end = $_GET['end'] ?? '9999-12-31';
    if (!preg_match($ymd, $start) || !preg_match($ymd, $end)) store_fail(400, 'start and end must be YYYY-MM-DD');
    $all = store_read('ole_hourly', ['entries' => []]);
    $out = [];
    foreach (($all['entries'] ?? []) as $k => $e) {
        if (($e['date'] ?? '') < $start || ($e['date'] ?? '') > $end) continue;
        if (!auth_line_ok((int)($e['line'] ?? 0))) continue;                     // a line login sees only its lines
        $out[$k] = $e;
    }
    $rca = [];
    foreach ((store_read('ole_rca', ['items' => []])['items'] ?? []) as $k => $r) {
        if (($r['date'] ?? '') < $start || ($r['date'] ?? '') > $end || !auth_line_ok((int)($r['line'] ?? 0))) continue;
        $rca[$k] = $r;
    }
    $days = [];
    foreach ((store_read('ole_days', ['days' => []])['days'] ?? []) as $k => $r) {
        if (($r['date'] ?? '') < $start || ($r['date'] ?? '') > $end || !auth_line_ok((int)($r['line'] ?? 0))) continue;
        $days[$k] = $r;
    }
    $setup = [];
    foreach ((store_read('ole_setup', ['setups' => []])['setups'] ?? []) as $k => $r) {
        if (($r['date'] ?? '') < $start || ($r['date'] ?? '') > $end || !auth_line_ok((int)($r['line'] ?? 0))) continue;
        $setup[$k] = $r;
    }
    $kpi = [];
    foreach ((store_read('ole_kpi', ['rows' => []])['rows'] ?? []) as $k => $r) {
        if (($r['date'] ?? '') < $start || ($r['date'] ?? '') > $end || !auth_line_ok((int)($r['line'] ?? 0))) continue;
        $kpi[$k] = $r;
    }
    store_send(json_encode(['entries' => (object)$out, 'reasons' => ole_reasons(), 'rca' => (object)$rca, 'days' => (object)$days, 'dayReasons' => OLE_DAY_REASONS, 'setup' => (object)$setup, 'kpi' => (object)$kpi], JSON_UNESCAPED_UNICODE));
    exit;
}

$isAdmin = $me && ($me['role'] ?? '') === 'admin';
try {
    $action = (string)($body['action'] ?? '');
    if ($action === 'reasons') {
        if (!$isAdmin) store_fail(403, 'Only the admin can change the reason list.');
        $r = ole_clean_reasons((array)($body['reasons'] ?? []));
        store_update('ole_reasons', fn() => $r, []);
        echo json_encode(['ok' => true, 'reasons' => $r], JSON_UNESCAPED_UNICODE);
        exit;
    }
    if ($action === 'rca') {
        $myDept = strtolower(trim((string)($me['dept'] ?? '')));
        $entries = store_read('ole_hourly', ['entries' => []])['entries'] ?? [];
        $in = (array)($body['items'] ?? []);
        if (!$in || count($in) > 100) store_fail(400, 'Send 1–100 RCA items');
        $clean = [];
        foreach ($in as $it) {
            $it = (array)$it;
            $d = (string)($it['date'] ?? ''); $line = (int)($it['line'] ?? 0); $kind = (string)($it['kind'] ?? ''); $reason = ole_txt($it['reason'] ?? '', 60);
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) || $line < 1 || !in_array($kind, OLE_KINDS, true) || $reason === '') store_fail(400, 'date, line, kind and reason are needed');
            if (!auth_line_ok($line)) store_fail(403, "This login cannot see Line $line.");
            // the loss must exist; its department comes from the saved rows (not from the browser)
            $field = ['stop' => 'stops', 'loss' => 'losses', 'reject' => 'rejects', 'rework' => 'rework'][$kind];
            $dept = null;
            foreach ($entries as $e) {
                if (($e['date'] ?? '') !== $d || (int)($e['line'] ?? 0) !== $line) continue;
                foreach ((array)($e[$field] ?? []) as $r) if (strcasecmp((string)($r['reason'] ?? ''), $reason) === 0) { $dept = (string)($r['dept'] ?? 'Not set'); $reason = (string)$r['reason']; }
            }
            if ($dept === null) store_fail(400, "No $kind \"$reason\" on Line $line, $d.");
            // one department under one name (as the RCA page shows it): Maintenance = Maint, Production = Prod …
            $alias = ['production' => 'prod', 'maintenance' => 'maint', 'stores / scm' => 'kitting store', 'sqa / purchase' => 'supplier'];
            $dn = function ($d) use ($alias) { $d = strtolower(trim((string)$d)); return $alias[$d] ?? $d; };
            if (!$isAdmin && ($myDept === '' || $dn($myDept) !== $dn($dept))) store_fail(403, "Only the admin or a $dept login can write this RCA.");
            $status = in_array($it['status'] ?? '', ['submitted', 'closed'], true) ? $it['status'] : 'submitted';
            if ($status === 'closed' && !$isAdmin && trim((string)($it['action'] ?? '')) === '') store_fail(400, 'Write the corrective action before closing.');
            $td = (string)($it['targetDate'] ?? '');
            // 20-11-2026: 5-Why (why 1 … why 5) and the close date (the day the action was done; today when closed without one)
            $whys = array_slice(array_map(fn($w) => ole_txt($w, 300), array_values((array)($it['whys'] ?? []))), 0, 7);   // 27-11-2026: up to 7 whys (3 at least on the form)
            while ($whys && end($whys) === '') array_pop($whys);
            $cd = (string)($it['closeDate'] ?? '');
            $cd = preg_match('/^\d{4}-\d{2}-\d{2}$/', $cd) ? $cd : '';
            if ($status === 'closed' && $cd === '') $cd = substr(ems_now(), 0, 10);
            if ($status !== 'closed') $cd = '';
            // 20-11-2026: evidence — photos / files added through files.php (only ids that were really uploaded for an RCA)
            $ev = ole_evidence((array)($it['evidence'] ?? []), $files ??= (store_read('ole_files', ['files' => []])['files'] ?? []));
            $rc = ole_txt($it['rootCause'] ?? '', 1000);
            if ($rc === '' && $whys) { $nz = array_values(array_filter($whys, fn($w) => $w !== '')); $rc = $nz ? end($nz) : ''; }   // the last why is the root cause
            $capa = capa_clean($it['capa'] ?? null);   // 24-11-2026: the CAPA form (null: not sent — the saved one is kept)
            // 27-11-2026: the 6M category of the root cause (Man · Machine · Material · Method · Measurement · Environment)
            $cat = in_array($it['cat'] ?? '', ['Man', 'Machine', 'Material', 'Method', 'Measurement', 'Environment'], true) ? $it['cat'] : '';
            $clean[] = ['date' => $d, 'line' => $line, 'kind' => $kind, 'reason' => $reason, 'dept' => $dept, 'capa' => $capa, 'cat' => $cat,
                'rootCause' => $rc, 'whys' => $whys, 'action' => ole_txt($it['action'] ?? '', 1000), 'preventive' => ole_txt($it['preventive'] ?? '', 1000),
                'owner' => ole_txt($it['owner'] ?? '', 60), 'targetDate' => preg_match('/^\d{4}-\d{2}-\d{2}$/', $td) ? $td : '', 'closeDate' => $cd, 'status' => $status, 'evidence' => array_key_exists('evidence', $it) ? $ev : null];
            if ($clean[count($clean) - 1]['rootCause'] === '') store_fail(400, 'Write the root cause.');
        }
        $now = ems_now(); $who = (string)($me['user'] ?? 'admin');
        store_update('ole_rca', function (array $d) use ($clean, $now, $who) {
            $list = $d['items'] ?? [];
            foreach ($clean as $c) {
                $k = "{$c['date']}|{$c['line']}|{$c['kind']}|{$c['reason']}";
                if ($c['evidence'] === null) $c['evidence'] = $list[$k]['evidence'] ?? [];   // an older page that sends no evidence keeps it
                if ($c['capa'] === null) { if (isset($list[$k]['capa'])) $c['capa'] = $list[$k]['capa']; else unset($c['capa']); }
                $list[$k] = $c + ['submittedBy' => $list[$k]['submittedBy'] ?? $who, 'submittedAt' => $list[$k]['submittedAt'] ?? $now, 'updatedBy' => $who, 'updatedAt' => $now]
                           + ($c['status'] === 'closed' ? ['closedBy' => $who, 'closedAt' => $now] : []);
            }
            return ['items' => $list];
        }, ['items' => []]);
        echo json_encode(['ok' => true, 'saved' => count($clean)], JSON_UNESCAPED_UNICODE);
        exit;
    }
    if (!in_array($action, ['save', 'day', 'setup', 'kpi'], true)) store_fail(400, 'action must be save, day, setup, kpi, reasons or rca');
    $canFill = $isAdmin || ($me && ($me['role'] ?? '') === 'management' && !empty($me['oleEdit']));
    if (!$canFill) store_fail(403, 'This login cannot fill the OLE entries. The admin can allow it under Users and passwords.');
    // A login with its own page list (Users & logins) fills only what its pages show: Loss entry → stoppage / loss
    // minutes and "line off all day"; Quality entry → rejection / rework; Morning entry → the morning setup.
    // The other values of the same hour stay as they are. (No own list: the pages ticked in Setup → Management view.)
    $own = $isAdmin ? [] : array_values(array_map('strval', (array)($me['pages'] ?? [])));
    if (!$isAdmin && !$own) {
        $mv = ui_clean(store_read('ui_settings'))['management']['pages'] ?? [];
        $own = array_values(array_map(fn($p) => (string)$p['id'], array_filter($mv, fn($p) => !empty($p['on']))));
    }
    $may = fn(string $page): bool => $isAdmin || in_array($page, $own, true);
    if ($action === 'kpi') {   // KPI entry: the report's own numbers of one line and day
        if (!$may('kpientry')) store_fail(403, 'This login does not have the KPI entry page.');
        $date = (string)($body['date'] ?? ''); $ln = (int)($body['line'] ?? 0);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || $ln < 1 || $ln > 20) store_fail(400, 'date and line are needed');
        if (!auth_line_ok($ln)) store_fail(403, "This login cannot fill Line $ln.");
        $row = ['date' => $date, 'line' => $ln];
        $any = false;
        foreach (OLE_KPI_FIELDS as $f => $max) {
            $v = $body[$f] ?? null;
            if ($v === null || $v === '') continue;
            if (!is_numeric($v) || (float)$v < 0 || (float)$v > $max) store_fail(400, "$f must be a number from 0 to $max");
            $row[$f] = round((float)$v, 2); $any = true;
        }
        $note = ole_txt($body['note'] ?? '', 300);
        if ($note !== '') { $row['note'] = $note; $any = true; }
        $row['by'] = (string)($me['user'] ?? 'admin'); $row['at'] = ems_now();
        store_update('ole_kpi', function (array $d) use ($row, $any) { $l = $d['rows'] ?? []; $k = $row['date'] . '|' . $row['line']; if ($any) $l[$k] = $row; else unset($l[$k]); return ['rows' => $l]; }, ['rows' => []]);
        store_send(json_encode(['ok' => true, 'row' => $any ? $row : null], JSON_UNESCAPED_UNICODE));
        exit;   // 20-11-2026: the answer ends here (it went on into the hour save below: a second answer and an empty save)
    }
    if ($action === 'setup') {   // morning entry: manpower + that day's shift of one line (clear:true removes it)
        if (!$may('daily')) store_fail(403, 'This login does not have the Morning entry page.');
        $date = (string)($body['date'] ?? ''); $ln = (int)($body['line'] ?? 0);
        if (!empty($body['clear'])) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || $ln < 1) store_fail(400, 'date and line are needed');
            if (!auth_line_ok($ln)) store_fail(403, "This login cannot fill Line $ln.");
            store_update('ole_setup', function (array $d) use ($date, $ln) { $l = $d['setups'] ?? []; unset($l["$date|$ln"]); return ['setups' => $l]; }, ['setups' => []]);
            echo json_encode(['ok' => true, 'cleared' => true], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $c = ole_clean_setup($body);
        if (!auth_line_ok($c['line'])) store_fail(403, "This login cannot fill Line {$c['line']}.");
        $now = ems_now(); $who = (string)($me['user'] ?? 'admin');
        $row = $c + ['by' => $who, 'at' => $now];
        store_update('ole_setup', function (array $d) use ($row) { $l = $d['setups'] ?? []; $l[$row['date'] . '|' . $row['line']] = $row; return ['setups' => $l]; }, ['setups' => []]);
        echo json_encode(['ok' => true, 'setup' => $row], JSON_UNESCAPED_UNICODE);
        exit;
    }
    if ($action === 'day') {
        if (!$may('oleentry') && !$may('lqentry')) store_fail(403, 'This login does not have the Loss entry page.');
        $c = ole_clean_day($body);
        if (!auth_line_ok($c['line'])) store_fail(403, "This login cannot fill Line {$c['line']}.");
        $now = ems_now(); $who = (string)($me['user'] ?? 'admin');
        store_update('ole_days', function (array $d) use ($c, $now, $who) {
            $list = $d['days'] ?? [];
            $k = $c['date'] . '|' . $c['line'];
            if ($c['off']) $list[$k] = ['date' => $c['date'], 'line' => $c['line'], 'reason' => $c['reason'], 'note' => $c['note'], 'by' => $who, 'at' => $now];
            else unset($list[$k]);
            return ['days' => $list];
        }, ['days' => []]);
        echo json_encode(['ok' => true, 'off' => $c['off']], JSON_UNESCAPED_UNICODE);
        exit;
    }
    // "Loss & quality entry" (lqentry, 19-11-2026) fills both parts of the hour
    $mayLoss = $may('oleentry') || $may('lqentry'); $mayQuality = $may('qentry') || $may('lqentry');
    if (!$mayLoss && !$mayQuality) store_fail(403, 'This login has neither the Loss entry nor the Quality entry page.');
    $in = (array)($body['entries'] ?? []);
    if (count($in) > 500) store_fail(400, 'Too many entries at once');
    $reasons = ole_reasons();
    $clean = array_map(fn($e) => ole_clean((array)$e, $reasons), $in);
    // 23-11-2026: which part of the hour the page writes — 'loss' (Loss entry), 'quality' (Quality entry) or 'both';
    // the other part stays as the server has it, so two people on the two pages never wipe each other's rows
    foreach ($in as $i => $e) { $p = is_array($e) ? (string)($e['part'] ?? '') : ''; $clean[$i]['part'] = in_array($p, ['loss', 'quality'], true) ? $p : 'both'; }
    foreach ($clean as $e) if (!auth_line_ok($e['line'])) store_fail(403, "This login cannot fill Line {$e['line']}.");
    $now = ems_now();
    $who = (string)($me['user'] ?? 'admin');
    store_update('ole_hourly', function (array $d) use ($clean, $now, $who, $mayLoss, $mayQuality) {
        $list = $d['entries'] ?? [];
        foreach ($clean as $e) {
            $k = $e['date'] . '|' . $e['line'] . '|' . $e['hour'];
            $old = (array)($list[$k] ?? []);
            $part = $e['part'] ?? 'both'; unset($e['part']);
            if (!$mayLoss || $part === 'quality') {   // only Quality entry: the loss part (and its "No loss") stays as it was
                $e['stops'] = $old['stops'] ?? []; $e['losses'] = $old['losses'] ?? [];
                unset($e['noLoss']); if (!empty($old['noLoss'])) { $e['noLoss'] = true; $e['noLossBy'] = $old['noLossBy'] ?? ''; $e['noLossAt'] = $old['noLossAt'] ?? ''; }
            } elseif (!empty($e['noLoss'])) {   // who checked the hour and when (kept when it was already checked)
                $e['noLossBy'] = !empty($old['noLoss']) ? ($old['noLossBy'] ?? $who) : $who;
                $e['noLossAt'] = !empty($old['noLoss']) ? ($old['noLossAt'] ?? $now) : $now;
            }
            if (!$mayQuality || $part === 'loss') {   // only Loss entry: the quality part (and its "No defects") stays as it was
                $e['rejects'] = $old['rejects'] ?? []; $e['rework'] = $old['rework'] ?? [];
                unset($e['noQ']); if (!empty($old['noQ'])) { $e['noQ'] = true; $e['noQBy'] = $old['noQBy'] ?? ''; $e['noQAt'] = $old['noQAt'] ?? ''; }
            } elseif (!empty($e['noQ'])) {
                $e['noQBy'] = !empty($old['noQ']) ? ($old['noQBy'] ?? $who) : $who;
                $e['noQAt'] = !empty($old['noQ']) ? ($old['noQAt'] ?? $now) : $now;
            }
            $empty = !$e['stops'] && !$e['losses'] && !$e['rejects'] && !$e['rework'] && $e['note'] === '' && empty($e['noLoss']) && empty($e['noQ']);
            if ($empty) unset($list[$k]); else $list[$k] = $e + ['updatedAt' => $now, 'updatedBy' => $who];
        }
        return ['entries' => $list];
    }, ['entries' => []]);
    echo json_encode(['ok' => true, 'saved' => count($clean)], JSON_UNESCAPED_UNICODE);
} catch (InvalidArgumentException $e) {
    store_fail(400, $e->getMessage());
} catch (Throwable $e) {
    store_fail(500, 'Could not save: ' . $e->getMessage());
}
