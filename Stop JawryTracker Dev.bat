@echo off
setlocal
rem Closes the dev client and stops the Vite dev server on port 1420.
rem Only the debug build (tauri-app.exe) is closed - the release
rem JawryTracker.exe is left alone.

taskkill /im tauri-app.exe /f >nul 2>&1
if not errorlevel 1 (echo Closed the dev client.) else (echo The dev client was not running.)

rem The window Start JawryTracker Dev.bat opened, with everything under it.
taskkill /fi "WINDOWTITLE eq JawryTracker dev server*" /t /f >nul 2>&1

rem Whatever is still listening on 1420 - a server started some other way.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":1420 .*LISTENING"') do (
  taskkill /pid %%p /t /f >nul 2>&1
)

curl.exe -s -o nul -m 2 http://localhost:1420/
if errorlevel 1 (echo Dev server is off.) else (echo The dev server is still answering on port 1420.& pause)
exit /b 0
