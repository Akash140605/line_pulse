<?php
// php backend/tests/files_test.php — RCA evidence and profile pictures (api/files.php, ole_evidence of api/ole.php), without a server.
declare(strict_types=1);
$GLOBALS['FILES_TEST'] = true;
$GLOBALS['EMS_STORE_DIR'] = sys_get_temp_dir() . '/ems_files_test_' . getmypid();
@mkdir($GLOBALS['EMS_STORE_DIR'], 0775, true);
require __DIR__ . '/../api/files.php';
$fail = 0;
function ok(string $t, bool $c) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $t . "\n"; if (!$c) $fail++; }

ok('a JPG is a JPG', files_magic_ok('jpg', "\xFF\xD8\xFF\xE0rest"));
ok('a program renamed to .jpg is refused', !files_magic_ok('jpg', "MZ\x90\x00"));
ok('PDF, xlsx (zip), old xls', files_magic_ok('pdf', '%PDF-1.7') && files_magic_ok('xlsx', "PK\x03\x04..") && files_magic_ok('xls', "\xD0\xCF\x11\xE0...."));
ok('a text file with a NUL byte is refused', !files_magic_ok('txt', "abc\0def") && files_magic_ok('csv', "a,b\n1,2"));
ok('unknown extension refused', !files_magic_ok('exe', 'MZ') && !isset(FILES_TYPES['exe']) && !isset(FILES_TYPES['html']) && !isset(FILES_TYPES['svg']));
ok('file name: no path, no markup characters', files_name('C:\\x\\Tub <leak>|"2".jpg') === 'Tub leak2.jpg' && files_name('../../etc/a.pdf') === 'a.pdf');
ok('file name cut to 80', mb_strlen(files_name(str_repeat('a', 200) . '.pdf')) === 80);
ok('base64 with a data: prefix', files_b64('data:image/png;base64,' . base64_encode('hi')) === 'hi' && files_b64('***') === null);
$id = files_keep('hello', 'txt');
ok('a kept file gets a 24-hex id and is on disk', preg_match('/^[a-f0-9]{24}$/', $id) === 1 && file_get_contents(files_dir() . "/$id.txt") === 'hello');
ok('presets are short pictures', count(AVATAR_PRESETS) >= 12 && max(array_map('mb_strlen', AVATAR_PRESETS)) <= 4);

// ole_evidence of ole.php
$src = file_get_contents(__DIR__ . '/../api/ole.php');
$a = strpos($src, '/** RCA evidence:'); $b = strpos($src, '/** One entry, cleaned');
eval(substr($src, $a, $b - $a));
$files = ['aaaaaaaaaaaaaaaaaaaaaaaa' => ['name' => 'tub.jpg', 'ext' => 'jpg', 'size' => 10, 'for' => 'rca'],
          'bbbbbbbbbbbbbbbbbbbbbbbb' => ['name' => 'me.jpg', 'ext' => 'jpg', 'size' => 5, 'for' => 'avatar'],
          'cccccccccccccccccccccccc' => ['name' => '5why.xlsx', 'ext' => 'xlsx', 'size' => 99, 'for' => 'rca']];
$e = ole_evidence([['id' => 'aaaaaaaaaaaaaaaaaaaaaaaa', 'name' => 'renamed <x>'], 'cccccccccccccccccccccccc', ['id' => 'bbbbbbbbbbbbbbbbbbbbbbbb'], ['id' => 'dddddddddddddddddddddddd'], ['id' => 'aaaaaaaaaaaaaaaaaaaaaaaa'], ['id' => '../../x']], $files);
ok('evidence: only RCA uploads, once each, name from the server', count($e) === 2 && $e[0] === ['id' => 'aaaaaaaaaaaaaaaaaaaaaaaa', 'name' => 'tub.jpg', 'type' => 'image/jpeg', 'size' => 10] && $e[1]['type'] === 'file');
$many = []; for ($i = 0; $i < 15; $i++) { $k = str_pad(dechex($i), 24, 'e', STR_PAD_LEFT); $files[$k] = ['name' => "p$i.png", 'ext' => 'png', 'size' => 1, 'for' => 'rca']; $many[] = $k; }
ok('evidence: at most 10', count(ole_evidence($many, $files)) === 10);

array_map('unlink', glob(files_dir() . '/*')); @rmdir(files_dir()); @rmdir($GLOBALS['EMS_STORE_DIR']);
echo $fail ? "FAILED $fail\n" : "ALL OK\n";
exit($fail ? 1 : 0);
