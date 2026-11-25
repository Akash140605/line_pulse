<?php
/**
 * The software's OWN settings in SQL Server (19-11-2026) — model master, line settings, loss reasons and OLE entries,
 * RCA, users (password hashes only), the screen setup. NOT production data.
 *
 *   Server   : this PC's SQL Server (localhost, Windows login of the web server — the same way as the local backup copy)
 *   Database : EMS_LinePulse_App — its own database, created here when it is missing. A line database is never used.
 *   Tables   : dbo.AppStore        one row per store (Name = 'model_master', 'line_settings', …; Doc = the JSON)
 *              dbo.AppStoreHistory  the earlier versions of every store (last APPDB_KEEP), to see or bring back a change
 *
 * lib/store.php keeps working the same: store_read / store_update go to this database when it answers, and every save
 * is also written to backend/data/<name>.json (a copy that keeps the screens going while SQL Server is down). A save made
 * while SQL Server was down is marked (<name>.pending) and copied into the database as soon as it answers again.
 */
declare(strict_types=1);

const APPDB_SERVER = 'localhost';
const APPDB_NAME = 'EMS_LinePulse_App';
const APPDB_KEEP = 30;          // earlier versions kept per store
const APPDB_DOWN_SECONDS = 60;  // SQL Server not answering: JSON files for a minute, then try again

/** Is the settings database in use at all (not switched off)? A save while it is down is then marked for copying. */
function appdb_configured(): bool { return ($GLOBALS['EMS_APPDB_OFF'] ?? false) !== true && (isset($GLOBALS['EMS_APPDB_DSN']) || extension_loaded('pdo_sqlsrv')); }

function appdb_down_file(): string { return $GLOBALS['EMS_APPDB_DOWN_FILE'] ?? sys_get_temp_dir() . '/ems_appdb_down.json'; }

/** sqlsrv (the plant) or sqlite (tests on a PC without SQL Server) */
function appdb_driver(PDO $a): string { return $a->getAttribute(PDO::ATTR_DRIVER_NAME); }

