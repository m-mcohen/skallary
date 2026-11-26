@echo off
rem skallary: with no words, open the Skallary app; with words, run its command-line verbs.
rem From this folder in PowerShell: .\skallary   or   .\skallary accounts
if "%~1"=="" (
  call "%~dp0Start.cmd"
  exit /b %ERRORLEVEL%
)
call "%~dp0cli\finance.cmd" %*
exit /b %ERRORLEVEL%
