<?php
/**
 * line_settings.php — shift / lunch window and model targets of a line (shared by every screen).
 *
 * GET  ?line=N                → { line, shift, shiftIsDefault, targets: { mmId: {cycle, pph, model, company, updatedAt} }, updatedAt }
 * POST ?line=N  (JSON body, header X-EMS-Write: 1, only from the plant network)
 *   { "action": "shift",   "shift": {start, end, lunchStart, lunchEnd}, "allLines": false }
 *   { "action": "target",  "mmId": 12, "cycle": 14.5, "model": "…", "company": "…" }   cycle null = remove the target
 *   { "action": "targets", "items": [ {mmId, cycle, model, company}, … ] }             several at once
 *   manual: true on a target = locked by the admin (the screens use it instead of the automatic Method A + 3 s target)
 *   { "action": "money",   "money": {pcValue, hourCost, values: {mmId: ₹}}, "allLines": false }  ₹ rates for the loss in rupees
 * The line databases are not touched: everything is kept in backend/data/line_settings.json.
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
$L = (string)$line;

function settings_view(array $all, string $L): array
{
    $shift = $all['shift'][$L] ?? $all['shift']['default'] ?? SHIFT_DEFAULT;
    $targets = [];
    foreach ($all['targets'][$L] ?? [] as $mm => $t) {
        $targets[(string)$mm] = $t + ['pph' => $t['cycle'] > 0 ? round(3600 / $t['cycle'], 1) : null];
    }
    return ['line' => (int)$L, 'shift' => $shift, 'shiftIsDefault' => !isset($all['shift'][$L]),
            'targets' => (object)$targets, 'money' => money_view($all['money'][$L] ?? $all['money']['default'] ?? null),
            'updatedAt' => $all['updatedAt'] ?? null];
}

function money_view(?array $m): array
{
    return ['pcValue' => $m['pcValue'] ?? null, 'hourCost' => $m['hourCost'] ?? null, 'values' => (object)($m['values'] ?? [])];
}

if ($body === null) {
    store_send(json_encode(settings_view(store_read('line_settings'), $L), JSON_UNESCAPED_UNICODE));
    exit;
}

try {
    $action = (string)($body['action'] ?? '');
    $now = ems_now();   // DB ka time (lib/clock.php)
    if ($action === 'shift') {
        $shift = shift_clean((array)($body['shift'] ?? []));
        $all = store_update('line_settings', function (array $d) use ($shift, $L, $body, $now) {
            if (!empty($body['allLines'])) { $d['shift'] = ['default' => $shift]; }   // one shift for every line
            else $d['shift'][$L] = $shift;
            $d['updatedAt'] = $now;
            return $d;
        });
    } elseif ($action === 'target' || $action === 'targets') {
        $items = $action === 'target' ? [$body] : (array)($body['items'] ?? []);
        if (count($items) > 2000) store_fail(400, 'Too many targets at once');
        $clean = array_map(fn($t) => target_clean((array)$t), $items);
        $all = store_update('line_settings', function (array $d) use ($clean, $L, $now) {
            foreach ($clean as $t) {
                if ($t['cycle'] === null) { unset($d['targets'][$L][(string)$t['mmId']]); continue; }
                $d['targets'][$L][(string)$t['mmId']] = ['cycle' => $t['cycle'], 'model' => $t['model'], 'company' => $t['company'], 'updatedAt' => $now]
                    + ($t['manual'] ? ['manual' => true] : []) + (($t['source'] ?? '') === 'master' ? ['source' => 'master'] : []);
            }
            $d['updatedAt'] = $now;
            return $d;
        });
    } elseif ($action === 'money') {
        $money = money_clean((array)($body['money'] ?? []));
        $all = store_update('line_settings', function (array $d) use ($money, $L, $body, $now) {
            if (!empty($body['allLines'])) {
                // same ₹ rates on every line; each line keeps its own model values
                $d['money']['default'] = ['pcValue' => $money['pcValue'], 'hourCost' => $money['hourCost'], 'values' => []];
                foreach ($d['money'] ?? [] as $k => $v) if ($k !== 'default') { $d['money'][$k]['pcValue'] = $money['pcValue']; $d['money'][$k]['hourCost'] = $money['hourCost']; }
                $d['money'][$L] = $money;
            } else $d['money'][$L] = $money;
            $d['money'][$L]['updatedAt'] = $now;
            $d['updatedAt'] = $now;
            return $d;
        });
    } else {
        store_fail(400, 'action must be shift, target, targets or money');
    }
    echo json_encode(settings_view($all, $L), JSON_UNESCAPED_UNICODE);
} catch (InvalidArgumentException $e) {
    store_fail(400, $e->getMessage());
} catch (Throwable $e) {
    store_fail(500, 'Could not save: ' . $e->getMessage());
}
