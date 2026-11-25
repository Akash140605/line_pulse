<?php
// php tests/ole_access_test.php — which entry pages a login may save on api/ole.php (no server, no database):
// Loss entry → stoppage / loss minutes and "line off all day", Quality entry → rejection / rework, Morning entry → setup.
// A login with its own page list (Users & logins) uses that list; without one, the pages ticked in Setup → Management view.
declare(strict_types=1);
require __DIR__ . '/../lib/ui.php';
$STORE = [];
function store_read(string $k, array $d = []): array { global $STORE; return $STORE[$k] ?? $d; }
$src = file_get_contents(__DIR__ . '/../api/ole.php');
$a = strpos($src, '    $own = $isAdmin'); $b = strpos($src, "\n", strpos($src, '    $may = fn'));
$code = substr($src, $a, $b - $a);
function may_of(bool $isAdmin, ?array $me, string $code): array { eval($code); return [$may('oleentry'), $may('qentry'), $may('daily')]; }
$fail = 0;
function ok(string $n, bool $c): void { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . "$n\n"; if (!$c) $fail++; }
ok('the access lines are found in api/ole.php', $a !== false && $b !== false && $b > $a);
ok('admin: every entry page', may_of(true, null, $code) === [true, true, true]);
ok('own list with Loss entry only: no Quality entry, no Morning entry', may_of(false, ['pages' => ['oleentry', 'dash']], $code) === [true, false, false]);
ok('own list with Quality entry only', may_of(false, ['pages' => ['qentry']], $code) === [false, true, false]);
ok('no own list, no saved setup: the default Management view (Loss + Quality entry, no Morning entry)', may_of(false, ['pages' => []], $code) === [true, true, false]);
$STORE['ui_settings'] = ['management' => ['pages' => [['id' => 'oleentry', 'on' => true], ['id' => 'qentry', 'on' => false], ['id' => 'daily', 'on' => true]]]];
ok('no own list: only the pages ticked in the saved Management view', may_of(false, ['pages' => []], $code) === [true, false, true]);
// saving: a page the login does not have keeps the old values of the hour
$m = strpos($src, '$old = (array)($list[$k] ?? []);');
ok('save keeps the other page\'s values of the hour', $m !== false
    && strpos($src, "if (!\$mayLoss || \$part === 'quality') {", $m) !== false
    && strpos($src, "\$e['stops'] = \$old['stops'] ?? []; \$e['losses'] = \$old['losses'] ?? [];", $m) !== false
    && strpos($src, "if (!\$mayQuality || \$part === 'loss') {", $m) !== false
    && strpos($src, "\$e['rejects'] = \$old['rejects'] ?? []; \$e['rework'] = \$old['rework'] ?? [];", $m) !== false);
echo $fail ? "$fail FAILED\n" : "ALL OK\n";
exit($fail ? 1 : 0);
