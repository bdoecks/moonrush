@echo off
rem Double-click to play MOONRUSH with friends: builds the game, starts the room server and a Cloudflare tunnel,
rem then prints a link to send your friends. Close this window (or press Ctrl+C) to stop.
title MOONRUSH - Play Online
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
node scripts\play-online.mjs
echo.
pause
