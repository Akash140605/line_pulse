<?php
/**
 * files.php (20-11-2026) — evidence of an RCA (photo, PDF, Excel, Word …) and the profile picture of a login.
 * The files are kept in backend/data/files (not reachable from the web: data/.htaccess denies it), their list in the
 * store "ole_files"; the pictures of the logins in the store "user_avatars". The line databases are never touched.
 *
 *  POST { action:'upload', for:'rca', name, data: base64 }       → { ok, file: { id, name, type, size } }
 *       any login (the RCA save checks who may write that RCA and that the file ids exist); ≤ 5 MB a file
 *  GET  ?id=<24 hex>                                              → the file itself (any login)
 *  GET  ?avatars=1                                                → { avatars: { user: { preset } | { file } } }
 *  POST { action:'avatar', preset:'<emoji>' } | { action:'avatar', data: base64 jpeg/png/webp ≤ 400 KB } | { action:'avatar', clear:true }
 *       the login's own picture (not a TV login)
 */
declare(strict_types=1);
ini_set('display_errors', '0');
require_once __DIR__ . '/../lib/auth.php';
$me = auth_guard('view', true);
require_once __DIR__ . '/../lib/store.php';

/** extension → [content type, shown in the browser (inline) or downloaded] */
const FILES_TYPES = [
    'jpg' => ['image/jpeg', true], 'jpeg' => ['image/jpeg', true], 'png' => ['image/png', true], 'webp' => ['image/webp', true], 'gif' => ['image/gif', true],
    'pdf' => ['application/pdf', true],
    'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false], 'xls' => ['application/vnd.ms-excel', false],
    'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', false], 'doc' => ['application/msword', false],
    'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation', false], 'ppt' => ['application/vnd.ms-powerpoint', false],
    'csv' => ['text/csv', false], 'txt' => ['text/plain', false],
];
const FILES_MAX = 5_000_000;
const AVATAR_MAX = 400_000;
/** the pictures a login can pick instead of a photo */
const AVATAR_PRESETS = ['😎', '🤖', '🦁', '🐯', '🐼', '🦊', '🐵', '🦉', '👷', '🧑‍🔧', '🥷', '🦸', '🧙', '👽', '🐱', '🐶', '🚀', '⚡', '🔥', '🏆', '🤓', '🥳', '😴', '🤠'];

function files_dir(): string { return store_dir() . '/files'; }

/** the file's first bytes must match its extension (a renamed program is refused) */
function files_magic_ok(string $ext, string $raw): bool
{
    $h = substr($raw, 0, 12);
    switch ($ext) {
        case 'jpg': case 'jpeg': return strncmp($h, "\xFF\xD8\xFF", 3) === 0;
        case 'png': return strncmp($h, "\x89PNG\r\n\x1A\n", 8) === 0;
        case 'gif': return strncmp($h, 'GIF8', 4) === 0;
        case 'webp': return strncmp($h, 'RIFF', 4) === 0 && substr($h, 8, 4) === 'WEBP';
        case 'pdf': return strncmp($h, '%PDF', 4) === 0;
        case 'xlsx': case 'docx': case 'pptx': return strncmp($h, "PK\x03\x04", 4) === 0;
        case 'xls': case 'doc': case 'ppt': return strncmp($h, "\xD0\xCF\x11\xE0", 4) === 0;
        case 'csv': case 'txt': return strpos($raw, "\0") === false;
    }
    return false;
}

/** a file name as shown: no path, no control or markup characters, at most 80 characters */
function files_name(string $n): string
{
    $n = basename(str_replace('\\', '/', $n));
    $n = preg_replace('/[\x00-\x1F\x7F<>:"\/\\\\|?*]+/u', '', $n) ?? '';
    return mb_substr(trim($n), 0, 80);
}

/** base64 → bytes (a data: URL prefix is allowed); null when it is not base64 */
function files_b64(string $s): ?string
{
    $s = preg_replace('/^data:[^,]*,/', '', $s) ?? '';
    $raw = base64_decode($s, true);
    return $raw === false ? null : $raw;
}

/** keep one file: [id, ext]; throws InvalidArgumentException */
function files_keep(string $raw, string $ext): string
{
    $dir = files_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) throw new RuntimeException('The files folder cannot be made');
    $id = bin2hex(random_bytes(12));
    if (file_put_contents("$dir/$id.$ext", $raw) === false) throw new RuntimeException('The file cannot be kept');
    return $id;
}

/** body of a POST: as store_begin, with room for a 5 MB file (base64 ≈ 6.7 MB) */
function files_body(): array
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    if (store_remote() || !store_private_ip(store_client_ip())) store_fail(403, 'Changes are accepted only from the plant network');
    if (!store_origin_ok($origin)) store_fail(403, 'Changes are accepted only from the dashboard');
    if (($_SERVER['HTTP_X_EMS_WRITE'] ?? '') !== '1') store_fail(403, 'Missing X-EMS-Write header');
    $raw = file_get_contents('php://input');
    if (strlen((string)$raw) > 7_000_000) store_fail(413, 'The file is too large (at most 5 MB).');
    $j = json_decode((string)$raw, true);
    if (!is_array($j)) store_fail(400, 'Body must be JSON');
    return $j;
}

if (PHP_SAPI === 'cli' && !empty($GLOBALS['FILES_TEST'])) return;   // tests: the functions only

