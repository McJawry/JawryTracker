@echo off
setlocal
rem Starts JawryTracker for development: the Vite dev server, if it is not
rem already up, and the debug client against it. Front-end edits show up
rem without a rebuild. The client itself is rebuilt first when the Rust side
rem has changed - with nothing changed, that check takes a moment.
rem
rem Everything is found from this file's own folder, so it works in any
rem clone. On a new machine it installs the JavaScript packages and builds
rem the client the first time; see BUILDING.md for what to install first.

set "PROJECT=%~dp0"
set "PROJECT=%PROJECT:~0,-1%"
set "CLIENT_DIR=%PROJECT%\src-tauri\target\debug"
set "SERVER_URL=http://localhost:1420/"
cd /d "%PROJECT%"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed - see BUILDING.md.
  pause
  exit /b 1
)
where cargo >nul 2>&1
if errorlevel 1 (
  echo The Rust toolchain is not installed - see BUILDING.md.
  pause
  exit /b 1
)

if exist "node_modules\" goto installed
echo Installing the JavaScript packages - first run only...
call npm install
if errorlevel 1 (
  echo npm install failed - see the messages above.
  pause
  exit /b 1
)
:installed

rem A running client holds its exe open, so it can't be rebuilt under it.
tasklist /fi "imagename eq tauri-app.exe" /nh | find /i "tauri-app.exe" >nul
if not errorlevel 1 (
  echo The dev client is already running.
  goto server
)
echo Building the dev client - the first build takes several minutes...
cargo build --manifest-path "%PROJECT%\src-tauri\Cargo.toml"
if errorlevel 1 (
  echo The build failed - see the messages above.
  pause
  exit /b 1
)

:server
curl.exe -s -o nul -m 2 %SERVER_URL%
if errorlevel 1 (
  echo Starting the dev server...
  start "JawryTracker dev server" /min /d "%PROJECT%" cmd /c npm run dev
) else (
  echo Dev server is already running.
)

echo Waiting for the dev server on port 1420...
set /a TRIES=0
:wait
curl.exe -s -o nul -m 2 %SERVER_URL%
if not errorlevel 1 goto ready
set /a TRIES+=1
if %TRIES% geq 60 (
  echo The dev server did not answer within a minute.
  echo Check the minimised "JawryTracker dev server" window for errors.
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait

:ready
echo Opening the dev client...
start "" /d "%CLIENT_DIR%" "%CLIENT_DIR%\tauri-app.exe"
exit /b 0
