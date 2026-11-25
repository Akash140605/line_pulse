<?php
/**
 * ui_settings.php — the screen setup made by the admin on the Setup page.
 *
 * GET                       → { management: {pages, home, oneView}, admin: {pages}, brand: {name, tagline, color}, theme: {colours, fonts, text size}, updatedAt, updatedBy }
 * POST (admin login only)   { "action": "save", "settings": {…} }   or   { "action": "reset" }
 * Kept in backend/data/ui_settings.json; the line databases are not touched.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
require_once __DIR__ . '/../lib/auth.php';
$me = auth_guard();
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/clock.php';
require_once __DIR__ . '/../lib/ui.php';

$body = store_begin();
if ($body === null) {
    $d = store_read('ui_settings');
    store_send(json_encode(ui_clean($d) + ['updatedAt' => $d['updatedAt'] ?? null, 'updatedBy' => $d['updatedBy'] ?? null], JSON_UNESCAPED_UNICODE));
    exit;
}
// the screen setup is changed only by a logged-in admin (even while login protection is still switched off)
if (!$me || ($me['role'] ?? '') !== 'admin') store_fail(403, 'Only the admin can change the screen setup. Please log in as admin.');

$action = (string)($body['action'] ?? '');
if ($action !== 'save' && $action !== 'reset') store_fail(400, 'Unknown action');
$clean = ui_clean($action === 'reset' ? [] : (array)($body['settings'] ?? []));
$who = (string)($me['user'] ?? 'admin');
$now = ems_now();   // DB ka time (lib/clock.php)
store_update('ui_settings', fn(array $d) => $clean + ['updatedAt' => $now, 'updatedBy' => $who]);
echo json_encode($clean + ['updatedAt' => $now, 'updatedBy' => $who], JSON_UNESCAPED_UNICODE);
