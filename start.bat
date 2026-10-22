@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:5173"
  node server.mjs 5173
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:5173"
  python -m http.server 5173
  goto :eof
)

echo.
echo  Nao encontrei Node.js nem Python neste computador.
echo  Instale o Node.js em https://nodejs.org e rode este arquivo de novo.
echo.
pause
