@echo off
setlocal
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
"%SystemRoot%\System32\chcp.com" 65001 >nul
cd /d "%~dp0"
title ReproCheck 一键启动

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-reprocheck.ps1"
set "START_CODE=%errorlevel%"

if not "%START_CODE%"=="0" (
  echo.
  echo ============================================
  echo  启动失败，请按上面的提示检查后重试。
  echo ============================================
  pause
)

endlocal & exit /b %START_CODE%
