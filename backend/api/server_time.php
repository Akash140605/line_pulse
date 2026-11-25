<?php
require_once __DIR__ . '/../lib/clock.php';   // India time zone (php.ini says Europe/Berlin)
require_once __DIR__ . '/../lib/auth.php';
// 25-11-2026 security: the clock needs no login (the login page asks it), but only a Line Pulse page gets it — a
// program, a blocked PC or a flood is refused before the database is asked (lib/security.php)
auth_cors();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }
sec_check(null);
// the check of every line's database clock (?all=1) is for the admin only
if (isset($_GET['all'])) auth_guard('admin');
require_once __DIR__ . '/../config/db.php';

json_headers();
header('Cache-Control: no-store');

// Check mode: server_time.php?all=1 -> har line ke DB ka aur PHP ka time
if (isset($_GET['all'])) {
    $out = ['php' => date('Y-m-d H:i:s')];
    foreach (LINES as $n => $c) {
        try { $out['line' . $n] = connect_line((int)$n, false)->query("SELECT CONVERT(char(19), GETDATE(), 120)")->fetchColumn(); }
        catch (Throwable $e) { $out['line' . $n] = 'offline'; }
    }
    echo json_encode($out);
    exit;
}

$now = db_now($src);
echo json_encode(['now' => $now, 'today' => substr($now, 0, 10), 'source' => $src]);