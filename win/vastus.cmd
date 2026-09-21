@echo off
REM Leisson CRM - kogu vastuseahel uhele kirjale:
REM   mustand -> kohustuslik eesti keele toimetus -> kinnituse palve.
REM SAATMIST SIIN EI OLE. Kiri laheb valja ainult CRM-i Saada-nupust.
REM
REM   win\vastus.cmd INBOX:1429
REM   win\vastus.cmd INBOX:1429 6      (paevalimiit sellele jooksule, dollarites)
cd /d "%~dp0.."

if "%~1"=="" (
  echo Kasutus: win\vastus.cmd KAUST:uid [paevalimiit]
  exit /b 1
)
if not "%~2"=="" set AGENT_DAILY_USD=%~2

node agent/worker.mjs --enqueue=draft --message=%~1
node agent/worker.mjs --enqueue=edit --message=%~1

echo Jooksutan ahela, logi: data\vastus.log
node agent/worker.mjs --drain > "data\vastus.log" 2>&1
type "data\vastus.log"
