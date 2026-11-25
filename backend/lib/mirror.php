<?php
/**
 * Local backup copy of every line database (this PC's SQL Server, Windows login, database EMS_Backup_Line<N>).
 *
 * The line servers are only READ, in small pieces along their clustered key, so production is not slowed down:
 *   - tables with one numeric key (ScanStatus.ScanId, Tab_FalseScan.FSId …): only rows newer than the local copy
 *     are copied, 5 000 at a time — the first run copies everything, later runs only the new scans;
 *   - small tables without such a key (models, companies …): copied again completely on each sync.
 * Progress per table is kept in dbo._MirrorState of the local database.
 */

const MIRROR_LOCAL_SERVER = 'localhost';
const MIRROR_DB_PREFIX = 'EMS_Backup_Line';
const MIRROR_CHUNK = 5000;              // rows read from the line server per query
const MIRROR_FULL_COPY_MAX = 300000;    // tables without a numeric key larger than this are skipped (would be too heavy to re-copy)

function mirror_db_name(int $line): string { return MIRROR_DB_PREFIX . $line; }

/**
 * One copy run per line at a time (the scheduled task and a manual run could otherwise copy the same rows twice).
 * Returns the open lock file, or null when another run holds the lock. The lock ends with the request
 * (or with mirror_unlock); a crashed run leaves no stale lock, because the operating system releases it.
 */
function mirror_lock(int $line, ?string $dir = null)
{
    $f = @fopen(($dir ?? sys_get_temp_dir()) . '/ems_mirror_line' . $line . '.lock', 'c');
    if (!$f) return null;
    if (!flock($f, LOCK_EX | LOCK_NB)) { fclose($f); return null; }
    return $f;
}
function mirror_unlock($f): void { if ($f) { flock($f, LOCK_UN); fclose($f); } }
function mirror_q(string $name): string { return '[' . str_replace(']', ']]', $name) . ']'; }

/** SQL type text from sys.columns metadata. */
function mirror_col_type(array $c): string
{
    $t = strtolower($c['type']);
    $len = (int)$c['max_length'];
    switch ($t) {
        case 'varchar': case 'char': case 'varbinary': case 'binary':
            return $t . '(' . ($len < 0 ? 'max' : $len) . ')';
        case 'nvarchar': case 'nchar':
            return $t . '(' . ($len < 0 ? 'max' : intdiv($len, 2)) . ')';
        case 'numeric': case 'decimal':
            return $t . '(' . (int)$c['precision'] . ',' . (int)$c['scale'] . ')';
        case 'datetime2': case 'time': case 'datetimeoffset':
            return $t . '(' . (int)$c['scale'] . ')';
        case 'float':
            return 'float';
        case 'int': case 'bigint': case 'smallint': case 'tinyint': case 'bit': case 'datetime': case 'smalldatetime':
        case 'date': case 'real': case 'money': case 'smallmoney': case 'uniqueidentifier': case 'text': case 'ntext': case 'image': case 'xml':
            return $t;
    }
    return 'nvarchar(max)';
}

function mirror_create_sql(string $schema, string $table, array $cols, array $pk): string
{
    $lines = [];
    foreach ($cols as $c) $lines[] = '  ' . mirror_q($c['name']) . ' ' . mirror_col_type($c) . ((int)$c['is_nullable'] ? ' NULL' : ' NOT NULL');
    if ($pk) $lines[] = '  PRIMARY KEY CLUSTERED (' . implode(', ', array_map('mirror_q', $pk)) . ')';
    $full = mirror_q($schema) . '.' . mirror_q($table);
    return "IF OBJECT_ID(N'$full') IS NULL CREATE TABLE $full (\n" . implode(",\n", $lines) . "\n)";
}

/** Rows per INSERT: at most 2 000 parameters (SQL Server allows 2 100) and 1 000 rows. */
function mirror_batch_rows(int $columns): int
{
    return max(1, min(1000, intdiv(2030, max(1, $columns))));
}

function mirror_insert_sql(string $schema, string $table, array $colNames, int $rows): string
{
    $one = '(' . implode(',', array_fill(0, count($colNames), '?')) . ')';
    return 'INSERT INTO ' . mirror_q($schema) . '.' . mirror_q($table) . ' (' . implode(',', array_map('mirror_q', $colNames)) . ') VALUES ' . implode(',', array_fill(0, $rows, $one));
}

