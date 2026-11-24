@echo off
rem Start the app with made-up data, or reopen the sample if it is already running.
rem The sample lives in its own folder, %LOCALAPPDATA%\finance-sample, and runs on its own
rem port, 4330, so it never shares a database or a window with a real copy of the app.
rem The browser opens only after the server on that port says it is the sample.
setlocal
title Skallary Sample
set "SAMPLE_PORT=4330"
set "SAMPLE_URL=http://127.0.0.1:%SAMPLE_PORT%"
set "SAMPLE_BASE=%LOCALAPPDATA%\finance-sample"

rem This file sits in scripts\; the app is the folder above it.
pushd "%~dp0.." || (echo Could not open the app's folder. & exit /b 1)

where node >nul 2>nul || (echo Node.js was not found. Install it, then start this file again. & goto :fail)
rem In the release ZIP, confirm this Node.js is the version its packages were prepared for.
node scripts\check-node.cjs || goto :fail

if not exist "dist\index.html" (
  echo The app's pages have not been built yet. In this folder:
  echo   %CD%
  echo run this once:  npm run build
  echo then start this file again.
  goto :fail
)

rem Already running? Open it only if it is the sample.
call :ask_instance 1
if "%INSTANCE%"=="sample" goto :open
if "%INSTANCE%"=="other" goto :not_sample

if not exist "%SAMPLE_BASE%\finance\finance.db" (
  echo Building the sample data. This takes a few seconds, once.
  node --import tsx demo\build-sample-db.ts || (echo The sample data could not be built. & goto :fail)
)

echo Starting the sample app on port %SAMPLE_PORT%.
rem The sample folder, port and switches are set for the server process only: the browser
rem opened below keeps the usual LOCALAPPDATA, so it uses its usual profile.
set "SERVER_PID="
for /f %%p in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:LOCALAPPDATA = '%SAMPLE_BASE%'; $env:FINANCE_PORT = '%SAMPLE_PORT%'; $env:FINANCE_NO_AUTOSYNC = '1'; $env:FINANCE_NO_OPEN = '1'; (Start-Process -FilePath node -ArgumentList '--import', 'tsx', 'server\index.ts' -WindowStyle Minimized -PassThru).Id"') do set "SERVER_PID=%%p"
if not defined SERVER_PID (echo The sample app could not be started. & goto :fail)

call :ask_instance 30
if "%INSTANCE%"=="sample" goto :open
rem Not the sample (a database there that this app did not build), or no answer: stop the
rem server this file started, so nothing is left running on that port.
taskkill /PID %SERVER_PID% /T /F >nul 2>nul
if "%INSTANCE%"=="other" (
  echo The database in %SAMPLE_BASE% is not sample data, so nothing was opened.
  echo Move it out of that folder, then start this file again.
  goto :fail
)
echo The sample app did not start. Run "node --import tsx server\index.ts" with LOCALAPPDATA set to
echo %SAMPLE_BASE% and FINANCE_PORT set to %SAMPLE_PORT% to see why.
goto :fail

:open
start "" "%SAMPLE_URL%"
popd
exit /b 0

:not_sample
echo Something other than the sample app answers on port %SAMPLE_PORT%, so nothing was opened.
echo Close it, then start this file again.
goto :fail

:fail
popd
pause
exit /b 1

rem Sets INSTANCE to sample, other or none, asking the port for up to %1 seconds.
:ask_instance
set "INSTANCE=none"
for /f %%r in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$until = (Get-Date).AddSeconds(%1); do { try { $r = Invoke-RestMethod -Uri '%SAMPLE_URL%/api/instance' -TimeoutSec 2; if ($r.sample -eq $true) { 'sample' } else { 'other' }; exit } catch { if ($_.Exception.Response) { 'other'; exit }; Start-Sleep -Milliseconds 500 } } while ((Get-Date) -lt $until); 'none'"') do set "INSTANCE=%%r"
exit /b 0
