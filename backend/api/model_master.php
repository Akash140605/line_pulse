<?php
/**
 * model_master.php — the model master: company, model, target cycle time and the lines each model runs on.
 *
 * GET                       → { rows: [ {id, company, model, cycle, lines: [1,2], note, code, desc, segment, capacity, type, updatedAt} ], updatedAt }
 * POST (admin, JSON body, header X-EMS-Write: 1, only from the plant network)
 *   { "action": "save", "rows": [ … ] }   the whole master is replaced by these rows (after preview / edit on the screen)
 *
 * Kept in backend/data/model_master.json. The line databases are NOT touched: the targets of the lines are set
 * from the master on the screen (line_settings.php, locked targets marked "source: master").
 */
declare(strict_types=1);
ini_set('display_errors', '0');
require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // GET: any login; POST: admin only (lib/auth.php)
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/clock.php';

const MASTER_MAX_ROWS = 5000;

function master_text($v, int $max): string
{
    return mb_substr(trim(preg_replace('/[\x00-\x1F\x7F<>]/u', '', (string)$v) ?? ''), 0, $max);
}

/** One row checked and cleaned (throws with the row number on a problem). */
function master_row(array $r, int $i, string $now): array
{
    $model = master_text($r['model'] ?? '', 120);
    if ($model === '') throw new InvalidArgumentException("Row $i: model name is empty");
    $cycle = $r['cycle'] ?? null;
    if ($cycle === '' || $cycle === null) $cycle = null;
    elseif (!is_numeric($cycle) || (float)$cycle < 1 || (float)$cycle > 3600) throw new InvalidArgumentException("Row $i ($model): cycle time must be 1 – 3600 seconds");
    else $cycle = round((float)$cycle, 2);
    $lines = [];
    foreach ((array)($r['lines'] ?? []) as $l) {
        $n = filter_var($l, FILTER_VALIDATE_INT);
        if ($n !== false && $n >= 1 && $n <= 20) $lines[$n] = $n;
    }
    ksort($lines);
    $id = master_text($r['id'] ?? '', 40);
    if ($id === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $id)) $id = 'm' . bin2hex(random_bytes(5));
    return ['id' => $id, 'company' => master_text($r['company'] ?? '', 120), 'model' => $model, 'cycle' => $cycle,
            'lines' => array_values($lines), 'note' => master_text($r['note'] ?? '', 200),
            // details of the model (material code, description, segment, capacity, glass / plastic)
            'code' => master_text($r['code'] ?? '', 60), 'desc' => master_text($r['desc'] ?? '', 200), 'segment' => master_text($r['segment'] ?? '', 40),
            'capacity' => master_text($r['capacity'] ?? '', 40), 'type' => master_text($r['type'] ?? '', 40),
            'updatedAt' => master_text($r['updatedAt'] ?? '', 25) ?: $now];
}

$body = store_begin();
if ($body === null) {
    $d = store_read('model_master');
    store_send(json_encode(['rows' => array_values((array)($d['rows'] ?? [])), 'updatedAt' => $d['updatedAt'] ?? null], JSON_UNESCAPED_UNICODE));
    exit;
}

try {
    $action = (string)($body['action'] ?? '');
    if ($action !== 'save') store_fail(400, 'Unknown action');
    $rows = (array)($body['rows'] ?? []);
    if (count($rows) > MASTER_MAX_ROWS) store_fail(400, 'Too many rows (at most ' . MASTER_MAX_ROWS . ')');
    $now = ems_now();
    $clean = []; $seen = [];
    foreach (array_values($rows) as $i => $r) {
        $c = master_row((array)$r, $i + 1, $now);
        $key = mb_strtoupper($c['company'] . '|' . preg_replace('/\s+/', '', $c['model']));
        if (isset($seen[$key])) throw new InvalidArgumentException('Row ' . ($i + 1) . " ({$c['model']}): the same company and model is in row {$seen[$key]}");
        $seen[$key] = $i + 1;
        $clean[] = $c;
    }
    $all = store_update('model_master', fn(array $d) => ['rows' => $clean, 'updatedAt' => $now]);
    echo json_encode(['ok' => true, 'rows' => $all['rows'], 'updatedAt' => $all['updatedAt']], JSON_UNESCAPED_UNICODE);
} catch (InvalidArgumentException $e) {
    store_fail(400, $e->getMessage());
} catch (Throwable $e) {
    store_fail(500, 'The master could not be saved');
}
