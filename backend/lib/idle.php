<?php
/**
 * LINE-LEVEL idle time (no scan of any selected model for a long time).
 * Per-model outlier gaps overlap (one lunch break is seen by every model), so summing them over-counts.
 * Here each idle interval is taken ONCE from all-model scan gaps, then split across hours (clipped).
 */
require_once __DIR__ . '/../config/queries.php';

function fetch_idle_intervals(PDO $pdo, array $range): array
{
    $q = idle_query($range);
    $st = $pdo->prepare($q['sql']);
    $st->execute($q['params']);
    return $st->fetchAll(PDO::FETCH_NUM);
}

/** [[start,end,gap]] -> ['sec' => day => hour => seconds, 'cnt' => day => hour => gaps (counted in the hour it started)] */
function distribute_idle(array $intervals): array
{
    $utc = new DateTimeZone('UTC');
    $sec = []; $cnt = [];
    foreach ($intervals as $iv) {
        $a = (new DateTime($iv[0], $utc))->getTimestamp();
        $b = (new DateTime($iv[1], $utc))->getTimestamp();
        $d = gmdate('Y-m-d', $a); $h = (int)gmdate('G', $a);
        $cnt[$d][$h] = ($cnt[$d][$h] ?? 0) + 1;
        for ($t = $a; $t < $b;) {
            $next = min($b, $t - ($t % 3600) + 3600);
            $dd = gmdate('Y-m-d', $t); $hh = (int)gmdate('G', $t);
            $sec[$dd][$hh] = ($sec[$dd][$hh] ?? 0) + ($next - $t);
            $t = $next;
        }
    }
    return ['sec' => $sec, 'cnt' => $cnt];
}

function idle_day_totals(array $idle, string $date): array
{
    return ['sec' => array_sum($idle['sec'][$date] ?? []), 'cnt' => array_sum($idle['cnt'][$date] ?? [])];
}

/** adds idleSeconds / idleGaps to every hour row + the day totals of an hourly payload */
function attach_idle_hourly(array $hourly, array $idle): array
{
    $d = $hourly['date'];
    foreach ($hourly['hours'] as &$h) { $h['idleSeconds'] = (int)($idle['sec'][$d][$h['hour']] ?? 0); $h['idleGaps'] = (int)($idle['cnt'][$d][$h['hour']] ?? 0); }
    unset($h);
    $t = idle_day_totals($idle, $d);
    $hourly['idleSeconds'] = $t['sec']; $hourly['idleGaps'] = $t['cnt'];
    return $hourly;
}

function attach_idle_daily(array $daily, array $idle): array
{
    foreach ($daily['days'] as &$d) { $t = idle_day_totals($idle, $d['date']); $d['idleSeconds'] = $t['sec']; $d['idleGaps'] = $t['cnt']; }
    unset($d);
    $daily['idleSeconds'] = array_sum(array_column($daily['days'], 'idleSeconds'));
    $daily['idleGaps'] = array_sum(array_column($daily['days'], 'idleGaps'));
    return $daily;
}

function attach_idle_matrix(array $matrix, array $idle): array
{
    foreach ($matrix as $date => &$day) foreach ($day['hours'] as &$h) { $h['idleSeconds'] = (int)($idle['sec'][$date][$h['hour']] ?? 0); }
    return $matrix;
}

function attach_idle_analytics(array $payload, array $idle): array
{
    foreach ($payload['daily'] as &$d) { $t = idle_day_totals($idle, $d['date']); $d['idleSeconds'] = $t['sec']; $d['idleGaps'] = $t['cnt']; }
    unset($d);
    $payload['overall']['idleSeconds'] = array_sum(array_column($payload['daily'], 'idleSeconds'));
    $payload['overall']['idleGaps'] = array_sum(array_column($payload['daily'], 'idleGaps'));
    return $payload;
}
