@echo off
rem From the checkout root in Command Prompt, run cli\finance.cmd <verb> ...
rem Runs the CLI from the repo so its node_modules and tsx resolve.
pushd "%~dp0.."
node --import tsx cli\finance.ts %*
set FINANCE_EXIT=%ERRORLEVEL%
popd
exit /b %FINANCE_EXIT%
