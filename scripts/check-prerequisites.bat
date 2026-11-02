@echo off
rem Checks for what building JawryTracker needs - Node.js, the Microsoft C++
rem Build Tools, the WebView2 Runtime and the Rust toolchain - and offers to
rem install whichever are missing with winget. Called by the Start and Build
rem batch files in the repo root before they do anything else.
rem
rem Exits 0 once everything is there, 1 when something is still missing.
rem The PATH it ends with is handed back to the caller, so whatever was just
rem installed can be used without opening a new window.
setlocal

call :check
if not defined MISSING goto ready

echo.
echo JawryTracker needs these to build, and they aren't installed:
call :list_missing
echo.

where winget >nul 2>&1
if errorlevel 1 goto manual

echo They can be installed now with winget, the Windows package manager.
echo Windows may ask for permission, and winget may show license terms to
echo accept.
if defined NEED_CPP echo The C++ Build Tools are a few GB and take a while to install.
echo.
choice /c YN /m "Install them now"
if errorlevel 2 goto manual

if not defined NEED_NODE goto node_done
echo.
echo Installing Node.js...
winget install --id OpenJS.NodeJS.LTS --exact --source winget
:node_done

if not defined NEED_WEBVIEW goto webview_done
echo.
echo Installing the WebView2 Runtime...
winget install --id Microsoft.EdgeWebView2Runtime --exact --source winget
:webview_done

if not defined NEED_CPP goto cpp_done
echo.
if defined VS_PATH goto cpp_modify
echo Installing the Microsoft C++ Build Tools...
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --source winget --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
goto cpp_done
:cpp_modify
rem winget can't add a workload to a Visual Studio that is already installed,
rem but that Visual Studio's own installer can.
echo Visual Studio is installed, but without its C++ build tools. Its
echo installer opens now with them selected: press Modify, and once it has
echo finished, run this again.
start "" "%VS_INSTALLER%\setup.exe" modify --installPath "%VS_PATH%" --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended
:cpp_done

if not defined NEED_RUST goto rust_done
rem Rust's installer sets up Visual Studio itself when it finds no C++ build
rem tools, so Rust waits until the Build Tools above are in.
call :check_cpp
if defined NEED_CPP goto rust_done
echo.
if defined HAVE_RUSTUP goto rust_toolchain
echo Installing Rust...
winget install --id Rustlang.Rustup --exact --source winget
goto rust_done
:rust_toolchain
echo Installing the stable Rust toolchain...
rustup default stable
:rust_done

rem Installers add themselves to the PATH Windows keeps, not to this
rem window's copy of it.
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')"`) do set "PATH=%%p"

call :check
if not defined MISSING goto ready
echo.
echo Still missing:
call :list_missing
echo.
echo If an installer above finished, close this window and run this again -
echo a new window picks up new installs. If something is still missing after
echo that, restart Windows.
exit /b 1

:manual
echo.
echo Install them from here, then run this again:
if defined NEED_NODE echo   Node.js, the LTS version:  https://nodejs.org
if defined NEED_WEBVIEW echo   WebView2 Runtime:  https://developer.microsoft.com/microsoft-edge/webview2/
if defined NEED_CPP echo   C++ Build Tools, with "Desktop development with C++":  https://visualstudio.microsoft.com/visual-cpp-build-tools/
if defined NEED_RUST echo   Rust:  https://rustup.rs
exit /b 1

:ready
endlocal & set "PATH=%PATH%"
exit /b 0


:list_missing
if defined NEED_NODE echo   - Node.js 20 or newer
if defined NEED_WEBVIEW echo   - Microsoft Edge WebView2 Runtime
if defined NEED_CPP echo   - Microsoft C++ Build Tools, "Desktop development with C++"
if defined NEED_RUST echo   - Rust toolchain
goto :eof


:check
set "MISSING="

set "NEED_NODE="
set "NODE_MAJOR=0"
for /f "tokens=1 delims=." %%v in ('node --version 2^>nul') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=%NODE_MAJOR:v=%"
if %NODE_MAJOR% lss 20 set "NEED_NODE=1"

rem Where Microsoft says to look: a version in either key, other than 0.0.0.0.
set "NEED_WEBVIEW=1"
for /f "tokens=3" %%v in ('reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv 2^>nul ^| findstr /i "REG_SZ"') do if not "%%v"=="0.0.0.0" set "NEED_WEBVIEW="
for /f "tokens=3" %%v in ('reg query "HKCU\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv 2^>nul ^| findstr /i "REG_SZ"') do if not "%%v"=="0.0.0.0" set "NEED_WEBVIEW="

call :check_cpp

set "NEED_RUST="
set "HAVE_RUSTUP="
cargo --version >nul 2>&1
if errorlevel 1 set "NEED_RUST=1"
where rustup >nul 2>&1
if not errorlevel 1 set "HAVE_RUSTUP=1"

for %%n in (NEED_NODE NEED_WEBVIEW NEED_CPP NEED_RUST) do if defined %%n set "MISSING=1"
goto :eof


rem The MSVC compiler and linker from any Visual Studio or Build Tools, plus
rem the Windows SDK's libraries, which Rust links every program against.
rem VS_PATH is set when a Visual Studio is installed without them.
:check_cpp
set "NEED_CPP="
set "VS_PATH="
set "VS_INSTALLER=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer"
if exist "%VS_INSTALLER%\vswhere.exe" goto have_vswhere
set "NEED_CPP=1"
goto :eof
:have_vswhere
rem Run from its own folder: the "(x86)" in its path can't go inside for /f.
rem .\ because Windows can be set to not look in the current folder.
pushd "%VS_INSTALLER%"
.\vswhere.exe -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | findstr /r "." >nul
if errorlevel 1 set "NEED_CPP=1"
set "SDK_FOUND="
for /d %%d in ("%ProgramFiles(x86)%\Windows Kits\10\Lib\10.*") do if exist "%%d\um\x64\kernel32.lib" set "SDK_FOUND=1"
if not defined SDK_FOUND set "NEED_CPP=1"
if defined NEED_CPP for /f "delims=" %%p in ('.\vswhere.exe -products * -latest -property installationPath') do set "VS_PATH=%%p"
popd
goto :eof
