@echo off
REM Leisson CRM - uhe klikiga paigaldus
setlocal
cd /d "%~dp0.."
echo.
echo === Leisson CRM paigaldus ===
echo.
if not exist node_modules (
  echo npm install...
  call npm install --no-audit --no-fund || goto :err
)
echo Allkirja ehitus...
call node lib/signature.mjs --write || goto :err
if not exist .env (
  echo.
  echo .env puudub - kaivitan seadistuse. Parool sisestatakse peidetult.
  echo.
  call npm run setup || goto :err
)
echo.
echo Otseteed...
powershell -ExecutionPolicy Bypass -File "win\install-autostart.ps1" || goto :err
echo.
echo Valmis. Ava toolaualt "Leisson CRM".
pause
exit /b 0
:err
echo.
echo PAIGALDUS KATKES. Vaata ulalpool olevat viga.
pause
exit /b 1