function mirror_can_chunk(array $cols, array $pk): bool
{
    if (count($pk) !== 1) return false;
    foreach ($cols as $c) if ($c['name'] === $pk[0]) return in_array(strtolower($c['type']), ['int', 'bigint', 'smallint', 'tinyint', 'numeric', 'decimal'], true);
    return false;
}

/* ─────────────────────────── database side ─────────────────────────── */

function mirror_local(?string $db = null): PDO
{
    $pdo = new PDO('sqlsrv:Server=' . MIRROR_LOCAL_SERVER . ($db ? ';Database=' . $db : '') . ';TrustServerCertificate=true;LoginTimeout=5', null, null,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('SET DATEFORMAT ymd');
    return $pdo;
}

function mirror_ensure_db(int $line): PDO
{
    $db = mirror_db_name($line);
    $m = mirror_local();
    $m->exec("IF DB_ID(N'$db') IS NULL CREATE DATABASE " . mirror_q($db));
    $m->exec('ALTER DATABASE ' . mirror_q($db) . ' SET RECOVERY SIMPLE');
    $l = mirror_local($db);
    $l->exec("IF OBJECT_ID(N'dbo._MirrorState') IS NULL CREATE TABLE dbo._MirrorState (
                TableName nvarchar(256) NOT NULL PRIMARY KEY, Mode varchar(10) NOT NULL, SourceRows bigint NULL, LocalRows bigint NULL,
                LastKey nvarchar(60) NULL, LastSync datetime NOT NULL, LastError nvarchar(400) NULL)");
    return $l;
}

/** User tables of the line database with columns, primary key and row count. */
function mirror_source_tables(PDO $src): array
{
    $tables = $src->query("SELECT s.name AS sch, t.name AS tbl, t.object_id AS oid,
                                  (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS n
                           FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE t.is_ms_shipped = 0 ORDER BY s.name, t.name")->fetchAll(PDO::FETCH_ASSOC);
    $colSt = $src->prepare("SELECT c.name, ty.name AS type, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity
                            FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id WHERE c.object_id = ? ORDER BY c.column_id");
    $pkSt = $src->prepare("SELECT c.name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                           JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                           WHERE i.object_id = ? AND i.is_primary_key = 1 ORDER BY ic.key_ordinal");
    $out = [];
    foreach ($tables as $t) {
        $colSt->execute([$t['oid']]); $cols = $colSt->fetchAll(PDO::FETCH_ASSOC);
        $pkSt->execute([$t['oid']]); $pk = $pkSt->fetchAll(PDO::FETCH_COLUMN);
        $out[] = ['schema' => $t['sch'], 'table' => $t['tbl'], 'rows' => (int)$t['n'], 'cols' => $cols, 'pk' => $pk];
    }
    return $out;
}

function mirror_state(PDO $l, string $name, string $mode, ?int $src, ?int $local, ?string $last, ?string $err): void
{
    $st = $l->prepare("MERGE dbo._MirrorState AS t USING (SELECT ? AS TableName) AS s ON t.TableName = s.TableName
        WHEN MATCHED THEN UPDATE SET Mode = ?, SourceRows = ?, LocalRows = ?, LastKey = ?, LastSync = GETDATE(), LastError = ?
        WHEN NOT MATCHED THEN INSERT (TableName, Mode, SourceRows, LocalRows, LastKey, LastSync, LastError) VALUES (?, ?, ?, ?, ?, GETDATE(), ?);");
    $st->execute([$name, $mode, $src, $local, $last, $err, $name, $mode, $src, $local, $last, $err]);
}

/** Inserts rows (lists of values in column order) in parameter-limited batches. */
function mirror_insert_rows(PDO $l, array $t, array $rows): void
{
    if (!$rows) return;
    $names = array_column($t['cols'], 'name');
    $dt = []; $bin = [];
    foreach ($t['cols'] as $i => $c) {
        $ty = strtolower($c['type']);
        if (in_array($ty, ['datetime', 'datetime2', 'smalldatetime', 'datetimeoffset'], true)) $dt[$i] = true;
        if (in_array($ty, ['varbinary', 'binary', 'image'], true)) $bin[$i] = true;
    }
    $per = mirror_batch_rows(count($names));
    $stCache = [];
    foreach (array_chunk($rows, $per) as $chunk) {
        $n = count($chunk);
        $st = $stCache[$n] ?? ($stCache[$n] = $l->prepare(mirror_insert_sql($t['schema'], $t['table'], $names, $n)));
        $k = 1;
        foreach ($chunk as $r) {
            foreach ($r as $i => $v) {
                if ($v !== null && isset($dt[$i])) $v = str_replace(' ', 'T', (string)$v); // ISO 8601: same meaning in every language setting
                if ($v === null) $st->bindValue($k, null, PDO::PARAM_NULL);
                elseif (isset($bin[$i])) $st->bindValue($k, $v, PDO::PARAM_LOB);
                else $st->bindValue($k, $v);
                $k++;
            }
        }
        $st->execute();
    }
}

/**
 * Copies one table until it is complete or $deadline (microtime) passes.
 * Returns ['table', 'mode', 'source', 'local', 'done', 'copied', 'error'].
 */
function mirror_sync_table(PDO $src, PDO $l, array $t, float $deadline): array
{
    $name = $t['schema'] . '.' . $t['table'];
    $res = ['table' => $name, 'mode' => '', 'source' => $t['rows'], 'local' => null, 'done' => false, 'copied' => 0, 'error' => null];
    $full = mirror_q($t['schema']) . '.' . mirror_q($t['table']);
    $names = implode(',', array_map(fn($c) => 's.' . mirror_q($c['name']), $t['cols']));
    try {
        $l->exec(mirror_create_sql($t['schema'], $t['table'], $t['cols'], $t['pk']));
        if (mirror_can_chunk($t['cols'], $t['pk'])) {
            $res['mode'] = 'new rows';
            $key = mirror_q($t['pk'][0]);
            $st = $src->prepare('SELECT TOP ' . MIRROR_CHUNK . " $names FROM $full s WHERE s.$key > ? ORDER BY s.$key");
            $last = $l->query("SELECT CONVERT(varchar(60), MAX($key)) FROM $full")->fetchColumn();
            $keyIdx = array_search($t['pk'][0], array_column($t['cols'], 'name'), true);
            while (true) {
                $st->execute([$last === null || $last === false ? -1 : $last]);
                $rows = $st->fetchAll(PDO::FETCH_NUM);
                $st->closeCursor();
                if (!$rows) { $res['done'] = true; break; }
                $l->beginTransaction();
                mirror_insert_rows($l, $t, $rows);
                $l->commit();
                $res['copied'] += count($rows);
                $last = (string)$rows[count($rows) - 1][$keyIdx];
                if (count($rows) < MIRROR_CHUNK) { $res['done'] = true; break; }
                if (microtime(true) > $deadline) break;
            }
            $res['local'] = (int)$l->query("SELECT COUNT_BIG(*) FROM $full")->fetchColumn();
            mirror_state($l, $name, $res['mode'], $t['rows'], $res['local'], $last === false ? null : (string)$last, null);
        } elseif ($t['rows'] <= MIRROR_FULL_COPY_MAX) {
            $res['mode'] = 'full copy';
            $rows = $src->query("SELECT $names FROM $full s")->fetchAll(PDO::FETCH_NUM);
            $l->beginTransaction();
            $l->exec("DELETE FROM $full");
            mirror_insert_rows($l, $t, $rows);
            $l->commit();
            $res['copied'] = count($rows); $res['local'] = count($rows); $res['done'] = true;
            mirror_state($l, $name, $res['mode'], $t['rows'], $res['local'], null, null);
        } else {
            $res['mode'] = 'skipped'; $res['done'] = true;
            $res['error'] = "no numeric key and more than " . MIRROR_FULL_COPY_MAX . " rows";
            mirror_state($l, $name, $res['mode'], $t['rows'], null, null, $res['error']);
        }
    } catch (Throwable $e) {
        if ($l->inTransaction()) $l->rollBack();
        $res['error'] = substr($e->getMessage(), 0, 380);
        try { mirror_state($l, $name, $res['mode'] ?: 'error', $t['rows'], null, null, $res['error']); } catch (Throwable $e2) { /* keep the first error */ }
    }
    return $res;
}
