@echo off
setlocal
for /f "delims=" %%i in ('where node') do set NODE=%%i
set JUUR=%~dp0..
schtasks /create /f /tn "Leisson CRM kampaaniad" /sc WEEKLY /d MON,TUE,WED,THU,FRI /st 09:00 /ri 10 /du 0008:00 /it /rl LIMITED /tr "\"%NODE%\" \"%JUUR%\agent\campaign-worker.mjs\" --sweep"
schtasks /query /tn "Leisson CRM kampaaniad" /fo LIST | findstr /R /C:"TaskName" /C:"Status" /C:"Next Run"
