<?php
// php tests/ole_test.php — the entry cleaning of api/ole.php (reasons, departments, quality stations), without a server.
declare(strict_types=1);
$src = file_get_contents(__DIR__ . '/../api/ole.php');
$a = strpos($src, 'const OLE_KINDS'); $b = strpos($src, '$body = store_begin();');
$STORE = [];
function store_read(string $k, $d) { global $STORE; return $STORE[$k] ?? $d; }
eval(substr($src, $a, $b - $a));
$fail = 0;
function ok(string $t, bool $c, $x = null) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $t . ($c ? '' : ' → ' . json_encode($x)) . "\n"; if (!$c) $fail++; }

$r = ole_reasons();
ok('default stations: the 6 stages of the SAWM KPI report, in its order', array_column($r['station'], 'reason') === ['HVIR', 'Leakage Inspection', 'Functional', 'Front Inspection', 'Pre-Final Inspection', 'Final Inspection'], array_column($r['station'], 'reason'));
ok('default washing-machine defects (water leak) in the rejection list', in_array('Water leak', array_column($r['reject'], 'reason'), true));
$e = ole_clean(['date' => '2026-11-04', 'line' => 1, 'hour' => 10,
    'stops' => [['reason' => 'tea break', 'min' => 15]],
    'losses' => [['model' => 'WT70', 'reason' => 'Breakdown', 'min' => 10]],
    'rejects' => [['station' => 'fqc (final quality check)', 'model' => 'WT70', 'reason' => 'water leak', 'qty' => 2], ['station' => 'Line end', 'reason' => 'x', 'qty' => 1], ['qty' => 0]],
    'rework' => [['station' => 'LQC (line quality check)', 'reason' => 'Leak repair', 'qty' => 3]]], $r);
ok('planned stoppage kept with the list spelling and department', $e['stops'] === [['model' => '', 'reason' => 'Tea break', 'dept' => 'Prod', 'min' => 15]], $e['stops']);
ok('rejection: an old default station name → its KPI stage (alias), defect → department', $e['rejects'][0] === ['station' => 'Final Inspection', 'model' => 'WT70', 'reason' => 'Water leak', 'dept' => 'Prod', 'qty' => 2], $e['rejects'][0]);
ok('rejection: unknown station kept as typed, a defect typed by hand kept as written (manual)', $e['rejects'][1]['station'] === 'Line end' && $e['rejects'][1]['reason'] === 'x' && !empty($e['rejects'][1]['manual']) && $e['rejects'][1]['dept'] === 'Not set' && count($e['rejects']) === 2, $e['rejects']);
ok('rework with station (old LQC → Front Inspection)', $e['rework'][0]['station'] === 'Front Inspection' && $e['rework'][0]['qty'] === 3, $e['rework']);
ok('time rows have no station field', !isset($e['stops'][0]['station']) && !isset($e['losses'][0]['station']));
// 20-11-2026: category, root cause, action, dismantled pieces on a quality row
$q = ole_clean(['date' => '2026-11-04', 'line' => 1, 'hour' => 10, 'rejects' => [
    ['station' => 'HVIR', 'reason' => 'Water leak', 'qty' => 3, 'cat' => 'assy', 'cause' => ' Hose clamp loose ', 'action' => 'Torque check added', 'dismantle' => 2],
    ['station' => 'HVIR', 'reason' => 'Water leak', 'qty' => 1, 'cat' => 'Other', 'dismantle' => '0']]], $r);
