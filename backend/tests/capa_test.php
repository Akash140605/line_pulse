<?php
// php tests/capa_test.php — the CAPA form fields of an RCA (lib/capa.php); no database, no files
declare(strict_types=1);
require_once __DIR__ . '/../lib/capa.php';
$fail = 0;
function ok(string $name, bool $c): void { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $name . "\n"; if (!$c) $fail++; }

ok('nothing sent: null (the saved form is kept)', capa_clean(null) === null);
$c = capa_clean(['equip' => ' <b>Conveyor</b> 2 ', 'hall' => 'Hall-3', 'problem' => str_repeat('x', 1200), 'whyQ' => ['Why stopped?', '', 'Why loose?', '', ''],
  'caTarget' => '2026-11-30', 'caResp' => 'Neeraj', 'paTarget' => '30-11-2026', 'implemented' => 'yes', 'verifiedBy' => 'QA head', 'verifyDate' => '2026-12-01', 'x' => 'dropped']);
ok('tags removed, text trimmed', $c['equip'] === 'Conveyor 2');
ok('long text cut at 1000', mb_strlen($c['problem']) === 1000);
ok('why questions: empty ones at the end dropped, middle kept', $c['whyQ'] === ['Why stopped?', '', 'Why loose?']);
ok('dates: only YYYY-MM-DD', $c['caTarget'] === '2026-11-30' && $c['paTarget'] === '');
ok('implemented: yes / no / partly only', $c['implemented'] === 'yes' && capa_clean(['implemented' => 'maybe'])['implemented'] === '');
ok('unknown fields dropped', !array_key_exists('x', $c));
$h = capa_head(['docNo' => ' DIXON/QA/01 ', 'revNo' => '']);
ok('form header: own doc no, defaults for the rest', $h['docNo'] === 'DIXON/QA/01' && $h['revNo'] === '0' && $h['company'] === 'DIXON TECHNOLOGIES INDIA LIMITED');
ok('form header default', capa_head(null)['title'] === 'CORRECTIVE AND PREVENTIVE ACTION PLAN');
echo $fail ? "FAILED $fail\n" : "ALL OK\n";
exit($fail ? 1 : 0);
