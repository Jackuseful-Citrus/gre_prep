@echo off
setlocal
if not exist "%~dp0GRE-start.html" (
  echo GRE-start.html was not found. Keep this launcher inside the GRE folder.
  pause
  exit /b 1
)
start "" "%~dp0GRE-start.html"
