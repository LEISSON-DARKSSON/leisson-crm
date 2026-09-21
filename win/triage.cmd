@echo off
REM Leisson CRM - paneb triaazitood jarjekorda ja teeb jarjekorra tuhjaks.
REM   win\triage.cmd            ainult tuhjendab olemasoleva jarjekorra
REM   win\triage.cmd 25         paneb 1 too a 25 kirja, siis tuhjendab
REM   win\triage.cmd 25 6       paneb 6 tood a 25 kirja, siis tuhjendab
REM NB parameetreid kasutame OTSE (%~1 / %~2). set-muutuja if-ploki sees
REM laieneks tuhjaks, sest cmd laiendab kogu ploki korraga.
cd /d "%~dp0.."

if "%~1"=="" goto :drain
if "%~2"=="" (
  node agent/worker.mjs --enqueue=triage --limit=%~1
) else (
  for /l %%i in (1,1,%~2) do node agent/worker.mjs --enqueue=triage --limit=%~1
)

:drain
echo Jooksutan jarjekorra tuhjaks, logi: data\drain.log
node agent/worker.mjs --drain > "data\drain.log" 2>&1
type "data\drain.log"
