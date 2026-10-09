@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Kirinji - Firebase Hosting publish
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS first: https://nodejs.org/ja/download
  pause
  exit /b 1
)
call npm ci
if errorlevel 1 goto failed
call npx firebase login
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
call npx firebase deploy --only hosting --project gen-lang-client-0437386118
if errorlevel 1 goto failed
start "" "https://gen-lang-client-0437386118.web.app"
echo Hosting published. Firestore rules are not changed by this program.
pause
exit /b 0
:failed
echo Publishing failed. Check the error above.
pause
exit /b 1
