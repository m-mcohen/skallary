@echo off
setlocal
if not exist "%~dp0dist\index.html" goto :setup
if not exist "%~dp0node_modules\better-sqlite3\package.json" goto :setup
call "%~dp0run.bat"
exit /b %errorlevel%

:setup
echo Open PowerShell in the Skallary folder and run npm run setup before starting Skallary.
pause
exit /b 1
