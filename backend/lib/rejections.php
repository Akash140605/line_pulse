<?php
/** Rejected (false) scans for one day. Table auto-detected (needs FalseBarcode + ErrorMessage columns), fallback FALSE_SCAN_TABLE. */
function detect_false_table(PDO $pdo): ?string
{
    $t = $pdo->query("
        SELECT TOP 1 TABLE_SCHEMA + '.' + TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE COLUMN_NAME IN ('FalseBarcode', 'ErrorMessage')
        GROUP BY TABLE_SCHEMA, TABLE_NAME HAVING COUNT(DISTINCT COLUMN_NAME) = 2
    ")->fetchColumn();
    if ($t) return $t;
    $c = $pdo->prepare('SELECT OBJECT_ID(:t)');
    $c->execute([':t' => FALSE_SCAN_TABLE]);
    return $c->fetchColumn() ? FALSE_SCAN_TABLE : null;
}

function build_rejection_payload(PDO $pdo, array $range, int $good): array
{
    $date = $range['startDate'];
    $table = detect_false_table($pdo);
    $rej = [];
    if ($table) {
        $where = 'f.ErrorDateTime >= CAST(:d AS DATE) AND f.ErrorDateTime < DATEADD(DAY, 1, CAST(:d2 AS DATE))';
        $p = [':d' => $date, ':d2' => $date];
        if ($range['companyId']) { $where .= ' AND m.CompanyId = :companyId'; $p[':companyId'] = $range['companyId']; }
        if ($range['mmId'])      { $where .= ' AND f.MMId = :mmId';           $p[':mmId'] = $range['mmId']; }
        $st = $pdo->prepare("
            SELECT f.FSId, f.MMId, m.Model, m.ModelCode, f.FalseBarcode, f.ErrorMessage,
                   CONVERT(VARCHAR(19), f.ErrorDateTime, 120) AS ErrorDateTime, DATEPART(HOUR, f.ErrorDateTime) AS HourSlot
            FROM $table f LEFT JOIN dbo.Tab_ModelMaster m ON m.MMId = f.MMId
            WHERE $where ORDER BY f.ErrorDateTime DESC");
        $st->execute($p);
        $rej = $st->fetchAll(PDO::FETCH_ASSOC);
    }

    $hourly = array_fill(0, 24, 0); $models = []; $reasons = [];
    foreach ($rej as $r) {
        $hourly[(int)$r['HourSlot']]++;
        $k = (int)$r['MMId'];
        $models[$k] ??= ['mmId' => $k, 'model' => $r['Model'] ?? "#$k", 'modelCode' => $r['ModelCode'], 'rejectionQty' => 0];
        $models[$k]['rejectionQty']++;
        $msg = trim((string)$r['ErrorMessage']) ?: 'Unknown';
        $reasons[$msg] = ($reasons[$msg] ?? 0) + 1;
    }
    arsort($reasons);
    $models = array_values($models);
    usort($models, fn($a, $b) => $b['rejectionQty'] <=> $a['rejectionQty']);
    $total = count($rej);

    return [
        'warning' => $table ? null : 'False-scan table not found',
        'from' => $date, 'to' => $date,
        'summary' => ['totalRejections' => $total, 'totalAttempts' => $good + $total, 'successfulQty' => $good,
                      'rejectionRate' => ($good + $total) > 0 ? round($total * 100 / ($good + $total), 2) : 0],
        'hourly' => array_map(fn($h) => ['hour' => $h, 'label' => hour_label($h), 'rejectionQty' => $hourly[$h]], range(0, 23)),
        'models' => $models,
        'reasons' => array_map(fn($m, $c) => ['reason' => $m, 'rejectionQty' => $c], array_keys($reasons), array_values($reasons)),
        'recent' => array_map(fn($r) => [
            'fsId' => (int)$r['FSId'], 'mmId' => (int)$r['MMId'], 'model' => $r['Model'], 'modelCode' => $r['ModelCode'],
            'barcode' => $r['FalseBarcode'], 'reason' => $r['ErrorMessage'], 'dateTime' => $r['ErrorDateTime'],
            'hour' => (int)$r['HourSlot'], 'label' => hour_label((int)$r['HourSlot']),
        ], array_slice($rej, 0, 100)),
    ];
}
