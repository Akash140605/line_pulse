#!/usr/bin/env bash
# One command to check everything. Needs: php-cli, node 18+.
# Every test is offline: no database is opened, and the temporary files are removed by the tests.
set -e
cd "$(dirname "$0")"
echo "== PHP: aggregation maths ==";                             php backend/tests/cube_test.php | tail -1
echo "== PHP: analytics maths ==";                               php backend/tests/analytics_test.php | tail -1
echo "== PHP: outlier rule ==";                                  php backend/tests/outlier_test.php | tail -1
echo "== PHP: live board engine ==";                             php backend/tests/live_test.php | tail -1
echo "== PHP: ScanId binary search ==";                          php backend/tests/scanid_test.php | tail -1
echo "== PHP: connection policy ==";                             php backend/tests/connect_test.php | tail -1
echo "== PHP: offline backup fallback ==";                       php backend/tests/backup_test.php | tail -1
echo "== PHP: backup copy (mirror) ==";                          php backend/tests/mirror_test.php | tail -1
echo "== PHP: last good copy of a line ==";                      php backend/tests/snapshot_test.php | tail -1
echo "== PHP: newer last read vs an old backup ==";              php backend/tests/snapshot_newer_test.php | tail -1
echo "== PHP: cache of backup answers ==";                       php backend/tests/cache_backup_test.php | tail -1
echo "== PHP: line server clock check ==";                       php backend/tests/clock_test.php | tail -1
echo "== PHP: targets, shift and loss register store ==";        php backend/tests/store_test.php | tail -1
echo "== PHP: live databases are never written ==";              php backend/tests/readonly_test.php | tail -1
echo "== PHP: login, passwords, throttle ==";                    php backend/tests/auth_test.php | tail -1
echo "== PHP: screen setup and OLE formula settings ==";         php backend/tests/ui_test.php | tail -1
echo "== PHP: loss / quality / morning entries ==";              php backend/tests/ole_test.php | tail -1
echo "== PHP: who may save loss / quality / morning ==";              php backend/tests/ole_access_test.php | tail -1
echo "== PHP: bad input gives 400 ==";                           php backend/tests/input_test.php | tail -1
cd frontend
echo "== JS: every frontend calculation ==";                     node tests/run-calc.mjs | tail -1
echo "== build ==";                                              npx vite build 2>&1 | grep -E "✓ built|rror"
