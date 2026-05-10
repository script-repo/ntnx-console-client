@echo off
rem ====================================================================
rem NRCC launcher shim. Forwards to the PowerShell implementation.
rem ====================================================================
set "NRCC_BIN_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%NRCC_BIN_DIR%nrcc.ps1" %*
exit /b %ERRORLEVEL%
