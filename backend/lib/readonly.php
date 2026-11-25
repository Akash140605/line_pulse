<?php
/**
 * The live line databases are READ ONLY for this software. Nothing is ever written to them.
 *
 *   ro_scan_code()     looks through every PHP file of the backend for SQL that changes data or structure
 *                      (INSERT, UPDATE, DELETE, MERGE, TRUNCATE, DROP, ALTER, CREATE, EXEC, GRANT …).
 *                      The only allowed place is lib/mirror.php, and only on the LOCAL backup connection
 *                      ($l / $m = this PC's SQL Server, databases EMS_Backup_Line<N>), never on a line server ($src).
 *                      tests/readonly_test.php fails the build if anything else appears.
 *   ro_login_perms()   asks a line server (read-only query) whether the login this software uses COULD write.
 *                      The code never does, but a login with only read rights makes it impossible, not just unused.
 */

const RO_WRITE_SQL = '/\b(INSERT\s+INTO|UPDATE\s+[\w\[\]\.]+\s+SET|DELETE\s+FROM|MERGE\s+[\w\[\]\.]+|TRUNCATE\s+TABLE|DROP\s+(TABLE|DATABASE|VIEW|PROC|PROCEDURE|INDEX|LOGIN|USER)'
    . '|ALTER\s+(TABLE|DATABASE|VIEW|PROC|PROCEDURE|INDEX|LOGIN|USER|ROLE)|CREATE\s+(TABLE|DATABASE|VIEW|PROC|PROCEDURE|INDEX|LOGIN|USER|TRIGGER)'
    . '|EXEC(UTE)?\s+(sp_|xp_|\[?dbo\]?\.)|sp_executesql|BULK\s+INSERT|GRANT\s+|REVOKE\s+|DENY\s+|SELECT\s+[^;]*?\bINTO\s+[\w\[#])/i';

/** Files allowed to write, with the variables (connections) they may write through: all local, never a line server. */
const RO_ALLOWED = ['lib/mirror.php' => ['$l', '$m', '$pdo->exec(\'SET DATEFORMAT'],
    // the software's own settings database on this PC (EMS_LinePulse_App, lib/appdb.php): its connection is $a (and $m to create it)
    'lib/appdb.php' => ['$a->', '$m->exec']];

/**
 * Returns a list of "file:line" places with data-changing SQL outside the allowed local-backup code.
 * Only file names and line numbers are reported (never the line text: config files hold passwords).
 */
function ro_scan_code(string $root): array
{
    $bad = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if ($f->getExtension() !== 'php') continue;
        $rel = str_replace('\\', '/', substr($f->getPathname(), strlen(rtrim($root, '/\\')) + 1));
        if (strpos($rel, 'tests/') === 0 || $rel === 'lib/readonly.php') continue;   // tests hold sample SQL text; this file holds the pattern
        $allowed = RO_ALLOWED[$rel] ?? null;
        foreach (file($f->getPathname()) as $i => $line) {
            $code = preg_replace('~^\s*(//|\*|/\*|#).*~', '', $line);           // comments may mention words like "insert"
            if (!preg_match(RO_WRITE_SQL, $code)) continue;
            if ($allowed !== null && strpos($code, '$src') === false) {
                $local = false;
                foreach ($allowed as $a) if (strpos($code, $a) !== false) $local = true;
                // a SQL text builder (returns a string, runs nothing) is allowed in mirror.php; its callers are checked above
                if ($local || preg_match('/^\s*return\s/', $code) || preg_match('/WHEN\s+(NOT\s+)?MATCHED/i', $code)) continue;
            }
            $bad[] = $rel . ':' . ($i + 1);
        }
    }
    return $bad;
}

/**
 * Read-only question to a line server: what could the login of this software do?
 * Uses only HAS_PERMS_BY_NAME / IS_ROLEMEMBER / IS_SRVROLEMEMBER (they read rights, they change nothing).
 * Returns ['canWrite' => bool, 'rights' => [names it holds], 'login' => user name].
 */
function ro_login_perms(PDO $pdo): array
{
    $r = $pdo->query("SELECT SUSER_SNAME() AS login,
        HAS_PERMS_BY_NAME('dbo.ScanStatus', 'OBJECT', 'INSERT') AS ins,
        HAS_PERMS_BY_NAME('dbo.ScanStatus', 'OBJECT', 'UPDATE') AS upd,
        HAS_PERMS_BY_NAME('dbo.ScanStatus', 'OBJECT', 'DELETE') AS del,
        HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS crt,
        HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER') AS alt,
        IS_ROLEMEMBER('db_owner') AS own, IS_ROLEMEMBER('db_datawriter') AS dw, IS_SRVROLEMEMBER('sysadmin') AS sa")->fetch(PDO::FETCH_ASSOC);
    $names = ['ins' => 'INSERT', 'upd' => 'UPDATE', 'del' => 'DELETE', 'crt' => 'CREATE TABLE', 'alt' => 'ALTER',
              'own' => 'db_owner', 'dw' => 'db_datawriter', 'sa' => 'sysadmin'];
    $rights = [];
    foreach ($names as $k => $n) if ((int)($r[$k] ?? 0) === 1) $rights[] = $n;
    return ['canWrite' => (bool)$rights, 'rights' => $rights, 'login' => (string)($r['login'] ?? '')];
}
