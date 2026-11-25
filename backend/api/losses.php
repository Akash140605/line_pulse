<?php
/**
 * losses.php — loss register of a line (why production was lost, how long, who / which department).
 *
 * GET  ?line=N&start=YYYY-MM-DD&end=YYYY-MM-DD  → { line, entries: [...] }  (entries of that period, oldest first)
 * POST ?line=N  (JSON body, header X-EMS-Write: 1, only from the plant network)
 *   { "action": "save",   "entry": {id?, date, hour, minutes, reason, dept, person, mmId, model, remarks, from, to} }
 *   { "action": "delete", "id": "…" }
 *   { "action": "import", "entries": [ … ] }   entries kept in a browser by the older version; same id = not added twice
 * Kept in backend/data/losses_line<N>.json — the line databases are not touched.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/clock.php';

$body = store_begin();
$line = filter_var($_GET['line'] ?? null, FILTER_VALIDATE_INT);
if ($line === false || $line < 1 || $line > 20) store_fail(400, 'line must be a line number');
$name = 'losses_line' . $line;

$sortE = function (array $list): array {
    usort($list, fn($a, $b) => [$a['date'], $a['hour'], $a['from'] ?? '', $a['id']] <=> [$b['date'], $b['hour'], $b['from'] ?? '', $b['id']]);
    return $list;
};

if ($body === null) {
    $ymd = '/^\d{4}-\d{2}-\d{2}$/';
    $start = $_GET['start'] ?? '0000-01-01'; $end = $_GET['end'] ?? '9999-12-31';
    if (!preg_match($ymd, $start) || !preg_match($ymd, $end)) store_fail(400, 'start and end must be YYYY-MM-DD');
    $all = store_read($name, ['entries' => []]);
    $list = array_values(array_filter($all['entries'] ?? [], fn($e) => $e['date'] >= $start && $e['date'] <= $end));
    store_send(json_encode(['line' => $line, 'entries' => $sortE($list)], JSON_UNESCAPED_UNICODE));
    exit;
}

try {
    $action = (string)($body['action'] ?? '');
    $now = ems_now();   // DB ka time (lib/clock.php)
    $out = [];
    if ($action === 'save') {
        $e = loss_clean((array)($body['entry'] ?? []));
        store_update($name, function (array $d) use ($e, $now) {
            $list = $d['entries'] ?? [];
            $found = false;
            foreach ($list as $i => $x) if ($x['id'] === $e['id']) { $list[$i] = $e + ['createdAt' => $x['createdAt'] ?? $now, 'updatedAt' => $now]; $found = true; }
            if (!$found) $list[] = $e + ['createdAt' => $now, 'updatedAt' => $now];
            return ['entries' => array_values($list)];
        }, ['entries' => []]);
        $out = ['saved' => $e['id']];
    } elseif ($action === 'delete') {
        $id = (string)($body['id'] ?? '');
        $removed = 0;
        store_update($name, function (array $d) use ($id, &$removed) {
            $list = array_values(array_filter($d['entries'] ?? [], function ($x) use ($id, &$removed) { if ($x['id'] === $id) { $removed++; return false; } return true; }));
            return ['entries' => $list];
        }, ['entries' => []]);
        $out = ['deleted' => $removed];
    } elseif ($action === 'import') {
        $in = (array)($body['entries'] ?? []);
        if (count($in) > 20000) store_fail(400, 'Too many entries at once');
        $clean = []; $bad = 0;
        foreach ($in as $e) { try { $clean[] = loss_clean((array)$e); } catch (InvalidArgumentException $x) { $bad++; } }
        $added = 0;
        store_update($name, function (array $d) use ($clean, $now, &$added) {
            $list = $d['entries'] ?? [];
            $ids = array_flip(array_column($list, 'id'));
            foreach ($clean as $e) if (!isset($ids[$e['id']])) { $list[] = $e + ['createdAt' => $now, 'updatedAt' => $now, 'imported' => true]; $ids[$e['id']] = 1; $added++; }
            return ['entries' => $list];
        }, ['entries' => []]);
        $out = ['imported' => $added, 'skipped' => count($clean) - $added, 'invalid' => $bad];
    } else {
        store_fail(400, 'action must be save, delete or import');
    }
    echo json_encode(['ok' => true] + $out, JSON_UNESCAPED_UNICODE);
} catch (InvalidArgumentException $e) {
    store_fail(400, $e->getMessage());
} catch (Throwable $e) {
    store_fail(500, 'Could not save: ' . $e->getMessage());
}
