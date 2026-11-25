<?php
require __DIR__.'/../lib/cube.php';
function row($d,$h,$m,$q,$cs,$cc,$min,$max,$oc=0,$os=0){return ['D'=>$d,'H'=>$h,'MMId'=>$m,'Model'=>"M$m",'ModelCode'=>"c$m",'CompanyTitle'=>'X','Qty'=>$q,'CycSum'=>(float)$cs,'CycCnt'=>$cc,'CycMin'=>$min,'CycMax'=>$max,'OutCnt'=>$oc,'OutSec'=>(float)$os];}
$rows=[ row('2026-10-01',9,1,10,400,9,30,60,1,3000), row('2026-10-01',9,2,3,600,2,200,400), row('2026-10-01',10,1,20,700,19,20,80),
        row('2026-10-02',9,1,12,480,11,25,70) ];
$fail=0; function ok($name,$a,$b){global $fail; $pass = is_float($a)||is_float($b) ? abs($a-$b)<0.051 : $a===$b; if(!$pass){$fail++; echo "FAIL $name: got ".json_encode($a)." expected ".json_encode($b)."\n";} else echo "ok   $name\n";}
$minQty=5; $day1=array_values(array_filter($rows,fn($r)=>$r['D']==='2026-10-01'));
$h=build_hourly_payload($day1,'2026-10-01',$minQty);
$h9=$h['hours'][9];
ok('h9 qty',$h9['quantity'],13); ok('h9 excluded (model2 low volume=3<5)',$h9['excludedQuantity'],3);
ok('h9 avg = 400/9',$h9['avgActualCycleSeconds'],44.4); ok('h9 theoretical 3600/13',$h9['theoreticalCycleSeconds'],276.9);
ok('h9 samples',$h9['cycleSamples'],9); ok('h9 outlier gaps',$h9['outlierGaps'],1); ok('h9 outlier sec',$h9['outlierSeconds'],3000);
ok('h9 models',$h9['distinctModels'],2); ok('h9 min',$h9['minActualCycleSeconds'],30); ok('h9 max',$h9['maxActualCycleSeconds'],60);
ok('day total',$h['totalQuantity'],33); ok('day avg = 1100/28',$h['dayAvgActualCycleSeconds'],39.3); ok('day theoretical 2*3600/33',$h['dayTheoreticalCycleSeconds'],218.2);
ok('day outlier gaps',$h['outlierGaps'],1);
$range=['startDate'=>'2026-10-01','endDate'=>'2026-10-02'];
$d=build_daily_payload($rows,$range,$minQty);
ok('daily d1 qty',$d['days'][0]['quantity'],33); ok('daily d2 qty',$d['days'][1]['quantity'],12);
ok('daily d1 avg (range reliable: M1 only)=1100/28',$d['days'][0]['avgActualCycleSeconds'],39.3);
ok('daily d2 avg=480/11',$d['days'][1]['avgActualCycleSeconds'],43.6);
ok('daily d1 theo = 2*3600/33',$d['days'][0]['theoreticalCycleSeconds'],218.2); ok('daily total',$d['totalQuantity'],45);
$m=build_models_payload($rows,$range,$minQty);
ok('models reliable count',count($m['models']),1); ok('low volume count',count($m['lowVolumeModels']),1);
$m1=$m['models'][0];
ok('M1 qty',$m1['quantity'],42); ok('M1 avg=(400+700+480)/(9+19+11)',$m1['avgActualCycleSeconds'],40.5);
ok('M1 min',$m1['minActualCycleSeconds'],20); ok('M1 max',$m1['maxActualCycleSeconds'],80);
ok('M1 activeHours (d1h9,d1h10,d2h9)',$m1['activeHours'],3);
// hour9 across days: qty 10+12=22 -> 163.6 ; hour10: 20 -> 180 ; avg theo = (163.6+180)/2
ok('M1 avg theoretical',$m1['avgTheoreticalCycleSeconds'],171.8); ok('M1 stoppage sec',$m1['stoppageSeconds'],3000);
$mx=build_matrix_payload($rows,$minQty);
ok('matrix d1 h9 qty',$mx['2026-10-01']['hours'][9]['quantity'],13); ok('matrix 24 hours',count($mx['2026-10-02']['hours']),24);
// outlier SQL builder
require_once __DIR__.'/../config/queries.php';
echo outlier_condition(['mode'=>'auto','mult'=>3,'max'=>300,'min'=>1]),"\n", outlier_condition(['mode'=>'fixed','mult'=>3,'max'=>300,'min'=>2]),"\n", outlier_condition(['mode'=>'off','mult'=>3,'max'=>300,'min'=>0]),"\n";
echo $fail? "\n$fail FAILED\n":"\nALL OK\n";
