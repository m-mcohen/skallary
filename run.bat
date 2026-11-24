@echo off
rem Starts the app from the folder this file sits in. Node comes from PATH, else from Program Files.
rem In the release ZIP, scripts\check-node.cjs first confirms this Node.js is the version the
rem packages were prepared for (Start.cmd sets FINANCE_NODE_CHECKED when it has checked already).
setlocal
title Skallary
cd /d "%~dp0" || exit /b 1
set "NODE_EXE=node"
where node >nul 2>nul || set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not "%FINANCE_NODE_CHECKED%"=="1" (
  "%NODE_EXE%" scripts\check-node.cjs || (pause & exit /b 1)
)
"%NODE_EXE%" --import tsx server\index.ts
