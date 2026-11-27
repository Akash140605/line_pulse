<?php
/**
 * Screen setup chosen by the admin (Setup page): which pages each login sees, their order and names,
 * the management home page, what One view shows, the look (name, tagline), the theme (colours, fonts, text size) and the target rule
 * (targetRule: Method A from this date, + allowance seconds, gap limit, minimum valid gaps).
 * Kept in data/ui_settings.json. Only known page ids and values are stored (ui_clean).
 */
declare(strict_types=1);
require_once __DIR__ . '/capa.php';

const UI_MGMT_IDS = ['dash', 'overview', 'live', 'summary', 'hourly', 'control', 'targets', 'losses', 'models', 'ai', 'explorer', 'rejection', 'trends', 'pareto', 'targetcheck', 'linetargets', 'ole', 'oleentry', 'qentry', 'rca', 'capaday', 'idleday', 'capatrack', 'quality', 'oleview', 'olea', 'olep', 'oleq', 'olecal', 'olemonth', 'entrydash', 'oledrill', 'lossan', 'daily', 'rejan', 'rwkan', 'kpientry', 'lqentry', 'reports', 'kpidash', 'rcadash', 'rwkdash', 'serials', 'custprod', 'qdash', 'adash', 'pdash'];   // serials: carton & serial report (23-11-2026) · lossan: loss analysis (dept / reason Pareto), daily: morning entry   // quality (FPY / RTY): off until the admin turns it on
const UI_MGMT_DEFAULT_ON = ['dash', 'overview', 'live', 'summary', 'hourly', 'control', 'targets', 'losses', 'ole', 'oleentry', 'qentry', 'rca', 'capaday', 'idleday', 'capatrack', 'lossan', 'rejan', 'rwkan', 'qdash', 'oleview', 'olea', 'olep', 'oleq', 'olecal', 'olemonth', 'oledrill', 'rwkdash', 'rcadash', 'kpidash', 'custprod', 'quality', 'entrydash', 'reports', 'adash', 'pdash'];   // rejan / rwkan: Rejection / Rework analysis
// 24-11-2026: the review pages of management — switched on once for a saved Setup older than this (mgmtV < 2); after that the admin's choice stays
const UI_MGMT_REVIEW = ['dash', 'overview', 'oleview', 'olea', 'olep', 'oleq', 'olecal', 'olemonth', 'oledrill', 'qdash', 'rwkdash', 'rcadash', 'kpidash', 'custprod', 'lossan', 'rejan', 'rwkan', 'quality', 'entrydash', 'reports', 'adash', 'pdash'];
const UI_ADMIN_IDS = ['overview', 'dash', 'oleview', 'olea', 'olep', 'oleq', 'olecal', 'olemonth', 'oledrill', 'ole', 'daily', 'oleentry', 'qentry', 'rca', 'capaday', 'idleday', 'capatrack', 'entrydash', 'lossan', 'rejan', 'rwkan', 'quality', 'master', 'linetargets', 'targetcheck', 'ai', 'targets', 'methodplan', 'analysis', 'distribution', 'pareto', 'models', 'explorer', 'trends', 'control', 'stdcycle', 'hourly', 'rejection', 'lqentry', 'kpidash', 'rcadash', 'rwkdash', 'kpientry', 'reports', 'repcmp', 'formulas', 'serials', 'custprod', 'qdash', 'universe', 'capa', 'adash', 'pdash'];
// targets from the data of 01-08-2026 to 31-10-2026 (fixed window, 14-11-2026); 'to' => '' = up to today
// Menu folders (19-11-2026, as the C8 MES): every page in one folder; the admin names / orders them (Setup → Menu folders)
const UI_FOLDER_DEFAULT = [
    ['name' => 'Overview', 'ids' => ['dash', 'overview', 'live', 'summary', 'oleview', 'olecal', 'olemonth', 'oledrill', 'ole']],
    ['name' => 'Entry', 'ids' => ['daily', 'lqentry', 'oleentry', 'qentry', 'kpientry', 'entrydash']],   // 20-11-2026: entry pages in their own folder
    ['name' => 'Availability', 'ids' => ['adash', 'olea', 'idleday', 'lossan', 'losses']],
    ['name' => 'Performance', 'ids' => ['pdash', 'olep', 'hourly', 'analysis', 'distribution', 'stdcycle', 'control', 'trends']],
    ['name' => 'Quality', 'ids' => ['qdash', 'oleq', 'rca', 'capaday', 'capatrack', 'capa', 'rcadash', 'rwkdash', 'rejan', 'rwkan', 'quality', 'rejection']],
    ['name' => 'Analysis', 'ids' => ['ai', 'pareto', 'models', 'explorer', 'universe']],
    ['name' => 'Targets', 'ids' => ['master', 'linetargets', 'targetcheck', 'targets', 'methodplan']],
    ['name' => 'Reports', 'ids' => ['kpidash', 'reports', 'custprod', 'serials', 'repcmp', 'formulas', 'setup']],
];
const UI_RULE_DEFAULT = ['from' => '2026-08-01', 'to' => '2026-10-31', 'add' => 3, 'cap' => 22, 'min' => 20, 'low' => 1];

