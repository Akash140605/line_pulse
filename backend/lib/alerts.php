<?php
/**
 * Security alerts for the admin (25-11-2026): a program that tried to copy the data, a blocked PC, a login used on
 * another PC, too many requests, too many wrong passwords, the admin login from a new PC, many reports downloaded at
 * once, the security settings changed. Each alert is kept (Setup → Security, the bell of the admin) and, when the admin
 * set it up, sent by e-mail (SMTP of the plant). The same alert (kind + PC + login) at most once in 10 minutes.
 * Kept in backend/data (security_alerts.json, security_mail.json — the mail password encrypted with the server's key).
 */
require_once __DIR__ . '/store.php';

const ALERT_MAX = 300;
const ALERT_QUIET = 600;   // seconds: the same alert is not repeated within 10 minutes
const ALERT_TEXT = [
    'no-page' => 'A program (not Line Pulse in a browser) tried to read the data',
    'blocked' => 'A blocked PC tried to use Line Pulse',
    'locked' => 'A login was used on a PC it is not allowed on',
    'too-many' => 'Too many requests from one PC (data being copied?)',
    'login-fail' => 'Many wrong passwords from one PC',
    'admin-new-pc' => 'The admin login was used on a new PC',
    'bulk-download' => 'Many reports downloaded in a short time',
    'security' => 'The security settings were changed',
    'remote-login' => 'A login from outside the plant (remote access)',
    'test' => 'Test alert from Line Pulse',
];

function alert_time(): string { return function_exists('activity_now') ? activity_now() : date('Y-m-d H:i:s'); }

/** raise an alert: kept for the admin and mailed (once in 10 minutes per kind + PC + login) */
function alert_raise(string $kind, string $detail = '', string $user = '', ?string $ip = null): void
{
    try {
        $ip = $ip ?? (function_exists('store_client_ip') ? store_client_ip() : (string)($_SERVER['REMOTE_ADDR'] ?? ''));
        $mark = sys_get_temp_dir() . '/ems_alert_' . md5($kind . '|' . $ip . '|' . $user);
        if ($kind !== 'test' && is_file($mark) && filemtime($mark) > time() - ALERT_QUIET) return;
        @touch($mark);
        $a = ['id' => bin2hex(random_bytes(6)), 'time' => alert_time(), 'kind' => $kind, 'text' => ALERT_TEXT[$kind] ?? $kind,
            'detail' => mb_substr($detail, 0, 300), 'ip' => mb_substr($ip, 0, 45), 'user' => mb_substr($user, 0, 40),
            'ua' => mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 160), 'read' => false];
        $lock = store_lock('security_alerts');
        try {
            $l = (array)(store_file_read('security_alerts', ['list' => []])['list'] ?? []); $l[] = $a;
            store_file_write('security_alerts', ['list' => array_slice($l, -ALERT_MAX)]);
        } finally { store_unlock($lock); }
        $m = mail_conf();
        if (!empty($m['on'])) {
            $sub = "Line Pulse security alert: {$a['text']}";
            $body = "{$a['text']}\r\n\r\nTime: {$a['time']}\r\nPC (IP): {$a['ip']}\r\nLogin: " . ($a['user'] !== '' ? $a['user'] : '—') . "\r\nDetail: " . ($a['detail'] !== '' ? $a['detail'] : '—')
                . "\r\nBrowser / program: " . ($a['ua'] !== '' ? $a['ua'] : '—') . "\r\n\r\nSetup → Security shows every alert and can block the PC.\r\n";
            try { mail_send($m, $sub, $body); } catch (Throwable $e) { /* the alert is kept even when the mail fails */ }
        }
    } catch (Throwable $e) { /* an alert never breaks a request */ }
}

function alert_list(): array { return array_reverse((array)(store_file_read('security_alerts', ['list' => []])['list'] ?? [])); }

function alert_mark_read(array $ids, bool $all = false): void
{
    $lock = store_lock('security_alerts');
    try {
        $l = (array)(store_file_read('security_alerts', ['list' => []])['list'] ?? []);
        foreach ($l as &$a) if ($all || in_array($a['id'] ?? '', $ids, true)) $a['read'] = true;
        unset($a);
        store_file_write('security_alerts', ['list' => $l]);
    } finally { store_unlock($lock); }
}

/* ───────────── e-mail (SMTP) ───────────── */

/** the mail settings with the password decrypted (null when none) */
function mail_conf(): array
{
    $d = store_file_read('security_mail', []);
    $d['pass'] = isset($d['pass_enc']) ? mail_dec((string)$d['pass_enc']) : null;
    unset($d['pass_enc']);
    return $d;
}

/** the settings for the screen: never the password, only whether one is kept */
function mail_public(): array
{
    $d = store_file_read('security_mail', []);
    return ['on' => !empty($d['on']), 'host' => (string)($d['host'] ?? ''), 'port' => (int)($d['port'] ?? 587), 'secure' => (string)($d['secure'] ?? 'tls'),
        'user' => (string)($d['user'] ?? ''), 'from' => (string)($d['from'] ?? ''), 'to' => array_values((array)($d['to'] ?? [])), 'hasPass' => !empty($d['pass_enc'])];
}

