<?php
/**
 * Software ki ghadi = line database (SQL Server GETDATE()) ka time, is PC ka nahi.
 * Is PC ki Windows ghadi galat ho sakti hai, isliye "aaj" / "abhi" yahin se lo:
 *   ems_today()  'Y-m-d'          ems_now()  'Y-m-d H:i:s'          ems_time()  unix seconds
 *
 * Kaise: db_now() (config/db.php) se DB ka time padha jaata hai — sirf SELECT GETDATE(), kuch likha nahi jaata.
 * Farq (DB − PC, seconds) temp folder mein rakha jaata hai aur 15 min tak wahi chalta hai, isliye har request
 * pe database nahi khulta. DB na mile to pichhla farq chalta hai (pehli baar: 0 = PC ka time) aur 1 min baad phir koshish.
 * Jo page db.php load nahi karta (losses, settings) wo bhi rakha hua farq use karta hai.
 */

// Software ka time zone India (IST). Is XAMPP ke php.ini mein Europe/Berlin likha hai: usse har save hua time
// 4 ghante 30 minute peeche likha jaata tha, raat 00:00–04:30 tak "aaj" pichhla din aata tha, aur DB ki ghadi se
// milaan (neeche) hamesha "bahut farq" maan ke band ho jaata tha.
date_default_timezone_set('Asia/Kolkata');

const EMS_CLOCK_TTL = 15 * 60;    // kitni der baad DB se dobara milaana hai
const EMS_CLOCK_RETRY = 60;       // DB na mile to itni der baad phir
/**
 * DB aur PC ka farq isse zyada ho (galat DATE / ghanton ka farq) to DB ki ghadi par bharosa nahi: kisi line PC ki ghadi
 * galat set hai (jaise 27-10 dikha rahi thi jab asal mein 13-11 tha). Tab PC ka time chalta hai — warna "aaj",
 * "kal" aur date picker sab galat din pe atak jaate hain. Kuch minute ka farq (PC ki ghadi thodi galat) DB se hi theek hota hai.
 */
const EMS_CLOCK_MAX_SKEW = 2 * 3600;

function ems_clock_file(): string
{
    return $GLOBALS['EMS_CLOCK_FILE'] ?? sys_get_temp_dir() . '/ems_clock_offset.json';   // tests use their own file
}

/** Seconds to add to this PC's time() to get the database's time. */
function ems_clock_offset(bool $fresh = false): int
{
    static $off = null;
    if ($off !== null && !$fresh) return $off;
    $f = ems_clock_file();
    $j = is_file($f) ? json_decode((string)@file_get_contents($f), true) : null;
    $saved = (is_array($j) && isset($j['off'])) ? (int)$j['off'] : 0;
    $next = (is_array($j) && isset($j['next'])) ? (int)$j['next'] : 0;
    // still fresh, or no way to ask the database from this page: use what is saved
    if (abs($saved) > EMS_CLOCK_MAX_SKEW) $saved = 0;   // a wrong line clock saved by an older version: not used
    if ((!$fresh && $next > time() && $next - time() <= EMS_CLOCK_TTL) || !function_exists('db_now')) return $off = $saved;

    $off = $saved; $ok = false;
    try {
        $src = null;
        $s = db_now($src);
        $t = (is_string($s) && preg_match('/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d/', $s)) ? strtotime(substr($s, 0, 19)) : false;
        if ($t !== false) {
            $raw = $t - time();
            $off = abs($raw) > EMS_CLOCK_MAX_SKEW ? 0 : $raw;   // a line server with a wrong date / hour: use this PC's clock
            $ok = true;
        }
    } catch (Throwable $e) { /* database not reachable: keep the saved difference */ }
    @file_put_contents($f, json_encode(['off' => $off, 'next' => time() + ($ok ? EMS_CLOCK_TTL : EMS_CLOCK_RETRY),
                                        'checkedAt' => date('Y-m-d H:i:s', time() + $off), 'ok' => $ok]), LOCK_EX);
    return $off;
}

function ems_time(): int { return time() + ems_clock_offset(); }
function ems_today(): string { return date('Y-m-d', ems_time()); }
function ems_now(): string { return date('Y-m-d H:i:s', ems_time()); }
function ems_iso(): string { return date('c', ems_time()); }