/**
 * Target rule: Method A from date `from` (YYYY-MM-DD) with the valid gaps low..cap s (gaps below `low` — double scans,
 * glitches — and above `cap` — stops — are eliminated), target = A + add s; needs at least `min` valid gaps.
 */
function ui_rule($r): array
{
    $r = is_array($r) ? $r : [];
    $d = UI_RULE_DEFAULT;
    $from = (string)($r['from'] ?? $d['from']);
    $ok = preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) && checkdate((int)substr($from, 5, 2), (int)substr($from, 8, 2), (int)substr($from, 0, 4));
    $num = fn($k, $lo, $hi) => is_numeric($r[$k] ?? null) ? max($lo, min($hi, (int)round((float)$r[$k]))) : $d[$k];
    $add = $num('add', 0, 30);
    // per line: method A (most common + allowance) / B (% rule) / C (average), allowance seconds, B percent
    $lines = [];
    foreach (['1', '2', '3', '4'] as $l) {
        $c = (isset($r['lines']) && is_array($r['lines']) && isset($r['lines'][$l]) && is_array($r['lines'][$l])) ? $r['lines'][$l] : [];
        $m = in_array($c['method'] ?? null, ['A', 'B', 'C', 'D'], true) ? $c['method'] : 'A';   // D = cycle time of the Model master
        $a = is_numeric($c['add'] ?? null) ? max(0, min(30, round((float)$c['add'], 1))) : ($m === 'A' ? $add : 0);
        $p = is_numeric($c['pct'] ?? null) ? (int)max(50, min(95, round((float)$c['pct']))) : 70;
        $lines[$l] = ['method' => $m, 'add' => $a, 'pct' => $p];
    }
    $cap = $num('cap', 5, 120);
    // the lowest valid gap: 0 … 60 s to 0.1 s, always below the cap
    $low = is_numeric($r['low'] ?? null) ? max(0, min(60, round((float)$r['low'], 1))) : $d['low'];
    if ($low >= $cap) $low = max(0, $cap - 1);
    $from = $ok ? $from : $d['from'];
    // end of the data window: a real date not before the start, '' = up to today, missing = the default
    $to = array_key_exists('to', $r) ? (string)$r['to'] : $d['to'];
    if ($to !== '') {
        $tok = preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) && checkdate((int)substr($to, 5, 2), (int)substr($to, 8, 2), (int)substr($to, 0, 4));
        if (!$tok || $to < $from) $to = $d['to'] >= $from ? $d['to'] : '';
    }
    return ['from' => $from, 'to' => $to, 'add' => $add, 'cap' => $cap, 'min' => $num('min', 5, 500), 'low' => $low, 'lines' => $lines, 'plan' => ui_plan($r['plan'] ?? [], $add)];
}

