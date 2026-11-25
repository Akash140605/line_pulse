<?php
/**
 * 24-11-2026: the plant's paper "CORRECTIVE AND PREVENTIVE ACTION PLAN" on an RCA (api/ole.php action rca):
 * equipment, hall no, identification of the problem, correction, the question of each why (the answers stay in whys),
 * target date + responsibility of the corrective and of the preventive action, and the verification of the action.
 */
declare(strict_types=1);

function capa_txt($v, int $max): string { return mb_substr(trim(preg_replace('/[ \t]+/u', ' ', strip_tags((string)($v ?? '')))), 0, $max); }
function capa_date($v): string { $v = (string)($v ?? ''); return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : ''; }

/** the CAPA part of an RCA as sent by the page → clean array (null when nothing was sent: the saved one is kept) */
function capa_clean($c): ?array
{
    if (!is_array($c)) return null;
    $q = array_slice(array_map(fn($w) => capa_txt($w, 300), array_values((array)($c['whyQ'] ?? []))), 0, 5);
    while ($q && end($q) === '') array_pop($q);
    $impl = (string)($c['implemented'] ?? '');
    return [
        'equip' => capa_txt($c['equip'] ?? '', 80),
        'hall' => capa_txt($c['hall'] ?? '', 40),
        'problem' => capa_txt($c['problem'] ?? '', 1000),
        'correction' => capa_txt($c['correction'] ?? '', 1000),
        'whyQ' => $q,
        'caTarget' => capa_date($c['caTarget'] ?? ''),
        'caResp' => capa_txt($c['caResp'] ?? '', 80),
        'paTarget' => capa_date($c['paTarget'] ?? ''),
        'paResp' => capa_txt($c['paResp'] ?? '', 80),
        'implemented' => in_array($impl, ['yes', 'no', 'partly'], true) ? $impl : '',
        'verifiedBy' => capa_txt($c['verifiedBy'] ?? '', 80),
        'verifyDate' => capa_date($c['verifyDate'] ?? ''),
        'verifyNote' => capa_txt($c['verifyNote'] ?? '', 300),
    ];
}

/** the form header (doc no, revision …) kept in the screen setup (lib/ui.php ui_clean → 'capa') */
function capa_head($h): array
{
    $h = is_array($h) ? $h : [];
    $t = function ($v, int $max, string $def): string { $s = capa_txt($v, $max); return $s !== '' ? $s : $def; };
    return [
        'company' => $t($h['company'] ?? '', 80, 'DIXON TECHNOLOGIES INDIA LIMITED'),
        'title' => $t($h['title'] ?? '', 80, 'CORRECTIVE AND PREVENTIVE ACTION PLAN'),
        'docNo' => $t($h['docNo'] ?? '', 40, 'DIXON/MAINT/05/20'),
        'revNo' => $t($h['revNo'] ?? '', 10, '0'),
        'revDate' => $t($h['revDate'] ?? '', 20, '01-01-2020'),
        'hall' => capa_txt($h['hall'] ?? '', 40),
    ];
}
