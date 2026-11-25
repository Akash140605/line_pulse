<?php
/**
 * GET /api/serials.php?line=N&date=YYYY-MM-DD[&after=ScanId][&limit=20000]
 *
 * Carton & serial report (23-11-2026): the good scans of one line and day — time, model, company, serial number
 * (ProductBarcode), carton number (CartonBarcode), component barcode — oldest first.
 *   after = only the scans after this ScanId (the screen asks for the new ones every 20 s; nothing cached then)
 * READ ONLY (one SELECT on the line database, see lib/serials.php).
 */
require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/cache.php';
require_once __DIR__ . '/../lib/scanid.php';
require_once __DIR__ . '/../lib/serials.php';

json_headers();
$date = (string)($_GET['date'] ?? '');
$line = (int)($_GET['line'] ?? 1);
$after = max(0, (int)($_GET['after'] ?? 0));
$limit = max(1, min(50000, (int)($_GET['limit'] ?? 20000)));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) { http_response_code(400); echo json_encode(['error' => 'date must be YYYY-MM-DD']); exit; }
if (!auth_line_ok($line)) { http_response_code(403); echo json_encode(['error' => 'This login may not see this line.']); exit; }

// the whole day is kept 15 s (a finished day longer, lib/cache.php); the new scans after an id are read fresh, never stored
if ($after === 0) cache_or_capture(15, false);
$pdo = get_db();
$range = with_scan_ids($pdo, ['startDate' => $date, 'endDate' => $date]);
[$sql, $idP] = serials_sql($range, $limit);
$st = $pdo->prepare($sql);
$st->execute([':d1' => $date, ':d2' => $date, ':after' => $after] + $idP);
echo json_encode(serials_shape($st->fetchAll(PDO::FETCH_ASSOC), $date, $line, $limit, $after), JSON_UNESCAPED_UNICODE);
