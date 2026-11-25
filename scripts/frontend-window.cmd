@echo off
setlocal
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
"%SystemRoot%\System32\chcp.com" 65001 >nul
title ReproCheck - 前端 :5173
cd /d "%~dp0..\frontend"

if not exist "node_modules\vite\bin\vite.js" (
  echo [错误] 前端依赖未安装。
  echo 请先在 frontend 目录执行：npm install
  pause
  exit /b 1
)

set "NODE_EXE="
if defined REPROCHECK_NODE if exist "%REPROCHECK_NODE%" set "NODE_EXE=%REPROCHECK_NODE%"
if not defined NODE_EXE for /f "delims=" %%I in ('where.exe node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE for /d %%D in ("%LOCALAPPDATA%\Doubao\User Data\sandbox_runtime\bases\*") do if exist "%%~D\node\node.exe" set "NODE_EXE=%%~D\node\node.exe"

if not defined NODE_EXE (
  echo [错误] 找不到 Node.js。请安装 Node.js，或先在当前环境完成前端依赖安装。
  pause
  exit /b 1
)

echo.
echo ========================================
echo   ReproCheck 前端
echo   http://127.0.0.1:5173
echo   API 代理到：http://127.0.0.1:8000
echo   关闭此窗口即可停止前端
echo ========================================
echo.

"%NODE_EXE%" "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5173 --strictPort
set "EXIT_CODE=%errorlevel%"

echo.
echo 前端已退出，退出代码：%EXIT_CODE%
pause
exit /b %EXIT_CODE%