ok('quality row: category (list spelling), root cause, action, dismantled kept', ($q['rejects'][0]['cat'] ?? '') === 'Assy' && $q['rejects'][0]['cause'] === 'Hose clamp loose' && $q['rejects'][0]['action'] === 'Torque check added' && $q['rejects'][0]['dismantle'] === 2, $q['rejects'][0]);
$st = ole_clean(['date' => '2026-11-23', 'line' => 2, 'hour' => 10, 'rework' => [['station' => 'LQC', 'reason' => 'Wrong part issued', 'qty' => 2, 'cat' => 'kitting store'], ['station' => 'LQC', 'reason' => 'Tub scratch', 'qty' => 1, 'cat' => 'Plastic Store'], ['station' => 'LQC', 'reason' => 'X', 'qty' => 1, 'cat' => 'Store']]], $r);
ok('rework row: Kitting Store / Plastic Store categories kept (23-11-2026)', ($st['rework'][0]['cat'] ?? '') === 'Kitting Store' && ($st['rework'][1]['cat'] ?? '') === 'Plastic Store' && !isset($st['rework'][2]['cat']), $st['rework'] ?? null);
ok('quality row: unknown category and 0 dismantled dropped', !isset($q['rejects'][1]['cat']) && !isset($q['rejects'][1]['dismantle']), $q['rejects'][1]);
$bad = false; try { ole_clean(['date' => '2026-11-04', 'line' => 1, 'hour' => 10, 'rejects' => [['station' => 'HVIR', 'reason' => 'x', 'qty' => 1, 'dismantle' => 2]]], $r); } catch (InvalidArgumentException $x) { $bad = true; }
ok('more pieces dismantled than rejected refused', $bad);
$n = ole_clean(['date' => '2026-11-04', 'line' => 1, 'hour' => 10, 'noLoss' => true], $r);
ok('"No loss" kept on an hour without loss rows', ($n['noLoss'] ?? false) === true, $n);
$n = ole_clean(['date' => '2026-11-04', 'line' => 1, 'hour' => 10, 'noLoss' => true, 'losses' => [['reason' => 'BD', 'min' => 5]]], $r);
ok('"No loss" dropped when a loss row is written', !isset($n['noLoss']), $n);
// 23-11-2026: "No defects" (Quality entry) — kept only on an hour without rejection / rework
$n = ole_clean(['date' => '2026-11-04', 'line' => 1, 'hour' => 10, 'noQ' => true], $r);
ok('"No defects" kept on an hour without rejection / rework', ($n['noQ'] ?? false) === true, $n);
$n = ole_clean(['date' => '2026-11-04', 'line' => 1, 'hour' => 10, 'noQ' => true, 'rework' => [['station' => 'HVIR', 'reason' => 'x', 'qty' => 1]]], $r);
ok('"No defects" dropped when a rework row is written', !isset($n['noQ']), $n);
$n = ole_clean(['date' => '2026-11-04', 'line' => 1, 'hour' => 10, 'noQ' => true, 'losses' => [['reason' => 'BD', 'min' => 5]]], $r);
ok('"No defects" kept beside a loss row (the other part of the hour)', ($n['noQ'] ?? false) === true && !isset($n['noLoss']), $n);
$src2 = file_get_contents(__DIR__ . '/../api/ole.php');
ok('save keeps the other page\'s part (part = loss / quality)', strpos($src2, "\$part === 'quality'") !== false && strpos($src2, "\$part === 'loss'") !== false);
$t = ole_clean(['date' => '2026-11-04', 'line' => 1, 'hour' => 10, 'losses' => [['reason' => 'BD', 'min' => 5, 'cat' => 'Assy', 'dismantle' => 1]]], $r);
ok('time rows take no category / dismantle', !isset($t['losses'][0]['cat']) && !isset($t['losses'][0]['dismantle']), $t['losses'][0]);
$c = ole_clean_reasons(['stop' => [['reason' => 'Tea', 'dept' => 'P']], 'loss' => [['reason' => 'BD', 'dept' => 'M']], 'reject' => [['reason' => 'Leak', 'dept' => 'Q']], 'rework' => [['reason' => 'Fix', 'dept' => 'P']]]);
ok('reasons saved without a station list keep the stations', count($c['station']) === 6);
$c = ole_clean_reasons(['stop' => [['reason' => 'Tea', 'dept' => 'P']], 'loss' => [['reason' => 'BD', 'dept' => 'M']], 'reject' => [['reason' => 'Leak', 'dept' => 'Q']], 'rework' => [['reason' => 'Fix', 'dept' => 'P']], 'station' => [['reason' => 'LQC 1', 'dept' => ''], ['reason' => 'lqc 1'], ['reason' => 'FQC']]]);
ok('own station list: cleaned, no duplicates, owner "Not set" when empty', array_column($c['station'], 'reason') === ['LQC 1', 'FQC'] && $c['station'][0]['dept'] === 'Not set', $c['station']);
ok('station defaults: inline, in RTY, active, rework allowed, every line, all defects', $c['station'][1] === ['reason' => 'FQC', 'dept' => 'Not set', 'code' => '', 'type' => 'inline', 'rty' => true, 'active' => true, 'rework' => true, 'lines' => [], 'defects' => [], 'aliases' => []], $c['station'][1]);
$R4 = ['stop' => [['reason' => 'Tea', 'dept' => 'P']], 'loss' => [['reason' => 'BD', 'dept' => 'M']], 'reject' => [['reason' => 'Leak', 'dept' => 'Q']], 'rework' => [['reason' => 'Fix', 'dept' => 'P']]];
$c = ole_clean_reasons($R4 + ['station' => [
    ['reason' => 'Line QC', 'dept' => 'Quality', 'code' => 'LQC', 'type' => 'final', 'rty' => false, 'active' => true, 'rework' => false, 'lines' => [3, '1', 99, 'x', 3], 'defects' => ['Leak', ' leak ', '<i>Noise</i>', ''], 'aliases' => ['LQC (line quality check)', 'Line QC', 'FQC']],
    ['reason' => 'FQC', 'type' => 'bogus', 'active' => false]], 'quality' => ['fpyTarget' => '97.5', 'rtyTarget' => 20]]);
