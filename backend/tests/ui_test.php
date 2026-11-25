<?php
// php backend/tests/ui_test.php — screen setup cleaning (lib/ui.php)
declare(strict_types=1);
require_once __DIR__ . '/../lib/ui.php';
$fail = 0;
function ok(string $n, bool $c) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $n . "\n"; if (!$c) $fail++; }

$d = ui_clean([]);
$onIds = array_column(array_filter($d['management']['pages'], fn($p) => $p['on']), 'id'); sort($onIds); $want = UI_MGMT_DEFAULT_ON; sort($want);
ok('default management pages = the default set', $onIds === $want);
ok('default home = Dashboard', $d['management']['home'] === 'dash');
ok('every admin page on by default', count(array_filter($d['admin']['pages'], fn($p) => $p['on'])) === count(UI_ADMIN_IDS));
ok('default brand', $d['brand'] === ['name' => 'DIXON', 'tagline' => 'Line Pulse — EMS', 'color' => 'navy']);
ok('one view defaults', $d['management']['oneView']['refreshSec'] === 15 && $d['management']['oneView']['amberFrom'] === 90 && $d['management']['oneView']['week'] === true);

$s = ui_clean(['management' => ['pages' => [['id' => 'live', 'on' => true, 'label' => '  Floor <b>now</b> '], ['id' => 'hack', 'on' => true], ['id' => 'live', 'on' => false], ['id' => 'overview', 'on' => false]],
    'home' => 'overview', 'oneView' => ['week' => false, 'refreshSec' => 2, 'amberFrom' => 120, 'kpis' => ['lost' => false]]],
    'admin' => ['pages' => [['id' => 'formulas', 'on' => false]]], 'brand' => ['name' => str_repeat('X', 50), 'color' => 'pink']]);
$ids = array_column($s['management']['pages'], 'id');
ok('order kept (new Dashboard first), unknown and repeated ids dropped, all ids present once', $ids[0] === 'dash' && $ids[1] === 'live' && $ids[2] === 'overview' && count($ids) === count(UI_MGMT_IDS) && count(array_unique($ids)) === count($ids));
ok('label cleaned of tags', $s['management']['pages'][1]['label'] === 'Floor bnow/b');
// a page missing from a saved list (newer than the list) gets its default: on when in UI_MGMT_DEFAULT_ON, else off
$miss = array_values(array_filter($s['management']['pages'], fn($p) => $p['id'] === 'rca'))[0];
$missOff = array_values(array_filter($s['management']['pages'], fn($p) => $p['id'] === 'models'))[0];
ok('pages missing from a saved list get their default (new page on, others off)', $miss['on'] && !$missOff['on']);
ok('a Setup saved before the Dashboard opens on the Dashboard', $s['management']['home'] === 'dash');
$h = ui_clean(['mgmtV' => 2, 'management' => ['pages' => [['id' => 'dash', 'on' => false], ['id' => 'live', 'on' => true], ['id' => 'overview', 'on' => false]], 'home' => 'overview']]);
ok('home must be a page that is on (Dashboard already known, switched off)', $h['management']['home'] === 'live' && array_column($h['management']['pages'], 'id')[0] === 'dash');
ok('limits on refresh / amber', $s['management']['oneView']['refreshSec'] === 10 && $s['management']['oneView']['amberFrom'] === 99);
ok('kpi switch kept, others default on', $s['management']['oneView']['kpis']['lost'] === false && $s['management']['oneView']['kpis']['produced'] === true);
ok('admin page switched off', !array_values(array_filter($s['admin']['pages'], fn($p) => $p['id'] === 'formulas'))[0]['on']);
ok('brand name cut, unknown colour → navy', mb_strlen($s['brand']['name']) === 24 && $s['brand']['color'] === 'navy');
$z = ui_clean(['mgmtV' => 2, 'management' => ['pages' => array_map(fn($id) => ['id' => $id, 'on' => false], UI_MGMT_IDS)]]);
ok('never zero management pages', count(array_filter($z['management']['pages'], fn($p) => $p['on'])) === 1);

