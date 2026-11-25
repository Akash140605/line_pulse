@echo off
REM One command to check everything on this PC (XAMPP php + node).
REM Every test is offline: no database is opened, and the temporary files are removed by the tests.
cd /d "%~dp0"
set PHP=C:\xampp\php\php.exe
echo == PHP: aggregation maths ==
"%PHP%" backend\tests\cube_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: analytics maths ==
"%PHP%" backend\tests\analytics_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: outlier rule ==
"%PHP%" backend\tests\outlier_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: live board engine ==
"%PHP%" backend\tests\live_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: ScanId binary search ==
"%PHP%" backend\tests\scanid_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: connection policy ==
"%PHP%" backend\tests\connect_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: offline backup fallback ==
"%PHP%" backend\tests\backup_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: backup copy (mirror) ==
"%PHP%" backend\tests\mirror_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: last good copy of a line ==
"%PHP%" backend\tests\snapshot_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: newer last read vs an old backup ==
"%PHP%" backend\tests\snapshot_newer_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: cache of backup answers ==
"%PHP%" backend\tests\cache_backup_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: line server clock check ==
"%PHP%" backend\tests\clock_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: targets, shift and loss register store ==
"%PHP%" backend\tests\store_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: live databases are never written ==
"%PHP%" backend\tests\readonly_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: login, passwords, throttle ==
"%PHP%" backend\tests\auth_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: screen setup and OLE formula settings ==
"%PHP%" backend\tests\ui_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: loss / quality / morning entries ==
"%PHP%" backend\tests\ole_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: who may save loss / quality / morning ==
"%PHP%" backend\tests\ole_access_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == PHP: bad input gives 400 ==
"%PHP%" backend\tests\input_test.php | findstr /I /C:"ALL OK" /C:"FAIL"
echo == JS: every frontend calculation ==
cd frontend
node tests\run-calc.mjs | findstr /C:"passed" /C:"FAIL"
cd ..
pause
