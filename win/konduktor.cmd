@echo off
REM Manual entry point. No inline JavaScript and no message sending.
"%ProgramFiles%\nodejs\node.exe" "%~dp0..\agent\scheduled-run.mjs" %*
