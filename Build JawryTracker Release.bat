@echo off
setlocal
rem Builds a release - exe and installers, copied into builds\v<version> - but
rem only when the version in package.json is not the one built last. Same
rem version as the latest build: nothing happens. A version built at some
rem earlier point: asks first, since building again replaces that folder.
rem
rem builds\ is looked for in the folders above this one and created beside
rem the clone if there is none - see BUILDING.md. The dev client and dev
rem server can stay open while this runs.

cd /d "%~dp0"

if exist "node_modules\" goto installed
echo Installing the JavaScript packages - first run only...
call npm install
if errorlevel 1 (
  echo npm install failed - see the messages above.
  goto done
)
:installed

node scripts\build-check.mjs
set "CHECK=%errorlevel%"
if "%CHECK%"=="0" goto build
if "%CHECK%"=="10" goto done
if "%CHECK%"=="11" goto ask
echo.
echo Could not tell whether a build is needed - nothing was built.
goto done

:ask
echo.
choice /c YN /m "Build it again"
if errorlevel 2 goto done

:build
rem Clears the errorlevel the Y answer above left behind.
(call )
echo.
call npm run build:app
if errorlevel 1 (
  echo.
  echo The build failed - see the messages above.
  goto done
)
echo.
echo Build finished.

:done
echo.
pause
exit /b 0
