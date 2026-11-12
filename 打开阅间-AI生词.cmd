@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0gre-reading-studio\scripts\start-vocabulary-ai.ps1"
if errorlevel 1 pause