// 24-11-2026: review pages for management — switched on once for an older Setup, then the admin's choice stays
$old = ui_clean(['management' => ['pages' => array_map(fn($id) => ['id' => $id, 'on' => $id === 'live'], UI_MGMT_IDS), 'home' => 'live']]);
$oldOn = array_column(array_filter($old['management']['pages'], fn($p) => $p['on']), 'id');
ok('older Setup: review pages switched on once', !array_diff(UI_MGMT_REVIEW, $oldOn) && in_array('live', $oldOn, true) && $old['mgmtV'] === 2);
ok('older Setup: home kept', $old['management']['home'] === 'live');
$again = $old; foreach ($again['management']['pages'] as &$pp) if ($pp['id'] === 'rcadash') $pp['on'] = false; unset($pp);
$again = ui_clean($again);
ok('after the migration the admin can switch a review page off', !array_values(array_filter($again['management']['pages'], fn($p) => $p['id'] === 'rcadash'))[0]['on']);
ok('all review pages are management pages', !array_diff(UI_MGMT_REVIEW, UI_MGMT_IDS));
$r = ui_clean([])['targetRule'];
$noLines = function (array $x) { unset($x['lines'], $x['plan']); return $x; };
ok('target rule default: from 1 Aug, +3 s, gaps up to 22 s, 20 gaps', $noLines($r) === ['from' => '2026-08-01', 'to' => '2026-10-31', 'add' => 3, 'cap' => 22, 'min' => 20, 'low' => 1]);
ok('target rule default: every line Method A + 3 s', $r['lines'] === array_fill_keys(['1', '2', '3', '4'], ['method' => 'A', 'add' => 3, 'pct' => 70]));
$l = ui_clean(['targetRule' => ['lines' => ['2' => ['method' => 'B', 'pct' => 99, 'add' => 1.5], '3' => ['method' => 'Z'], '4' => ['method' => 'C']]]])['targetRule']['lines'];
ok('line methods kept and limited (B % 50–95, unknown → A, B/C default 0 s)', $l['2'] == ['method' => 'B', 'add' => 1.5, 'pct' => 95] && $l['3']['method'] === 'A' && $l['4'] == ['method' => 'C', 'add' => 0, 'pct' => 70]);
ok('target rule kept and limited', $noLines(ui_clean(['targetRule' => ['from' => '2026-09-15', 'add' => 99, 'cap' => '2', 'min' => 50]])['targetRule']) === ['from' => '2026-09-15', 'to' => '2026-10-31', 'add' => 30, 'cap' => 5, 'min' => 50, 'low' => 1]);
ok('target rule: data to empty = up to today', ui_clean(['targetRule' => ['from' => '2026-08-01', 'to' => '']])['targetRule']['to'] === '');
ok('target rule: data to before from / bad date → default', ui_clean(['targetRule' => ['from' => '2026-08-01', 'to' => '2026-07-01']])['targetRule']['to'] === '2026-10-31' && ui_clean(['targetRule' => ['to' => '2026-02-31']])['targetRule']['to'] === '2026-10-31');
ok('target rule: data to kept', ui_clean(['targetRule' => ['from' => '2026-08-01', 'to' => '2026-09-30']])['targetRule']['to'] === '2026-09-30');
ok('lowest valid gap kept to 0.1 s', ui_clean(['targetRule' => ['low' => '6.25', 'cap' => 22]])['targetRule']['low'] == 6.3);
ok('lowest valid gap stays below the cap', ui_clean(['targetRule' => ['low' => 30, 'cap' => 22]])['targetRule']['low'] == 21);
ok('lowest valid gap 0 allowed (nothing below eliminated)', ui_clean(['targetRule' => ['low' => 0]])['targetRule']['low'] == 0);
ok('bad date falls back', ui_clean(['targetRule' => ['from' => '2026-02-31']])['targetRule']['from'] === '2026-08-01');
ok('target check page known', in_array('targetcheck', array_column(ui_clean([])['admin']['pages'], 'id'), true));
$t = ui_clean([])['theme'];
ok('theme default = standard navy blue, 100 %', $t['preset'] === 'navy' && $t['primary'] === '#0B3A74' && $t['accent'] === '#DC2626' && $t['data'] === '#0EA5E9' && $t['sidebar'] === '#0B2545' && $t['scale'] === 100 && $t['font'] === 'archivo' && $t['mono'] === 'archivonum');
$t = ui_clean(['theme' => ['primary' => '#1f2937', 'accent' => 'red', 'scale' => 300, 'tvScale' => 10, 'font' => 'comic', 'mono' => 'consolas', 'preset' => 'custom', 'lines' => ['2' => '#00FF00', '3' => 'x']]])['theme'];
ok('theme cleaned: hex upper, bad colour → default, sizes limited, unknown font → Archivo (Dixon style)', $t['primary'] === '#1F2937' && $t['accent'] === '#DC2626' && $t['scale'] === 130 && $t['tvScale'] === 80 && $t['font'] === 'archivo' && $t['mono'] === 'consolas' && $t['preset'] === 'custom' && $t['lines']['2'] === '#00FF00' && $t['lines']['3'] === '#C9821A');
ok('old sidebar colour (teal) carried into the theme', ui_clean(['brand' => ['color' => 'teal']])['theme']['sidebar'] === '#0F3D3E');
$o0 = ui_clean([])['ole'];
ok('OLE formulas: standard by default (19-11-2026: OLE 95 / 85, Performance max 100 % · 25-11-2026: quality counts the rework)', $o0['aEnd'] === 'lastScan' && $o0['aLoss'] === 'all' && $o0['pBase'] === 'run' && $o0['pCap'] === true && $o0['qMode'] === 'rejRework' && $o0['mpSync'] === false && $o0['good'] === 95 && $o0['watch'] === 85 && $o0['bench'] === 2 && $o0['fewPcs'] === 5 && $o0['timeFmt'] === 'h1' && json_encode($o0['stdMp']) === '{}');
$qa = ui_clean(['ole' => ['qMode' => 'rej', 'bench' => 2]])['ole']; $qb = ui_clean(['ole' => ['qMode' => 'rej', 'qV' => 2, 'bench' => 2]])['ole'];
ok('25-11-2026: a setup saved with "rejected only" counts the rework once; the admin\'s later choice stays', $qa['qMode'] === 'rejRework' && $qa['qV'] === 2 && $qb['qMode'] === 'rej');
$o1 = ui_clean(['ole' => ['aEnd' => 'shiftEnd', 'pBase' => 'planned', 'pCap' => 1, 'qMode' => 'rejRework', 'mpSync' => true, 'mpUse' => 'avg', 'stdMp' => ['1' => '96', '2' => '', '3' => -5, '9' => 40], 'good' => 130, 'watch' => 99, 'fewPcs' => 0, 'timeFmt' => 'hm', 'aLoss' => 'bad', 'bench' => 2]])['ole'];
$o2 = ui_clean(['ole' => ['good' => 80, 'watch' => 50, 'pCap' => false]])['ole'];
ok('a setup saved before bench 2 gets OLE 95 / 85 and Performance max 100 % once', $o2['good'] === 95 && $o2['watch'] === 85 && $o2['pCap'] === true && $o2['bench'] === 2);
$o3 = ui_clean(['ole' => ['good' => 80, 'watch' => 50, 'pCap' => false, 'bench' => 2]])['ole'];
ok('after that the admin\'s own values stay', $o3['good'] === 80 && $o3['watch'] === 50 && $o3['pCap'] === false);
ok('OLE formulas cleaned: choices kept, numbers limited, unknown → standard', $o1['aEnd'] === 'shiftEnd' && $o1['pBase'] === 'planned' && $o1['pCap'] === true && $o1['qMode'] === 'rejRework' && $o1['mpSync'] === true && $o1['mpUse'] === 'avg' && json_encode($o1['stdMp']) === '{"1":96}' && $o1['good'] === 100 && $o1['watch'] === 99 && $o1['fewPcs'] === 1 && $o1['timeFmt'] === 'hm' && $o1['aLoss'] === 'all');
// 20-11-2026: folders saved before get an "Entry" folder once (the entry pages move there); after that the admin's folders stay
$old = [['name' => 'Overview', 'ids' => ['dash']], ['name' => 'Availability', 'ids' => ['olea', 'daily', 'lqentry', 'oleentry', 'entrydash']], ['name' => 'Quality', 'ids' => ['oleq', 'qentry']]];
$f1 = ui_clean(['folders' => $old]);
ok('saved folders: "Entry" folder added after the first, entry pages moved', $f1['folders'][1]['name'] === 'Entry' && in_array('lqentry', $f1['folders'][1]['ids'], true) && !in_array('daily', $f1['folders'][2]['ids'], true) && !in_array('qentry', $f1['folders'][3]['ids'], true) && $f1['foldersV'] === 2);
$moved = $f1['folders']; $moved[1]['name'] = 'Shop floor';
$f2 = ui_clean(['folders' => $moved, 'foldersV' => 2]);
ok('after that a renamed folder stays as the admin left it', $f2['folders'][1]['name'] === 'Shop floor' && count($f2['folders']) === count($moved));

