@echo off
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
"%SCRIPT_DIR%\dashboard\dashboard.exe" --path "%SCRIPT_DIR%"
