<?php
/**
 * store_info.php — where the software keeps its own settings (admin only, read-only):
 *   SQL Server on this PC, database EMS_LinePulse_App (lib/appdb.php) — or the JSON files while SQL Server does not answer.
 * Lists every store with its version and last save time. Never shows a password.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
require_once __DIR__ . '/../lib/auth.php';
auth_guard('admin');
require_once __DIR__ . '/../lib/store.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo json_encode(appdb_info(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
