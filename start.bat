@echo off
title OSRS Clan Bot
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  echo Install Node from https://nodejs.org then run this again.
  pause
  exit /b 1
)

if not exist ".env" (
  echo Missing .env file.
  echo Copy .env.example to .env and fill in DISCORD_TOKEN and CLIENT_ID.
  pause
  exit /b 1
)

REM A failed better-sqlite3 install leaves a half-broken node_modules.
REM Reinstall if discord.js is missing or the old native module is still present.
set NEED_INSTALL=0
if not exist "node_modules" set NEED_INSTALL=1
if exist "node_modules\better-sqlite3" set NEED_INSTALL=1
if not exist "node_modules\discord.js" set NEED_INSTALL=1

if %NEED_INSTALL%==1 (
  echo Cleaning old install files...
  if exist "node_modules" rmdir /s /q "node_modules" 2>nul
  if exist "package-lock.json" del /f /q "package-lock.json" 2>nul
  if exist "node_modules" (
    echo Could not fully delete node_modules. Close any Explorer windows
    echo in this folder, pause OneDrive sync, then run start.bat again.
    pause
    exit /b 1
  )
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting bot. Leave this window open. Ctrl+C to stop.
echo It will auto-restart if it crashes.
echo.

:loop
node src\index.js
echo.
echo Bot stopped. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
