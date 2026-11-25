<?php
/**
 * Copies the line databases into this PC's SQL Server (EMS_Backup_Line<N>).  Works only from this PC (localhost).
 *   mirror_sync.php?line=3            copy for about 40 s, then answer with the progress (call again until done)
 *   mirror_sync.php?line=3&verify=1   compare line and backup: row counts and checksums of the newest 20 000 rows
 * The line servers are only read.
 */
declare(strict_types=1);
@set_time_limit(180);
ini_set('display_errors', '0');
@ini_set('memory_limit', '512M');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$ip = $_SERVER['REMOTE_ADDR'] ?? '';
if (!in_array($ip, ['127.0.0.1', '::1'], true)) { http_response_code(403); echo json_encode(['error' => 'Only from this PC (localhost).']); exit; }

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/mirror.php';

$line = (int)($_GET['line'] ?? 0);
if (!isset(LINES[$line])) { http_response_code(400); echo json_encode(['error' => 'line must be one of ' . implode(', ', array_keys(LINES))]); exit; }
// copying: one run per line at a time (verify only reads, so it may run alongside)
$lock = null;
if (empty($_GET['verify'])) {
    $lock = mirror_lock($line);
    if (!$lock) { echo json_encode(['line' => $line, 'database' => mirror_db_name($line), 'busy' => true, 'done' => false,
        'note' => 'Another copy run of this line is still working; nothing done. Try again later.']); exit; }
}
$budget = max(5, min(120, (int)($_GET['budget'] ?? 40)));
$deadline = microtime(true) + $budget;
$out = ['line' => $line, 'database' => mirror_db_name($line), 'tables' => []];
$t0 = microtime(true);
try {
    $src = connect_line($line, false); // the line server itself, never its backup
    $l = mirror_ensure_db($line);
    $tables = mirror_source_tables($src);
    if (!empty($_GET['verify'])) {
        foreach ($tables as $t) {
            $full = mirror_q($t['schema']) . '.' . mirror_q($t['table']);
            $v = ['table' => $t['schema'] . '.' . $t['table']];
            try {
                $v['sourceRows'] = (int)$src->query("SELECT COUNT_BIG(*) FROM $full")->fetchColumn();
                $v['localRows'] = (int)$l->query("SELECT COUNT_BIG(*) FROM $full")->fetchColumn();
                if (mirror_can_chunk($t['cols'], $t['pk'])) {
                    $key = mirror_q($t['pk'][0]);
                    $max = $l->query("SELECT CONVERT(varchar(60), MAX($key)) FROM $full")->fetchColumn();
                    $from = $l->query("SELECT CONVERT(varchar(60), MIN($key)) FROM (SELECT TOP 20000 $key FROM $full ORDER BY $key DESC) x")->fetchColumn();
                    $sum = "SELECT COUNT_BIG(*) AS n, CHECKSUM_AGG(BINARY_CHECKSUM(*)) AS c FROM $full WHERE $key BETWEEN ? AND ?";
                    $a = $src->prepare($sum); $a->execute([$from, $max]); $sa = $a->fetch(PDO::FETCH_ASSOC);
                    $b = $l->prepare($sum); $b->execute([$from, $max]); $sb = $b->fetch(PDO::FETCH_ASSOC);
                    $v['checkedKeys'] = "$from … $max";
                    $v['sameRows'] = ((int)$sa['n'] === (int)$sb['n']) && ((string)$sa['c'] === (string)$sb['c']);
                    $v['upToKey'] = $max;
                    $before = $src->prepare("SELECT COUNT_BIG(*) FROM $full WHERE $key <= ?"); $before->execute([$max]);
                    $v['sourceRowsUpToKey'] = (int)$before->fetchColumn();
                    $v['complete'] = $v['sourceRowsUpToKey'] === $v['localRows'];
                } else {
                    $sum = "SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM $full";
                    $v['sameRows'] = (string)$src->query($sum)->fetchColumn() === (string)$l->query($sum)->fetchColumn();
                    $v['complete'] = $v['sourceRows'] === $v['localRows'];
                }
            } catch (Throwable $e) { $v['error'] = substr($e->getMessage(), 0, 300); }
            $out['tables'][] = $v;
        }
    } else {
        foreach ($tables as $t) {
            if (microtime(true) > $deadline) { $out['tables'][] = ['table' => $t['schema'] . '.' . $t['table'], 'done' => false, 'note' => 'next call']; continue; }
            $out['tables'][] = mirror_sync_table($src, $l, $t, $deadline);
        }
        $out['done'] = !array_filter($out['tables'], fn($r) => empty($r['done']));
    }
} catch (Throwable $e) {
    $out['error'] = substr($e->getMessage(), 0, 400);
}
$out['seconds'] = round(microtime(true) - $t0, 1);
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
