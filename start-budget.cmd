@echo off
rem Budget: builds the app and starts the server on http://localhost:3001
cd /d "%~dp0"
rem First run on this folder (e.g. a fresh download): install the packages
if not exist node_modules (
  echo Installing packages, first run only...
  call npm install || goto :error
)
rem Phone access over Tailscale (https on the tailnet), if Tailscale is installed
where tailscale >nul 2>nul && tailscale serve --bg 3001
call npm run serve
pause
exit /b
:error
echo npm install failed. Is Node.js installed? https://nodejs.org
pause
