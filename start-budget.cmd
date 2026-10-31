@echo off
rem Budget: builds the app and starts the server on http://localhost:3001
cd /d "%~dp0"
rem Phone access over Tailscale (https on the tailnet), if Tailscale is installed
where tailscale >nul 2>nul && tailscale serve --bg 3001
call npm run serve
pause
