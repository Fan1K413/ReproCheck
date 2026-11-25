@echo off
setlocal
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
"%SystemRoot%\System32\chcp.com" 65001 >nul
title ReproCheck - 后端 :8000
cd /d "%~dp0..\backend"

if not exist ".venv\Scripts\python.exe" (
  echo [错误] 找不到后端虚拟环境：backend\.venv\Scripts\python.exe
  echo 请先按 README 安装后端依赖。
  pause
  exit /b 1
)

echo.
echo ========================================
echo   ReproCheck 后端
echo   http://127.0.0.1:8000
echo   接口文档：http://127.0.0.1:8000/docs
echo   关闭此窗口即可停止后端
echo ========================================
echo.

".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
set "EXIT_CODE=%errorlevel%"

echo.
echo 后端已退出，退出代码：%EXIT_CODE%
pause
exit /b %EXIT_CODE%