/**
 * 20-11-2026: target method by date — [{line, from, method, add, pct, note?}]: from that day on the line uses that method
 * (until its next change); the days before the first change use the line's starting method (lines). One change per line
 * and day (the last one sent wins), at most 60, sorted by line and date (mirrors normalizePlan in frontend utils/uiSettings.js).
 */
function ui_plan($list, $add): array
{
    $by = [];
    foreach (is_array($list) ? $list : [] as $p) {
        if (!is_array($p)) continue;
        $l = (string)($p['line'] ?? '');
        $f = (string)($p['from'] ?? '');
        $m = $p['method'] ?? null;
        if (!in_array($l, ['1', '2', '3', '4'], true) || !in_array($m, ['A', 'B', 'C', 'D'], true)) continue;
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $f) || !checkdate((int)substr($f, 5, 2), (int)substr($f, 8, 2), (int)substr($f, 0, 4))) continue;
        $a = is_numeric($p['add'] ?? null) ? max(0, min(30, round((float)$p['add'], 1))) : ($m === 'A' ? $add : 0);
        $pc = is_numeric($p['pct'] ?? null) ? (int)max(50, min(95, round((float)$p['pct']))) : 70;
        $note = mb_substr(trim(str_replace(['<', '>'], '', (string)($p['note'] ?? ''))), 0, 80);
        $who = mb_substr(trim(str_replace(['<', '>'], '', (string)($p['by'] ?? ''))), 0, 40);
        $at = preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', (string)($p['at'] ?? '')) ? (string)$p['at'] : '';
        $by["$l|$f"] = ['line' => $l, 'from' => $f, 'method' => $m, 'add' => $a, 'pct' => $pc] + ($note !== '' ? ['note' => $note] : []) + ($who !== '' ? ['by' => $who] : []) + ($at !== '' ? ['at' => $at] : []);
    }
    ksort($by, SORT_STRING);
    return array_slice(array_values($by), 0, 60);
}
const UI_KPIS = ['produced', 'plan', 'achievement', 'short', 'lost', 'running'];
const UI_COLORS = ['navy', 'charcoal', 'teal', 'maroon', 'indigo'];
// old sidebar colours (before Setup → Theme): a saved non-navy choice becomes the theme's sidebar colour
const UI_COLOR_HEX = ['charcoal' => '#1F2937', 'teal' => '#0F3D3E', 'maroon' => '#4A1520', 'indigo' => '#1E1B4B'];
// Setup → Theme (mirrors normalizeTheme in frontend/src/utils/themeEngine.js); default = the standard navy blue
const UI_THEME_DEFAULT = [
    'preset' => 'navy', 'primary' => '#0B3A74', 'accent' => '#DC2626', 'data' => '#0EA5E9', 'page' => '#EEF1F5', 'sidebar' => '#0B2545',
    'lines' => ['1' => '#2F6FD0', '2' => '#12866F', '3' => '#C9821A', '4' => '#7A4FB8'],
    'font' => 'archivo', 'mono' => 'archivonum', 'scale' => 100, 'tvScale' => 100,
];
const UI_THEME_PRESETS = ['oee', 'navy', 'dixon', 'mes', 'charcoal', 'custom', 'teal', 'forest', 'plum', 'steel'];   // oee = Dixon OEE standard (H1–H6 + palette)
const UI_FONTS = ['archivo', 'plex', 'inter', 'roboto', 'noto', 'poppins', 'segoe'];       // archivo = Dixon style, built into the app
const UI_MONOS = ['archivonum', 'plexmono', 'robotomono', 'jetbrains', 'consolas'];