function mail_save(array $in): array
{
    $old = store_file_read('security_mail', []);
    $to = array_values(array_slice(array_filter(array_map('trim', (array)($in['to'] ?? [])), fn($x) => filter_var($x, FILTER_VALIDATE_EMAIL)), 0, 10));
    $from = trim((string)($in['from'] ?? ''));
    $host = trim((string)($in['host'] ?? ''));
    if ($host !== '' && !preg_match('/^[A-Za-z0-9.-]{1,120}$/', $host)) throw new InvalidArgumentException('The mail server name is not valid.');
    if ($from !== '' && !filter_var($from, FILTER_VALIDATE_EMAIL)) throw new InvalidArgumentException('"From" must be an e-mail address.');
    $secure = in_array($in['secure'] ?? '', ['tls', 'ssl', 'none'], true) ? $in['secure'] : 'tls';
    $d = ['on' => !empty($in['on']), 'host' => $host, 'port' => max(1, min(65535, (int)($in['port'] ?? 587))), 'secure' => $secure,
        'user' => mb_substr(trim((string)($in['user'] ?? '')), 0, 120), 'from' => $from, 'to' => $to];
    if (array_key_exists('pass', $in) && $in['pass'] !== null && $in['pass'] !== '') $d['pass_enc'] = mail_enc((string)$in['pass']);
    elseif (empty($in['clearPass']) && isset($old['pass_enc'])) $d['pass_enc'] = $old['pass_enc'];
    if ($d['on'] && ($d['host'] === '' || !$d['to'] || $d['from'] === '')) throw new InvalidArgumentException('Mail server, "from" and at least one "to" address are needed to switch the e-mail on.');
    $lock = store_lock('security_mail');
    try { store_file_write('security_mail', $d); } finally { store_unlock($lock); }
    return mail_public();
}

function mail_key(): string { return hash('sha256', 'ems-mail|' . auth_secret(), true); }
function mail_enc(string $p): string
{
    $iv = random_bytes(12); $tag = '';
    $c = openssl_encrypt($p, 'aes-256-gcm', mail_key(), OPENSSL_RAW_DATA, $iv, $tag);
    return base64_encode($iv . $tag . $c);
}
function mail_dec(string $s): ?string
{
    $b = base64_decode($s, true);
    if ($b === false || strlen($b) < 29) return null;
    $p = openssl_decrypt(substr($b, 28), 'aes-256-gcm', mail_key(), OPENSSL_RAW_DATA, substr($b, 0, 12), substr($b, 12, 16));
    return $p === false ? null : $p;
}

/** send one plain-text mail through the plant's SMTP server (5 s timeouts). Throws RuntimeException with the reason. */
function mail_send(array $m, string $subject, string $body): void
{
    $host = (string)($m['host'] ?? ''); $port = (int)($m['port'] ?? 587); $secure = (string)($m['secure'] ?? 'tls');
    $to = (array)($m['to'] ?? []); $from = (string)($m['from'] ?? '');
    if ($host === '' || !$to || $from === '') throw new RuntimeException('E-mail is not set up');
    $errno = 0; $errstr = '';
    $s = @stream_socket_client(($secure === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port, $errno, $errstr, 5);
    if (!$s) throw new RuntimeException("Cannot reach the mail server $host:$port ($errstr)");
    stream_set_timeout($s, 5);
    $read = function () use ($s): string { $r = ''; while (($l = fgets($s, 1024)) !== false) { $r .= $l; if (strlen($l) < 4 || $l[3] === ' ') break; } return $r; };
    $cmd = function (string $c, array $ok) use ($s, $read): string { if ($c !== '') fwrite($s, $c . "\r\n"); $r = $read(); if (!in_array((int)substr($r, 0, 3), $ok, true)) throw new RuntimeException('Mail server: ' . trim(preg_replace('/\s+/', ' ', $r)) ?: 'no answer'); return $r; };
    try {
        $cmd('', [220]);
        $me = gethostname() ?: 'linepulse';
        $cmd("EHLO $me", [250]);
        if ($secure === 'tls') {
            $cmd('STARTTLS', [220]);
            if (!stream_socket_enable_crypto($s, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) throw new RuntimeException('TLS with the mail server failed');
            $cmd("EHLO $me", [250]);
        }
        if (($m['user'] ?? '') !== '') {
            $cmd('AUTH LOGIN', [334]);
            $cmd(base64_encode((string)$m['user']), [334]);
            $cmd(base64_encode((string)($m['pass'] ?? '')), [235]);
        }
        $cmd("MAIL FROM:<$from>", [250]);
        foreach ($to as $t) $cmd("RCPT TO:<$t>", [250, 251]);
        $cmd('DATA', [354]);
        $head = 'From: Line Pulse <' . $from . ">\r\nTo: " . implode(', ', $to) . "\r\nSubject: =?UTF-8?B?" . base64_encode($subject) . "?=\r\nDate: " . date('r')
            . "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n";
        $text = preg_replace('/^\./m', '..', str_replace(["\r\n", "\n"], ["\n", "\r\n"], $body));
        $cmd($head . $text . "\r\n.", [250]);
        $cmd('QUIT', [221]);
    } finally { fclose($s); }
}