$q = $c['station'][0];
ok('station setup kept: code, type, RTY off, no rework, lines 1 and 3, defects, old names', $q['code'] === 'LQC' && $q['type'] === 'final' && $q['rty'] === false && $q['rework'] === false && $q['lines'] === [1, 3] && $q['defects'] === ['Leak', 'Noise'], $q);
ok('an old name that is another station is dropped; the own name is not an old name', $q['aliases'] === ['LQC (line quality check)'], $q['aliases']);
ok('unknown type → inline; switched off kept', $c['station'][1]['type'] === 'inline' && $c['station'][1]['active'] === false, $c['station'][1]);
ok('targets: 97.5 kept, 20 → 50 (lowest)', $c['quality'] === ['fpyTarget' => 97.5, 'rtyTarget' => 50.0], $c['quality']);
ok('targets kept when not sent', ole_clean_reasons($R4)['quality'] === ['fpyTarget' => 98.0, 'rtyTarget' => 97.0]);
$e = ole_clean(['date' => '2026-11-04', 'line' => 1, 'hour' => 10, 'rejects' => [['station' => 'lqc (line quality check)', 'model' => 'WT70', 'reason' => 'Leak', 'qty' => 1]]], $c);
ok('an entry under the old station name is saved under the new name', $e['rejects'][0]['station'] === 'Line QC', $e['rejects'][0]);
ok('defaults have the stage codes', array_column($r['station'], 'code') === ['HVIR', 'LEAK', 'FUNC', 'FRONT', 'PREFINAL', 'FINAL']);
try { ole_clean_reasons(['stop' => [['reason' => 'a']], 'loss' => [['reason' => 'b']], 'reject' => [['reason' => 'c']], 'rework' => [['reason' => 'd']], 'station' => []]); ok('empty station list refused', false); }
catch (InvalidArgumentException $x) { ok('empty station list refused', str_contains($x->getMessage(), 'station')); }
try { ole_clean(['date' => '2026-11-04', 'line' => 1, 'hour' => 9, 'stops' => [['reason' => 'Tea break', 'min' => 40]], 'losses' => [['reason' => 'Breakdown', 'min' => 30]]], $r); ok('planned + unplanned over 60 refused', false); }
catch (InvalidArgumentException $x) { ok('planned + unplanned over 60 refused', true); }
$c = ole_clean_day(['date' => '2026-11-08', 'line' => '2', 'off' => true, 'reason' => 'holiday / weekly off', 'note' => '<b>Sunday</b>']);
ok('whole-day stop: list spelling, tags stripped', $c === ['date' => '2026-11-08', 'line' => 2, 'off' => true, 'reason' => 'Holiday / weekly off', 'note' => 'Sunday'], $c);
try { ole_clean_day(['date' => '2026-11-08', 'line' => 2, 'off' => true, 'reason' => 'party']); ok('whole-day stop needs a reason of the list', false); }
catch (InvalidArgumentException $x) { ok('whole-day stop needs a reason of the list', true); }
ok('whole-day stop can be taken back without a reason', ole_clean_day(['date' => '2026-11-08', 'line' => 2, 'off' => false])['off'] === false);

