@echo off
setlocal
rem Starts JawryTracker for development: the Vite dev server, if it is not
rem already up, and the debug client against it. Front-end edits show up
rem without a rebuild. The client itself is rebuilt first when the Rust side
rem has changed - with nothing changed, that check takes a moment.
rem
rem Everything is found from this file's own folder, so it works in any
rem clone. On a new machine it offers to install the tools the build needs,
rem then installs the JavaScript packages and builds the client.
rem After a pull it does the same for whatever the pull changed: the packages
rem when package-lock.json differs from what was last installed, the client
rem when the Rust code does.

set "PROJECT=%~dp0"
set "PROJECT=%PROJECT:~0,-1%"
set "CLIENT_DIR=%PROJECT%\src-tauri\target\debug"
set "SERVER_URL=http://localhost:1420/"
cd /d "%PROJECT%"

rem Node.js, the C++ Build Tools, WebView2 and Rust: offers to install
rem whichever are missing.
call "%PROJECT%\scripts\check-prerequisites.bat"
if errorlevel 1 (
  pause
  exit /b 1
)

rem The lock file as it was at the last install is kept beside the packages,
rem so a pull that changes them is noticed even though node_modules exists.
fc /b "package-lock.json" "node_modules\.installed-package-lock.json" >nul 2>&1
if not errorlevel 1 goto installed
rem The running dev server holds some package files open, so they can't be
rem replaced under it.
curl.exe -s -o nul -m 2 %SERVER_URL%
if not errorlevel 1 (
  echo The JavaScript packages need updating, but the dev server is running.
  echo Run Stop JawryTracker Dev.bat, then start again.
  pause
  exit /b 1
)
echo Installing the JavaScript packages...
call npm install
if errorlevel 1 (
  echo npm install failed - see the messages above.
  pause
  exit /b 1
)
copy /y "package-lock.json" "node_modules\.installed-package-lock.json" >nul
:installed

rem A running client holds its exe open, so it can't be rebuilt under it.
rem findstr rather than find, and timeout below by its full path: run from
rem Git Bash, Git's own find and timeout come first on the PATH.
tasklist /fi "imagename eq tauri-app.exe" /nh | findstr /i "tauri-app.exe" >nul
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
"%SystemRoot%\System32\timeout.exe" /t 1 /nobreak >nul
goto wait

:ready
echo Opening the dev client...
start "" /d "%CLIENT_DIR%" "%CLIENT_DIR%\tauri-app.exe"
exit /b 0
