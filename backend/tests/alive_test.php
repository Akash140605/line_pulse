<?php
// 26-11-2026: a dead pooled connection (08S02 "Physical connection is not usable") is opened again once; other errors are left alone
$GLOBALS['EMS_ERR_DIR'] = sys_get_temp_dir() . '/alive_' . getmypid(); @mkdir($GLOBALS['EMS_ERR_DIR']);
require_once __DIR__ . '/../lib/snapshot.php';
require_once __DIR__ . '/../lib/cache.php';
class DeadPdo extends PDO {
    public function __construct(private string $msg) { parent::__construct('sqlite::memory:'); $this->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); }
    public function query(string $q, ?int $m = null, mixed ...$a): PDOStatement|false { throw new PDOException($this->msg); }
}
$ok = true; $chk = function ($c, $t) use (&$ok) { echo ($c ? 'ok   ' : 'FAIL ') . $t . "\n"; if (!$c) $ok = false; };
$n = 0;
$p = snap_alive(function () use (&$n) { $n++; return $n === 1 ? new DeadPdo('SQLSTATE[08S02]: [Microsoft][ODBC Driver 17 for SQL Server]SMux Provider: Physical connection is not usable [xFFFFFFFF].') : new PDO('sqlite::memory:'); }, 25);
$chk($n === 2 && !($p instanceof DeadPdo), 'dead connection: connected again (2 connects)');
$chk((int)$p->query('SELECT 1')->fetchColumn() === 1, 'the new connection answers');
$chk(str_contains((string)@file_get_contents($GLOBALS['EMS_ERR_DIR'] . '/ems_api_errors.log'), 'dead connection, connected again'), 'noted in the error log');
$n = 0;
$p = snap_alive(function () use (&$n) { $n++; return new DeadPdo("SQLSTATE[42S02]: Invalid object name 'x'"); }, 25);
$chk($n === 1 && $p instanceof DeadPdo, 'other error: no second connect (the real query reports it)');
$n = 0;
$p = snap_alive(function () use (&$n) { $n++; return new PDO('sqlite::memory:'); }, 25);
$chk($n === 1, 'good connection: one connect');
$chk(snap_is_offline_error('SQLSTATE[08S02]: SMux Provider: Physical connection is not usable'), '08S02 counts as offline (last good answer shown)');
$chk(!snap_is_offline_error("SQLSTATE[42S02]: Invalid object name"), 'a query mistake is not offline');
array_map('unlink', glob($GLOBALS['EMS_ERR_DIR'] . '/*') ?: []); @rmdir($GLOBALS['EMS_ERR_DIR']);
echo $ok ? "ALL OK\n" : "FAILED\n";