$m = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($m === 'GET') {
    if (isset($_GET['avatars'])) {
        header('Content-Type: application/json; charset=utf-8');
        store_send(json_encode(['avatars' => (object)(store_read('user_avatars', ['users' => []])['users'] ?? []), 'presets' => AVATAR_PRESETS], JSON_UNESCAPED_UNICODE));
        exit;
    }
    $id = (string)($_GET['id'] ?? '');
    if (!preg_match('/^[a-f0-9]{24}$/', $id)) { header('Content-Type: application/json'); store_fail(400, 'id is needed'); }
    $meta = (store_read('ole_files', ['files' => []])['files'] ?? [])[$id] ?? null;
    $ext = $meta['ext'] ?? '';
    $f = files_dir() . "/$id.$ext";
    if (!$meta || !isset(FILES_TYPES[$ext]) || !is_file($f)) { header('Content-Type: application/json'); store_fail(404, 'File not found'); }
    [$type, $inline] = FILES_TYPES[$ext];
    $name = (string)($meta['name'] ?? "file.$ext");
    header('Content-Type: ' . $type);
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    header('Cache-Control: private, max-age=86400');
    header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . "; filename=\"" . preg_replace('/[^A-Za-z0-9._ -]/', '_', $name) . "\"; filename*=UTF-8''" . rawurlencode($name));
    header('Content-Length: ' . filesize($f));
    readfile($f);
    exit;
}
if ($m !== 'POST') { header('Content-Type: application/json'); store_fail(405, 'Only GET and POST'); }
$body = files_body();
if (!$me) store_fail(401, 'Please log in to add a file.');
if (($me['role'] ?? '') === 'tv') store_fail(403, 'A TV login cannot add files.');
$who = (string)($me['user'] ?? '');
$action = (string)($body['action'] ?? '');
try {
    if ($action === 'upload') {
        if (($body['for'] ?? '') !== 'rca') store_fail(400, "for must be 'rca'");
        $name = files_name((string)($body['name'] ?? ''));
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if ($name === '' || !isset(FILES_TYPES[$ext])) store_fail(400, 'Only photos (JPG, PNG, WEBP, GIF), PDF, Excel, Word, PowerPoint, CSV or text files.');
        $raw = files_b64((string)($body['data'] ?? ''));
        if ($raw === null || $raw === '') store_fail(400, 'The file is empty or not readable.');
        if (strlen($raw) > FILES_MAX) store_fail(413, 'The file is too large (at most 5 MB).');
        if (!files_magic_ok($ext, $raw)) store_fail(400, "The file is not a real .$ext file.");
        $id = files_keep($raw, $ext);
        $file = ['id' => $id, 'name' => $name, 'type' => FILES_TYPES[$ext][0], 'size' => strlen($raw)];
        store_update('ole_files', function (array $d) use ($file, $ext, $who) {
            $d['files'] = $d['files'] ?? [];
            $d['files'][$file['id']] = ['name' => $file['name'], 'ext' => $ext, 'size' => $file['size'], 'for' => 'rca', 'by' => $who, 'at' => ems_now_safe()];
            return $d;
        }, ['files' => []]);
        echo json_encode(['ok' => true, 'file' => $file], JSON_UNESCAPED_UNICODE);
        exit;
    }
    if ($action === 'avatar') {
        if ($who === '') store_fail(400, 'No login name');
        $pick = null;
        if (!empty($body['clear'])) $pick = null;
        elseif (isset($body['preset'])) {
            $p = (string)$body['preset'];
            if (!in_array($p, AVATAR_PRESETS, true)) store_fail(400, 'Pick one of the pictures.');
            $pick = ['preset' => $p];
        } else {
            $raw = files_b64((string)($body['data'] ?? ''));
            if ($raw === null || $raw === '') store_fail(400, 'The photo is empty or not readable.');
            if (strlen($raw) > AVATAR_MAX) store_fail(413, 'The photo is too large.');
            $ext = files_magic_ok('jpg', $raw) ? 'jpg' : (files_magic_ok('png', $raw) ? 'png' : (files_magic_ok('webp', $raw) ? 'webp' : ''));
            if ($ext === '') store_fail(400, 'The photo must be JPG, PNG or WEBP.');
            $id = files_keep($raw, $ext);
            store_update('ole_files', function (array $d) use ($id, $ext, $raw, $who) {
                $d['files'] = $d['files'] ?? [];
                $d['files'][$id] = ['name' => "profile.$ext", 'ext' => $ext, 'size' => strlen($raw), 'for' => 'avatar', 'by' => $who, 'at' => ems_now_safe()];
                return $d;
            }, ['files' => []]);
            $pick = ['file' => $id];
        }
        $all = store_update('user_avatars', function (array $d) use ($who, $pick) {
            $d['users'] = $d['users'] ?? [];
            if ($pick === null) unset($d['users'][$who]); else $d['users'][$who] = $pick;
            return $d;
        }, ['users' => []]);
        echo json_encode(['ok' => true, 'avatar' => $pick, 'avatars' => (object)($all['users'] ?? [])], JSON_UNESCAPED_UNICODE);
        exit;
    }
    store_fail(400, "action must be 'upload' or 'avatar'");
} catch (Throwable $x) {
    store_fail(500, 'Not saved: ' . $x->getMessage());
}

function ems_now_safe(): string
{
    if (!function_exists('ems_now')) { $c = __DIR__ . '/../lib/clock.php'; if (is_file($c)) require_once $c; }
    return function_exists('ems_now') ? ems_now() : date('Y-m-d H:i:s');
}