/** Theme: only #RRGGBB colours, known fonts, text size 80–130 %, TV size 80–150 %. */
function ui_theme($t, ?string $legacySidebar = null): array
{
    $t = is_array($t) ? $t : [];
    $d = UI_THEME_DEFAULT;
    $hex = fn($v, string $def) => is_string($v) && preg_match('/^#[0-9A-Fa-f]{6}$/', $v) ? strtoupper($v) : $def;
    $num = fn($v, int $lo, int $hi, int $def) => is_numeric($v) ? max($lo, min($hi, (int)round((float)$v))) : $def;
    $lines = [];
    foreach (['1', '2', '3', '4'] as $l) $lines[$l] = $hex($t['lines'][$l] ?? null, $d['lines'][$l]);
    return [
        'preset' => in_array($t['preset'] ?? '', UI_THEME_PRESETS, true) ? $t['preset'] : 'navy',
        'primary' => $hex($t['primary'] ?? null, $d['primary']), 'accent' => $hex($t['accent'] ?? null, $d['accent']),
        'data' => $hex($t['data'] ?? null, $d['data']), 'page' => $hex($t['page'] ?? null, $d['page']),
        'sidebar' => $hex($t['sidebar'] ?? null, $legacySidebar ?? $d['sidebar']),
        'lines' => $lines,
        'font' => in_array($t['font'] ?? '', UI_FONTS, true) ? $t['font'] : $d['font'],
        'mono' => in_array($t['mono'] ?? '', UI_MONOS, true) ? $t['mono'] : $d['mono'],
        'scale' => $num($t['scale'] ?? null, 80, 130, 100), 'tvScale' => $num($t['tvScale'] ?? null, 80, 150, 100),
    ];
}

function ui_text($v, int $max, string $def): string
{
    $s = trim(preg_replace('/[\x00-\x1F\x7F<>]/u', '', (string)($v ?? '')));
    if ($s === '') return $def;
    return mb_substr($s, 0, $max);
}

/** Ordered page list: every known id exactly once (unknown ids dropped; ids missing from a saved list appended, on = $missingOn). */
function ui_pages($list, array $ids, array $defaultOn, bool $missingOn = false): array
{
    $out = []; $seen = [];
    foreach (is_array($list) ? $list : [] as $p) {
        $id = is_array($p) ? (string)($p['id'] ?? '') : '';
        if (!in_array($id, $ids, true) || isset($seen[$id])) continue;
        $seen[$id] = true;
        $row = ['id' => $id, 'on' => !empty($p['on'])];
        $label = isset($p['label']) ? ui_text($p['label'], 40, '') : '';
        if ($label !== '') $row['label'] = $label;
        $out[] = $row;
    }
    // a page that is newer than the saved list (e.g. OLE, Loss entry, RCA) starts as its default, not hidden
    foreach ($ids as $id) if (!isset($seen[$id])) $out[] = ['id' => $id, 'on' => is_array($list) ? ($missingOn || in_array($id, $defaultOn, true)) : in_array($id, $defaultOn, true)];
    return $out;
}

/**
 * HPR report: Loss (₹) = rate × manpower × I/T hours; hours from otFrom on count otX times (overtime).
 * Defaults as in the plant's HPR: ₹65 per man-hour, ×2 from 18:00.
 */
function ui_hpr($h): array
{
    $h = is_array($h) ? $h : [];
    $rate = is_numeric($h['rate'] ?? null) ? round(max(0, min(10000, (float)$h['rate'])), 2) : 65.0;
    $x = is_numeric($h['otX'] ?? null) ? round(max(1, min(5, (float)$h['otX'])), 2) : 2.0;
    $from = preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string)($h['otFrom'] ?? '')) ? (string)$h['otFrom'] : '18:00';
    return ['rate' => $rate, 'otFrom' => $from, 'otX' => $x];
}