// 20-11-2026: target method by date
$pl = ui_clean(['targetRule' => ['plan' => [
    ['line' => '1', 'from' => '2026-11-15', 'method' => 'D'],
    ['line' => '1', 'from' => '2026-11-15', 'method' => 'B', 'pct' => 99, 'add' => 1],   // same line and day: the last one wins
    ['line' => '2', 'from' => '2026-11-01', 'method' => 'A', 'note' => ' moved <b>to A</b> '],
    ['line' => '5', 'from' => '2026-11-01', 'method' => 'A'], ['line' => '3', 'from' => '2026-02-30', 'method' => 'A'], ['line' => '3', 'from' => '2026-11-01', 'method' => 'X'], 'junk',
    ['line' => '1', 'from' => '2026-09-01', 'method' => 'C'],
]]])['targetRule']['plan'];
ok('plan: bad line / date / method dropped, one per line and day (last wins), sorted by line and date', array_map(fn($p) => $p['line'] . '@' . $p['from'] . ':' . $p['method'], $pl) === ['1@2026-09-01:C', '1@2026-11-15:B', '2@2026-11-01:A']);
ok('plan: B % limited, allowance kept, A allowance defaults to the rule, note cleaned', $pl[1]['pct'] === 95 && $pl[1]['add'] == 1 && $pl[2]['add'] == 3 && $pl[2]['note'] === 'moved bto A/b' && !isset($pl[0]['note']));
ok('plan: empty by default', ui_clean([])['targetRule']['plan'] === []);
$many = []; for ($i = 1; $i <= 80; $i++) $many[] = ['line' => '1', 'from' => date('Y-m-d', strtotime("2026-01-01 +$i day")), 'method' => 'A'];
ok('plan: at most 60 changes', count(ui_clean(['targetRule' => ['plan' => $many]])['targetRule']['plan']) === 60);
// 23-11-2026: report access per login
$ra = ui_clean(['reports' => ['access' => ['Line1 ' => ['hpr', 'kpi', 'hpr', 'bad id!'], 'x y' => ['hpr'], 'mgr' => []]]])['reports']['access'];
$ra = (array)$ra;
ok('reports: login names cleaned, bad ones dropped', array_keys($ra) === ['line1', 'mgr']);
ok('reports: only known-looking ids, no repeats; [] kept', $ra['line1'] === ['hpr', 'kpi'] && $ra['mgr'] === []);
ok('reports: empty by default (everyone sees all)', (array)ui_clean([])['reports']['access'] === []);
// 23-11-2026: screen refresh and the new ready themes
ok('refresh: 20 s · 10 s · 60 s by default', ui_clean([])['refresh'] === ['ole' => 20, 'dash' => 10, 'masters' => 60]);
ok('refresh: limits kept, junk ignored', ui_clean(['refresh' => ['ole' => 2, 'dash' => 9999, 'masters' => 'x']])['refresh'] === ['ole' => 10, 'dash' => 300, 'masters' => 60]);
ok('theme: the new ready looks are kept', ui_clean(['theme' => ['preset' => 'teal']])['theme']['preset'] === 'teal' && ui_clean(['theme' => ['preset' => 'nope']])['theme']['preset'] === 'navy');
// 23-11-2026: notifications and the welcome message
$nd = ui_clean([])['notify'];
ok('notify: on by default, every rule with its standard groups', $nd['on'] === true && $nd['rules']['offline']['to'] === ['admin', 'sup'] && $nd['rules']['lowHour']['pct'] === 85 && $nd['rules']['morning']['at'] === '09:30');
$nx = ui_clean(['notify' => ['on' => false, 'rules' => ['lowHour' => ['on' => false, 'pct' => 20, 'to' => ['sup', 'bad'], 'users' => ['Akash', 'x y'], 'lines' => [2, 'a']], 'morning' => ['at' => '9:45'], 'rejects' => ['pcs' => 'x']]]])['notify'];
ok('notify: limits, groups, logins and lines cleaned', $nx['on'] === false && $nx['rules']['lowHour'] === ['on' => false, 'to' => ['sup'], 'users' => ['akash'], 'lines' => ['2'], 'pct' => 50] && $nx['rules']['morning']['at'] === '09:45' && $nx['rules']['rejects']['pcs'] === 10);
$w = ui_clean(['welcome' => ['on' => false, 'title' => '<b>Hello</b> {name}', 'text' => '']])['welcome'];
ok('welcome: tags removed, empty text back to standard', $w['on'] === false && $w['title'] === 'bHello/b {name}' && str_starts_with($w['text'], 'Welcome to Dixon Line Pulse'));
echo $fail ? "FAILED $fail\n" : "ALL OK\n";
exit($fail ? 1 : 0);