// 16-11-2026: the plant's HPR loss reasons with department and owner; owner and part stored on the row
$r = ole_reasons();
ok('default loss list = HPR reasons (Model Change · Prod · owner)', $r['loss'][0] === ['reason' => 'Model Change', 'dept' => 'Prod', 'owner' => 'Ajay Kumar'] && count($r['loss']) === 51, $r['loss'][0]);
ok('HPR departments in the loss list', count(array_intersect(['Prod', 'Moulding Store', 'Kitting Store', 'Supplier', 'Moulding QA', 'Maint', 'IT'], array_unique(array_column($r['loss'], 'dept')))) === 7);
$e = ole_clean(['date' => '2026-11-16', 'line' => 3, 'hour' => 11, 'losses' => [['model' => 'WT10C4260GG', 'reason' => 'motor shortage', 'part' => 'Welling motor', 'min' => 12]]], $r);
ok('loss row: list spelling, department, owner and part', $e['losses'][0] === ['model' => 'WT10C4260GG', 'reason' => 'Motor Shortage', 'dept' => 'Kitting Store', 'min' => 12, 'owner' => 'Arvind Pandey', 'part' => 'Welling motor'], $e['losses'][0]);
$c = ole_clean_reasons(['stop' => [['reason' => 'Tea', 'dept' => 'P']], 'loss' => array_map(fn($i) => ['reason' => "R$i", 'dept' => 'D', 'owner' => "O$i"], range(1, 90)), 'reject' => [['reason' => 'Leak', 'dept' => 'Q']], 'rework' => [['reason' => 'Fix', 'dept' => 'P']]]);
ok('reason list keeps owners, up to 80 rows', count($c['loss']) === 80 && $c['loss'][4]['owner'] === 'O5', count($c['loss']));
// morning entry
$m = ole_clean_setup(['date' => '2026-11-16', 'line' => '2', 'mp' => '99', 'start' => '9:00', 'end' => '21:00', 'lunchStart' => '13:00', 'lunchEnd' => '13:30',
    'breaks' => [['name' => 'Tea 2', 'start' => '17:00', 'end' => '17:10'], ['start' => '11:00', 'end' => '11:10'], ['start' => '', 'end' => '']]]);
ok('morning entry cleaned: times HH:MM, breaks sorted, name default, manpower number', $m['start'] === '09:00' && $m['mp'] === 99 && $m['line'] === 2 && array_column($m['breaks'], 'start') === ['11:00', '17:00'] && $m['breaks'][0]['name'] === 'Tea break', $m);
foreach ([['end' => '08:00'], ['lunchStart' => '08:00', 'lunchEnd' => '08:30'], ['breaks' => [['start' => '21:30', 'end' => '21:40']]], ['mp' => '-3'], ['start' => '25:00']] as $bad) {
    try { ole_clean_setup(array_merge(['date' => '2026-11-16', 'line' => 1, 'start' => '09:00', 'end' => '21:00'], $bad)); ok('bad morning entry refused ' . json_encode($bad), false); }
    catch (InvalidArgumentException $x) { ok('bad morning entry refused ' . json_encode($bad), true); }
}
echo $fail ? "ole_test: $fail FAILED\n" : "ole_test: ALL OK\n";
exit($fail ? 1 : 0);