/**
 * OLE formulas chosen by the admin — mirrors normalizeOle in src/utils/uiSettings.js.
 *   mpSync / mpUse / mpUp / stdMp   manpower sync of the std cycle · good / watch  OLE colours (%) · fewPcs · timeFmt 'h1' | 'hm'
 *   aEnd  'lastScan' | 'shiftEnd'   a finished day's time runs up to its last scan, or to the shift close
 *   aLoss 'all' | 'unplanned'       every minute entered is a loss, or old planned stops are taken out of the planned time
 *   pBase 'run' | 'planned'         Performance = std time ÷ run time, or ÷ planned time
 *   pCap  bool                      Performance at most 100 %
 *   qMode 'rej' | 'rejRework'       Quality = (made − rejected) ÷ made, or (made − rejected − rework) ÷ made
 */
function ui_ole($o): array
{
    $o = is_array($o) ? $o : [];
    $pick = fn(string $k, array $ok) => in_array($o[$k] ?? '', $ok, true) ? $o[$k] : $ok[0];
    $int = fn($v, int $lo, int $hi, int $d) => is_numeric($v) ? max($lo, min($hi, (int)round((float)$v))) : $d;
    // 19-11-2026 (bench 2): OLE good from 95 % · watch 85 %, Performance at most 100 % — a setup saved before gets these once
    $old = !((int)($o['bench'] ?? 0) >= 2);
    $good = $old ? 95 : $int($o['good'] ?? null, 50, 100, 95);
    // A · P · Q benchmarks (19-11-2026): good from 95 %, watch from 85 % unless the admin sets them
    $apq = [];
    foreach (['A', 'P', 'Q'] as $k) { $g = $int($o['good' . $k] ?? null, 50, 100, 95); $apq['good' . $k] = $g; $apq['watch' . $k] = $int($o['watch' . $k] ?? null, 0, $g, min(85, $g)); }
    $std = [];
    foreach (['1', '2', '3', '4'] as $l) { $n = $int(((array)($o['stdMp'] ?? []))[$l] ?? null, 0, 1000, 0); if ($n > 0) $std[$l] = $n; }
    return ['aEnd' => $pick('aEnd', ['lastScan', 'shiftEnd']), 'aLoss' => $pick('aLoss', ['all', 'unplanned']),
        'lossIn' => $pick('lossIn', ['avail', 'perf']), 'aIdle' => $pick('aIdle', ['run', 'idle']), 'pBase' => $pick('pBase', ['run', 'planned']),
        'pCap' => $old ? true : (bool)($o['pCap'] ?? false), 'pNoStd' => $pick('pNoStd', ['skip', 'avg']), 'qMode' => (int)($o['qV'] ?? 0) >= 2 ? $pick('qMode', ['rejRework', 'rej']) : 'rejRework', 'qV' => 2,   // 25-11-2026: quality counts the rework (no rejection since 23-11) — a setup saved before gets it once
        'qStations' => $pick('qStations', ['all', 'final']),
        // manpower sync: std cycle × std manpower ÷ the line's manpower of the day (morning entry)
        'mpSync' => (bool)($o['mpSync'] ?? false), 'mpUse' => $pick('mpUse', ['open', 'avg']), 'mpUp' => (bool)($o['mpUp'] ?? false), 'stdMp' => (object)$std,
        // OLE colours, the "few pieces" limit, the time format
        'good' => $good, 'watch' => $old ? min(85, $good) : $int($o['watch'] ?? null, 0, $good, min(85, $good)), 'fewPcs' => $int($o['fewPcs'] ?? null, 1, 100, 5), 'timeFmt' => $pick('timeFmt', ['h1', 'hm']), 'bench' => 2] + $apq;
}