/** The connection, or null (switched off, or SQL Server not answering — then the JSON files are used). */
function appdb(): ?PDO
{
    static $a = false;
    if ($a !== false) return $a;
    $a = null;
    if (($GLOBALS['EMS_APPDB_OFF'] ?? false) === true) return null;
    $down = @json_decode((string)@file_get_contents(appdb_down_file()), true);
    if (is_array($down) && ($down['until'] ?? 0) > time()) return null;
    try {
        $dsn = $GLOBALS['EMS_APPDB_DSN'] ?? null;   // tests: sqlite::memory: / a file
        if ($dsn) {
            $a = new PDO($dsn, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        } else {
            if (!extension_loaded('pdo_sqlsrv')) return null;
            $m = new PDO('sqlsrv:Server=' . APPDB_SERVER . ';TrustServerCertificate=true;LoginTimeout=3', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $m->exec("IF DB_ID(N'" . APPDB_NAME . "') IS NULL CREATE DATABASE [" . APPDB_NAME . "]");
            $m = null;
            $a = new PDO('sqlsrv:Server=' . APPDB_SERVER . ';Database=' . APPDB_NAME . ';TrustServerCertificate=true;LoginTimeout=3', null, null,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::SQLSRV_ATTR_ENCODING => PDO::SQLSRV_ENCODING_UTF8]);
        }
        appdb_tables($a);
        @unlink(appdb_down_file());
        return $a;
    } catch (Throwable $e) {
        $a = null;
        @file_put_contents(appdb_down_file(), json_encode(['until' => time() + APPDB_DOWN_SECONDS, 'error' => substr(preg_replace('/(pwd|password)=[^;]*/i', '$1=***', $e->getMessage()), 0, 300)]), LOCK_EX);
        return null;
    }
}

function appdb_tables(PDO $a): void
{
    if (appdb_driver($a) === 'sqlite') {
        $a->exec('CREATE TABLE IF NOT EXISTS AppStore (Name TEXT PRIMARY KEY, Doc TEXT NOT NULL, Rev INTEGER NOT NULL, UpdatedAt TEXT NOT NULL)');
        $a->exec('CREATE TABLE IF NOT EXISTS AppStoreHistory (Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL, Rev INTEGER NOT NULL, Doc TEXT NOT NULL, SavedAt TEXT NOT NULL)');
        return;
    }
    $a->exec("IF OBJECT_ID(N'dbo.AppStore') IS NULL CREATE TABLE dbo.AppStore (
                Name nvarchar(64) NOT NULL PRIMARY KEY, Doc nvarchar(max) NOT NULL, Rev int NOT NULL,
                UpdatedAt datetime2(0) NOT NULL CONSTRAINT DF_AppStore_UpdatedAt DEFAULT SYSDATETIME())");
    $a->exec("IF OBJECT_ID(N'dbo.AppStoreHistory') IS NULL CREATE TABLE dbo.AppStoreHistory (
                Id bigint IDENTITY(1,1) NOT NULL PRIMARY KEY, Name nvarchar(64) NOT NULL, Rev int NOT NULL, Doc nvarchar(max) NOT NULL,
                SavedAt datetime2(0) NOT NULL CONSTRAINT DF_AppStoreHistory_SavedAt DEFAULT SYSDATETIME())");
    $a->exec("IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AppStoreHistory_Name') CREATE INDEX IX_AppStoreHistory_Name ON dbo.AppStoreHistory (Name, Id)");
}

function appdb_now(): string { return date('Y-m-d H:i:s'); }

/** The saved document of a store: ['doc' => array, 'rev' => int] or null when the store has no row yet. */
function appdb_get(PDO $a, string $name, bool $lock = false): ?array
{
    $sql = appdb_driver($a) === 'sqlite' ? 'SELECT Doc, Rev FROM AppStore WHERE Name = ?'
        : 'SELECT Doc, Rev FROM dbo.AppStore' . ($lock ? ' WITH (UPDLOCK, HOLDLOCK)' : '') . ' WHERE Name = ?';
    $st = $a->prepare($sql);
    $st->execute([$name]);
    $r = $st->fetch(PDO::FETCH_NUM);
    if (!$r) return null;
    $j = json_decode((string)$r[0], true);
    return ['doc' => is_array($j) ? $j : [], 'rev' => (int)$r[1]];
}

/** Write a store's new document (inside the caller's transaction); the earlier one goes to the history. */
function appdb_put(PDO $a, string $name, array $doc, ?array $old): int
{
    $json = json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    $t = appdb_driver($a) === 'sqlite' ? '' : 'dbo.';
    $now = appdb_now();
    if ($old) {
        $a->prepare("INSERT INTO {$t}AppStoreHistory (Name, Rev, Doc, SavedAt) VALUES (?, ?, ?, ?)")
          ->execute([$name, $old['rev'], json_encode($old['doc'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE), $now]);
        $rev = $old['rev'] + 1;
        $a->prepare("UPDATE {$t}AppStore SET Doc = ?, Rev = ?, UpdatedAt = ? WHERE Name = ?")->execute([$json, $rev, $now, $name]);
        // only the last APPDB_KEEP versions are kept
        $a->prepare("DELETE FROM {$t}AppStoreHistory WHERE Name = ? AND Id NOT IN (SELECT Id FROM (SELECT Id FROM {$t}AppStoreHistory WHERE Name = ? ORDER BY Id DESC "
            . (appdb_driver($a) === 'sqlite' ? 'LIMIT ' . APPDB_KEEP : 'OFFSET 0 ROWS FETCH NEXT ' . APPDB_KEEP . ' ROWS ONLY') . ') k)')->execute([$name, $name]);
        return $rev;
    }
    $a->prepare("INSERT INTO {$t}AppStore (Name, Doc, Rev, UpdatedAt) VALUES (?, ?, 1, ?)")->execute([$name, $json, $now]);
    return 1;
}

function appdb_begin(PDO $a): void { if (appdb_driver($a) === 'sqlite') $a->exec('BEGIN IMMEDIATE'); else $a->beginTransaction(); }
function appdb_commit(PDO $a): void { if (appdb_driver($a) === 'sqlite') $a->exec('COMMIT'); else $a->commit(); }
function appdb_rollback(PDO $a): void { try { if (appdb_driver($a) === 'sqlite') $a->exec('ROLLBACK'); elseif ($a->inTransaction()) $a->rollBack(); } catch (Throwable $e) { /* already ended */ } }

/** What the settings are kept in (admin's diagnostics). Never shows a password. */
function appdb_info(): array
{
    $a = appdb();
    if (!$a) {
        $down = @json_decode((string)@file_get_contents(appdb_down_file()), true);
        return ['store' => 'json', 'database' => null, 'note' => is_array($down) ? ('SQL Server not answering: ' . ($down['error'] ?? '')) : 'switched off'];
    }
    $t = appdb_driver($a) === 'sqlite' ? '' : 'dbo.';
    $rows = $a->query("SELECT Name, Rev, UpdatedAt FROM {$t}AppStore ORDER BY Name")->fetchAll(PDO::FETCH_ASSOC);
    return ['store' => appdb_driver($a), 'database' => appdb_driver($a) === 'sqlsrv' ? APPDB_SERVER . ' / ' . APPDB_NAME : 'test', 'stores' => $rows];
}
