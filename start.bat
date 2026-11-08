@echo off
chcp 65001 >nul
title zen-court launcher
cd /d "%~dp0"

rem If the server is already running, just open the page (avoid EADDRINUSE).
netstat -ano | findstr ":8787" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo Server already running. Opening http://localhost:8787 ...
  start "" http://localhost:8787
  timeout /t 3 >nul
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Please install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\ws" (
  echo First run: installing dependencies, please wait...
  call npm install --loglevel=error
)

echo Starting server...
echo A minimized window titled "zen-court server" will stay open. Close it to stop the game.
start "zen-court server - keep open" /min cmd /c "node server.js & echo. & echo [server stopped] & pause"

timeout /t 3 >nul
start "" http://localhost:8787
echo.
echo Done. Browser opened at http://localhost:8787
echo To stop: close the minimized "zen-court server" window.
timeout /t 6 >nul