const UI_ENTRY_IDS = ['daily', 'lqentry', 'oleentry', 'qentry', 'kpientry', 'entrydash'];
function ui_folders($list, int $v = 2): array
{
    $all = array_values(array_unique(array_merge(...array_map(fn($f) => $f['ids'], UI_FOLDER_DEFAULT))));
    $src = is_array($list) && $list ? array_values($list) : UI_FOLDER_DEFAULT;
    // 20-11-2026 (once, folders saved before): the entry pages move into a new folder "Entry" after the first folder
    if (is_array($list) && $list && $v < 2) {
        $has = false; foreach ($src as $f) if (is_array($f) && strtolower(trim((string)($f['name'] ?? ''))) === 'entry') $has = true;
        if (!$has) {
            $rest = array_map(fn($f) => is_array($f) ? ['name' => $f['name'] ?? '', 'ids' => array_values(array_filter(is_array($f['ids'] ?? null) ? $f['ids'] : [], fn($id) => !in_array($id, UI_ENTRY_IDS, true)))] : $f, $src);
            $src = array_merge([$rest[0]], [['name' => 'Entry', 'ids' => UI_ENTRY_IDS]], array_slice($rest, 1));
        }
    }
    $seen = []; $names = []; $out = [];
    foreach (array_slice(array_values($src), 0, 12) as $i => $f) {
        if (!is_array($f)) continue;
        $name = ui_text($f['name'] ?? '', 24, 'Folder ' . ($i + 1));   // a name left empty: "Folder N"
        if (isset($names[strtolower($name)])) continue;
        $names[strtolower($name)] = true;
        $ids = [];
        foreach (is_array($f['ids'] ?? null) ? $f['ids'] : [] as $id) {
            $id = is_string($id) ? $id : '';
            if (!in_array($id, $all, true) || isset($seen[$id])) continue;
            $seen[$id] = true; $ids[] = $id;
        }
        $out[] = ['name' => $name, 'ids' => $ids];
    }
    if (!$out) return UI_FOLDER_DEFAULT;
    // a page in no folder: into its standard folder when that name is kept, else the last folder
    foreach ($all as $id) {
        if (isset($seen[$id])) continue;
        $std = ''; foreach (UI_FOLDER_DEFAULT as $f) if (in_array($id, $f['ids'], true)) { $std = $f['name']; break; }
        $k = count($out) - 1; foreach ($out as $i => $f) if ($f['name'] === $std) { $k = $i; break; }
        $out[$k]['ids'][] = $id;
    }
    return $out;
}

