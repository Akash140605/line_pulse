<?php
/**
 * Carton & serial report (23-11-2026): every good scan of one line and day with its serial (ProductBarcode),
 * carton (CartonBarcode) and component barcode, from dbo.ScanStatus + Tab_ModelMaster + Tab_CompanyMaster.
 * READ ONLY: one SELECT, nothing is written to the line database.
 */

/** The SELECT of one day (good scans only, as every other screen: Status not 'FALSE'), oldest first, after a ScanId. */
function serials_sql(array $idRange, int $limit): array
{
    $limit = max(1, min(50000, $limit));
    [$idSql, $idP] = scan_id_sql($idRange, 's');
    $sql = "SELECT TOP $limit s.ScanId, s.MMId, m.Model, m.ModelCode, c.CompanyTitle,
                   s.ComponentBarcode, s.ProductBarcode, s.CartonBarcode, CONVERT(char(19), s.ScanDate, 120) AS ScanDate
            FROM dbo.ScanStatus s
            INNER JOIN dbo.Tab_ModelMaster m ON m.MMId = s.MMId
            INNER JOIN dbo.Tab_CompanyMaster c ON c.CompanyId = m.CompanyId
            WHERE (s.Status IS NULL OR LTRIM(RTRIM(UPPER(s.Status))) <> 'FALSE')
              AND s.ScanDate >= CAST(:d1 AS DATE) AND s.ScanDate < DATEADD(DAY, 1, CAST(:d2 AS DATE))
              AND s.ScanId > :after $idSql
            ORDER BY s.ScanId";
    return [$sql, $idP];
}

/** Rows of the database → the answer: rows (time, model, serial, carton …), per model and per carton, totals. */
function serials_shape(array $raw, string $date, int $line, int $limit, int $after): array
{
    $t = fn($v) => $v === null ? '' : trim((string)$v);
    $rows = [];
    foreach ($raw as $r) {
        $rows[] = [
            'id' => (int)$r['ScanId'], 'at' => substr($t($r['ScanDate']), 0, 19), 'mmId' => (int)$r['MMId'],
            'model' => $t($r['Model']), 'code' => $t($r['ModelCode']), 'company' => $t($r['CompanyTitle']),
            'serial' => $t($r['ProductBarcode']), 'carton' => $t($r['CartonBarcode']), 'component' => $t($r['ComponentBarcode']),
        ];
    }
    return ['date' => $date, 'line' => $line, 'after' => $after, 'count' => count($rows), 'more' => count($rows) >= $limit,
            'lastId' => $rows ? $rows[count($rows) - 1]['id'] : $after, 'rows' => $rows];
}
