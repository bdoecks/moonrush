@echo off
rem Double-click to upload MOONRUSH to your GitHub (github.com/bdoecks/moonrush).
rem The first time, a GitHub sign-in window pops up: click "Sign in with your browser" and approve.
title MOONRUSH - Upload to GitHub
cd /d "%~dp0"
"C:\Program Files\Git\cmd\git.exe" push -u origin main
echo.
if errorlevel 1 (
  echo Something went wrong - copy the text above and paste it to Claude.
) else (
  echo Done! Your code is on GitHub.
)
pause