function ui_clean(array $s): array
{
    $m = (array)($s['management'] ?? []);
    $pages = ui_pages($m['pages'] ?? null, UI_MGMT_IDS, UI_MGMT_DEFAULT_ON);
    if ((int)($s['mgmtV'] ?? 1) < 2 && is_array($m['pages'] ?? null)) {
        foreach ($pages as &$p) if (in_array($p['id'], UI_MGMT_REVIEW, true)) $p['on'] = true;
        unset($p);
    }
    // the Dashboard came after the Setup was saved: put it first and open on it
    $newDash = is_array($m['pages'] ?? null) && !in_array('dash', array_map(fn($p) => is_array($p) ? ($p['id'] ?? '') : '', $m['pages']), true);
    if ($newDash) { $i = array_search('dash', array_column($pages, 'id'), true); $d = array_splice($pages, $i, 1); array_unshift($pages, $d[0]); }
    $on = array_values(array_map(fn($p) => $p['id'], array_filter($pages, fn($p) => $p['on'])));
    if (!$on) { $pages[0]['on'] = true; $on = [$pages[0]['id']]; }      // management always has at least one page
    $home = $newDash && in_array('dash', $on, true) ? 'dash' : (in_array($m['home'] ?? '', $on, true) ? (string)$m['home'] : $on[0]);
    $ov = (array)($m['oneView'] ?? []);
    $kp = (array)($ov['kpis'] ?? []);
    $kpis = [];
    foreach (UI_KPIS as $k) $kpis[$k] = array_key_exists($k, $kp) ? (bool)$kp[$k] : true;
    $flag = fn(string $k) => array_key_exists($k, $ov) ? (bool)$ov[$k] : true;
    $refresh = (int)($ov['refreshSec'] ?? 15);
    $amber = (int)($ov['amberFrom'] ?? 90);

    $a = (array)($s['admin'] ?? []);
    $apages = ui_pages($a['pages'] ?? null, UI_ADMIN_IDS, UI_ADMIN_IDS, true);   // admin: a page not in the saved list stays visible
    if (!array_filter($apages, fn($p) => $p['on'])) $apages[0]['on'] = true;

    $b = (array)($s['brand'] ?? []);
    return [
        'management' => [
            'pages' => $pages, 'home' => $home,
            'oneView' => [
                'showKpis' => $flag('showKpis'), 'lines' => $flag('lines'), 'week' => $flag('week'), 'attention' => $flag('attention'),
                'kpis' => $kpis, 'refreshSec' => max(10, min(300, $refresh)), 'amberFrom' => max(50, min(99, $amber)),
            ],
        ],
        'admin' => ['pages' => $apages],
        'mgmtV' => 2,
        'folders' => ui_folders($s['folders'] ?? null, (int)($s['foldersV'] ?? 1)), 'foldersV' => 2,
        'targetRule' => ui_rule($s['targetRule'] ?? null),
        'brand' => [
            'name' => ui_text($b['name'] ?? '', 24, 'DIXON'),
            'tagline' => ui_text($b['tagline'] ?? '', 40, 'Line Pulse — EMS'),
            'color' => in_array($b['color'] ?? '', UI_COLORS, true) ? $b['color'] : 'navy',
        ],
        'theme' => ui_theme($s['theme'] ?? null, UI_COLOR_HEX[$b['color'] ?? ''] ?? null),
        'hpr' => ui_hpr($s['hpr'] ?? null),
        'ole' => ui_ole($s['ole'] ?? null),
        'reports' => ui_reports($s['reports'] ?? null),
        'refresh' => ui_refresh($s['refresh'] ?? null),
        'notify' => ui_notify($s['notify'] ?? null),     // 23-11-2026: Setup → Notifications
        'welcome' => ui_welcome($s['welcome'] ?? null),
        'capa' => capa_head($s['capa'] ?? null),   // 24-11-2026: header of the CAPA form (doc no, revision …)
        'entry' => ui_entry($s['entry'] ?? null),   // 25-11-2026: Setup → Access & entry — the entry methods switched on
    ];
}

/** 25-11-2026: the ways of filling the hour (Loss / Quality entry) the admin switched on (all on by default) */
const UI_ENTRY_METHODS = ['manyHours', 'copyPrev', 'quickAdd', 'noLoss', 'lineOff', 'nextEmpty'];
function ui_entry($e): array
{
    $e = is_array($e) ? $e : [];
    $out = [];
    foreach (UI_ENTRY_METHODS as $k) $out[$k] = array_key_exists($k, $e) ? (bool)$e[$k] : true;
    return $out;
}

/**
 * 23-11-2026: how often the screens read new data (Setup → Screen refresh). Seconds.
 *   ole  = OLE, quality, entry dashboards (20 s) · dash = Dashboard / line pages live (10 s) · masters = targets, shifts, settings (60 s)
 * The Live lines / TV screens keep their own timing.
 */
function ui_refresh($r): array
{
    $r = is_array($r) ? $r : [];
    $n = fn(string $k, int $lo, int $hi, int $d) => isset($r[$k]) && is_numeric($r[$k]) ? max($lo, min($hi, (int)round((float)$r[$k]))) : $d;
    return ['ole' => $n('ole', 10, 600, 20), 'dash' => $n('dash', 5, 300, 10), 'masters' => $n('masters', 30, 900, 60)];
}

/**
 * 23-11-2026: which reports each login sees on the Reports page (the admin's choice).
 * access = { login: [report ids] } — a login not in the list sees every report; [] = none.
 */
function ui_reports($r): array
{
    $acc = [];
    foreach ((array)(((array)($r ?? []))['access'] ?? []) as $user => $ids) {
        $u = strtolower(trim((string)$user));
        if (!preg_match('/^[a-z0-9._-]{1,40}$/', $u) || count($acc) >= 300) continue;
        $out = [];
        foreach ((array)$ids as $id) { $id = (string)$id; if (preg_match('/^[a-zA-Z]{2,20}$/', $id) && !in_array($id, $out, true) && count($out) < 50) $out[] = $id; }
        $acc[$u] = $out;
    }
    return ['access' => (object)$acc];
}

