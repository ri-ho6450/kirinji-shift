@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Kirinji Shift App
if not exist "%~dp0scripts\start-app.mjs" goto missing_files
if not exist "%~dp0package-lock.json" goto missing_files
where node >nul 2>nul
if not errorlevel 1 goto launch
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
  goto launch
)
echo Node.js is not installed. Installing Node.js LTS...
where winget >nul 2>nul
if errorlevel 1 goto missing_node
winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
if errorlevel 1 goto missing_node
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
  goto launch
)
echo Node.js installation finished. Close this window and double-click again.
pause
exit /b 1

:missing_node
echo Please install Node.js LTS from the page that opens, then double-click again.
start "" "https://nodejs.org/ja/download"
pause
exit /b 1

:missing_files
 echo Please extract ALL files from the ZIP before launching.
 echo Right-click the ZIP, select Extract All, then launch from the extracted folder.
 pause
 exit /b 1

:launch
node "%~dp0scripts\start-app.mjs"
if errorlevel 1 (
  echo.
  echo App startup failed. Please check the message above.
  pause
  exit /b 1
)
exit /b 0
