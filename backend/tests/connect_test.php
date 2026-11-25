<?php
/**
 * Unit test for the connection policy in config/db.php (no database needed).
 * A dead line must cost as little time as possible on every poll:
 *   - wrong password (SQLSTATE 28000): never retried, line paused 60 s
 *   - network error that hit the login timeout: not retried (it would only wait again), paused 30 s
 *   - network error that failed fast (< 2 s, e.g. a dropped packet): one immediate retry, paused 30 s if it fails again
 * Run:  php tests/connect_test.php
 */
require_once __DIR__ . '/../config/db.php';
$fail = 0;
function ok($n, $a, $b) { global $fail; if ($a !== $b) { $fail++; echo "FAIL $n: got " . json_encode($a) . " expected " . json_encode($b) . "\n"; } else echo "ok   $n\n"; }

$login = "SQLSTATE[28000]: [Microsoft][ODBC Driver 17 for SQL Server][SQL Server]Login failed for user 'X'.";
$net   = 'SQLSTATE[08001]: [Microsoft][ODBC Driver 17 for SQL Server]Named Pipes Provider: Could not open a connection to SQL Server [1326].';
$tout  = 'SQLSTATE[HYT00]: [Microsoft][ODBC Driver 17 for SQL Server]Login timeout expired';

ok('wrong password: no retry', connect_should_retry($login, 0.05), false);
ok('fast network error: retry once', connect_should_retry($net, 0.3), true);
ok('network error after the full timeout: no retry', connect_should_retry($net, 4.1), false);
ok('login timeout: no retry', connect_should_retry($tout, 4.0), false);
ok('wrong password: paused 60 s', connect_pause_seconds($login), 60);
ok('network down: paused 30 s', connect_pause_seconds($net), 30);
ok('timeout: paused 30 s', connect_pause_seconds($tout), 30);
ok('login timeout setting is short (LAN connects in ~1 s)', CONNECT_LOGIN_TIMEOUT <= 4, true);
// an offline server without "tcp:" made the driver also try Named Pipes: 23 s instead of the 4 s login timeout (measured on Line 1)
ok('plain host gets tcp: (no slow Named Pipes fallback)', connect_server('192.168.2.220'), 'tcp:192.168.2.220');
ok('host with port keeps the port', connect_server(' 192.168.2.8,1433 '), 'tcp:192.168.2.8,1433');
ok('named instance works over tcp too', connect_server('SRV\\SQLEXPRESS'), 'tcp:SRV\\SQLEXPRESS');
ok('an explicit protocol is kept', [connect_server('tcp:10.0.0.1'), connect_server('np:SRV'), connect_server('lpc:.')], ['tcp:10.0.0.1', 'np:SRV', 'lpc:.']);

echo $fail ? "\n$fail FAILED\n" : "\nALL OK\n";
exit($fail ? 1 : 0);