/**
 * 23-11-2026: notifications (the bell) — which alert is on, its limit, and who receives it (Setup → Notifications).
 * Same rules as frontend/src/utils/notifyConfig.js normalizeNotify.
 */
const UI_NOTIFY_GROUPS = ['admin', 'sup', 'dept', 'view'];
const UI_NOTIFY_RULES = [
    'offline' => [['admin', 'sup'], null],
    'noCycle' => [['admin'], null],
    'lowHour' => [['admin', 'sup', 'view'], ['pct', 'num', 85, 50, 100]],
    'lossPending' => [['admin', 'sup'], ['min', 'num', 30, 5, 240]],
    'morning' => [['admin', 'sup'], ['at', 'time', '09:30']],
    'rejects' => [['admin', 'dept', 'view'], ['pcs', 'num', 10, 1, 1000]],
];
function ui_notify($n): array
{
    $n = is_array($n) ? $n : [];
    $src = is_array($n['rules'] ?? null) ? $n['rules'] : [];
    $rules = [];
    foreach (UI_NOTIFY_RULES as $id => [$to0, $p]) {
        $x = is_array($src[$id] ?? null) ? $src[$id] : [];
        $to = is_array($x['to'] ?? null) ? array_values(array_filter(UI_NOTIFY_GROUPS, fn($g) => in_array($g, $x['to'], true))) : $to0;
        $users = [];
        foreach ((array)($x['users'] ?? []) as $u) { $u = strtolower(trim((string)$u)); if (preg_match('/^[a-z0-9._-]{1,40}$/', $u) && !in_array($u, $users, true) && count($users) < 100) $users[] = $u; }
        $lines = [];
        foreach ((array)($x['lines'] ?? []) as $l) { $l = (string)$l; if (preg_match('/^\d{1,2}$/', $l) && !in_array($l, $lines, true)) $lines[] = $l; }
        sort($lines, SORT_STRING);
        $o = ['on' => array_key_exists('on', $x) ? (bool)$x['on'] : true, 'to' => $to, 'users' => $users, 'lines' => $lines];
        if ($p) {
            [$k, $kind, $def] = $p;
            if ($kind === 'time') {
                $o[$k] = preg_match('/^(\d{1,2}):(\d{2})$/', (string)($x[$k] ?? ''), $m) && (int)$m[1] < 24 && (int)$m[2] < 60 ? str_pad($m[1], 2, '0', STR_PAD_LEFT) . ':' . $m[2] : $def;
            } else {
                $o[$k] = isset($x[$k]) && is_numeric($x[$k]) ? max($p[3], min($p[4], (int)round((float)$x[$k]))) : $def;
            }
        }
        $rules[$id] = $o;
    }
    return ['on' => array_key_exists('on', $n) ? (bool)$n['on'] : true, 'rules' => $rules];
}

/** 23-11-2026: the welcome message after login ({greeting}, {name}, {role} are filled in on the screen). */
function ui_welcome($w): array
{
    $w = is_array($w) ? $w : [];
    $t = function ($v, int $max, string $def): string {
        $s = trim(preg_replace('/\s+/u', ' ', str_replace(['<', '>'], '', (string)($v ?? ''))));
        $s = mb_substr($s, 0, $max);
        return $s !== '' ? $s : $def;
    };
    return [
        'on' => array_key_exists('on', $w) ? (bool)$w['on'] : true,
        'title' => $t($w['title'] ?? '', 80, '{greeting}, {name}'),
        'text' => $t($w['text'] ?? '', 240, 'Welcome to Dixon Line Pulse. Please review the notifications for your lines.'),
    ];
}
