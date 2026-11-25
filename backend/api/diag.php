<?php
/**
 * diag.php — speed check (read-only). Open in a browser:
 *   http://<server>:8080/ems-dashboard/backend/api/diag.php
 * Shows where time goes: PHP settings, connection time per line, and the time of the
 * main queries (today / last 30 days), plus whether ScanStatus.ScanDate has an index.
 * Never prints credentials. Changes nothing.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
@set_time_limit(180);
require_once __DIR__ . '/../lib/auth.php';
auth_guard('admin');   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/clock.php';
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');

function ms(float $t0): int { return (int)round((microtime(true) - $t0) * 1000); }
function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES); }
function grade(?int $v, int $ok, int $warn): string {
    if ($v === null) return '';
    return $v <= $ok ? 'ok' : ($v <= $warn ? 'warn' : 'bad');
}

$php = [
    'PHP version'          => PHP_VERSION,
    'OPcache enabled'      => (function_exists('opcache_get_status') && @opcache_get_status(false)) ? 'YES' : 'NO',
    'pdo_sqlsrv loaded'    => extension_loaded('pdo_sqlsrv') ? 'YES' : 'NO',
    'zlib (gzip) loaded'   => extension_loaded('zlib') ? 'YES' : 'NO',
    'output_buffering'     => (string)ini_get('output_buffering'),
    'Cache folder writable'=> is_writable(sys_get_temp_dir()) ? 'YES (' . sys_get_temp_dir() . ')' : 'NO (' . sys_get_temp_dir() . ')',
];

$today = ems_today();
$from30 = date('Y-m-d', strtotime('-30 days', ems_time()));
$rows = [];
foreach (LINES as $id => $cfg) {
    $r = ['line' => $cfg['name'], 'connect' => null, 'today' => null, 'todayRows' => null,
          'month' => null, 'monthRows' => null, 'index' => '?', 'tableRows' => null, 'indexes' => '', 'identity' => '', 'error' => ''];
    @unlink(sys_get_temp_dir() . "/ems_line_down_{$id}.txt"); // measure the real connect, not the 60 s pause
    try {
        $t = microtime(true);
        $pdo = connect_line($id, false);
        $r['connect'] = ms($t);

        $t = microtime(true);
        $st = $pdo->prepare("SELECT COUNT(*) FROM dbo.ScanStatus s WHERE s.ScanDate >= CAST(:d AS DATE) AND s.ScanDate < DATEADD(DAY, 1, CAST(:d2 AS DATE))");
        $st->execute([':d' => $today, ':d2' => $today]);
        $r['todayRows'] = (int)$st->fetchColumn();
        $r['today'] = ms($t);

        $t = microtime(true);
        $st = $pdo->prepare("SELECT CAST(s.ScanDate AS DATE) d, COUNT(*) q FROM dbo.ScanStatus s
                             WHERE s.ScanDate >= CAST(:a AS DATE) AND s.ScanDate < DATEADD(DAY,1,CAST(:b AS DATE))
                             GROUP BY CAST(s.ScanDate AS DATE)");
        $st->execute([':a' => $from30, ':b' => $today]);
        $n = 0; while ($x = $st->fetch(PDO::FETCH_NUM)) $n += (int)$x[1];
        $r['monthRows'] = $n;
        $r['month'] = ms($t);

        $q = $pdo->query("SELECT TOP 1 i.name FROM sys.indexes i
                          JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal=1
                          JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
                          WHERE i.object_id = OBJECT_ID('dbo.ScanStatus') AND c.name='ScanDate'");
        $name = $q->fetchColumn();
        $r['index'] = $name ? 'YES' : 'NO';

        $q = $pdo->query("SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id=OBJECT_ID('dbo.ScanStatus') AND p.index_id IN (0,1)");
        $r['tableRows'] = (int)$q->fetchColumn();

        // indexes of ScanStatus (read-only metadata) and whether ScanId is an identity column
        $q = $pdo->query("SELECT i.name, i.type_desc, i.is_primary_key,
                                 STUFF((SELECT ',' + c.name FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                                        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0 ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 1, '') AS cols
                          FROM sys.indexes i WHERE i.object_id = OBJECT_ID('dbo.ScanStatus') AND i.index_id > 0");
        $r['indexes'] = implode(' | ', array_map(fn($x) => "{$x['type_desc']}" . ($x['is_primary_key'] ? ' PK' : '') . " ({$x['cols']})", $q->fetchAll(PDO::FETCH_ASSOC))) ?: 'HEAP (no index)';
        $q = $pdo->query("SELECT COLUMNPROPERTY(OBJECT_ID('dbo.ScanStatus'), 'ScanId', 'IsIdentity')");
        $r['identity'] = ((int)$q->fetchColumn()) === 1 ? 'YES' : 'NO';
    } catch (Throwable $e) {
        $r['error'] = preg_replace('/(PWD|Password|UID|User)=[^;]*/i', '$1=***', $e->getMessage());
    }
    $rows[] = $r;
}
?><!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Speed check</title>
<style>
body{font:14px system-ui,Segoe UI,Arial;margin:16px;color:#0f172a;background:#f8fafc}
h1{font-size:18px;margin:0 0 4px} p{margin:4px 0 12px;color:#475569}
table{border-collapse:collapse;background:#fff;margin-bottom:16px;width:100%;max-width:1000px}
th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left} th{background:#e2e8f0}
.ok{background:#dcfce7}.warn{background:#fef9c3}.bad{background:#fee2e2;font-weight:600}
</style></head><body>
<h1>Line Pulse — speed check (<?= h(ems_now()) ?> DB time · PC clock <?= h(date('Y-m-d H:i:s')) ?>)</h1>
<p>Green = fast, yellow = slow, red = very slow. Screenshot this page and send it.</p>
<table><tr><th>Setting</th><th>Value</th></tr>
<?php foreach ($php as $k => $v): $cls = ($v === 'NO' || str_starts_with($v, 'NO ')) ? 'bad' : ''; ?>
<tr><td><?= h($k) ?></td><td class="<?= $cls ?>"><?= h($v) ?></td></tr>
<?php endforeach; ?>
</table>
<table><tr><th>Line</th><th>Connect (ms)</th><th>Today query (ms)</th><th>Rows today</th><th>30-day query (ms)</th><th>Rows 30 days</th><th>Total rows in table</th><th>Index on ScanDate</th><th>All indexes</th><th>ScanId identity</th><th>Error</th></tr>
<?php foreach ($rows as $r): ?>
<tr><td><?= h($r['line']) ?></td>
<td class="<?= grade($r['connect'], 300, 1500) ?>"><?= h($r['connect'] ?? '—') ?></td>
<td class="<?= grade($r['today'], 300, 1500) ?>"><?= h($r['today'] ?? '—') ?></td>
<td><?= h($r['todayRows'] ?? '—') ?></td>
<td class="<?= grade($r['month'], 800, 3000) ?>"><?= h($r['month'] ?? '—') ?></td>
<td><?= h($r['monthRows'] ?? '—') ?></td>
<td><?= $r['tableRows'] === null ? '—' : h(number_format($r['tableRows'])) ?></td>
<td class="<?= $r['index'] === 'NO' ? 'bad' : ($r['index'] === 'YES' ? 'ok' : '') ?>"><?= h($r['index']) ?></td>
<td><?= h($r['indexes']) ?></td><td><?= h($r['identity']) ?></td>
<td class="<?= $r['error'] ? 'bad' : '' ?>"><?= h($r['error']) ?></td></tr>
<?php endforeach; ?>
</table>
</body></html>
