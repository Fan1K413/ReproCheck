# ReproCheck 一键启动编排：幂等检查端口、启动缺失服务、等待真实健康检查、打开浏览器。
# 业务上不修改数据库、不写业务记录，仅启动现有前后端进程。

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$Root = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $Root 'backend'
$FrontendDir = Join-Path $Root 'frontend'
$BackendUrl = 'http://127.0.0.1:8000/api/v1/health'
$FrontendUrl = 'http://127.0.0.1:5173/'
$AppUrl = 'http://127.0.0.1:5173/'
$CmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'

function Find-NodeExecutable {
  $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
  if ($nodeCommand) { return $nodeCommand.Source }

  $runtimeRoot = Join-Path $env:LOCALAPPDATA 'Doubao\User Data\sandbox_runtime\bases'
  if (Test-Path -LiteralPath $runtimeRoot) {
    $runtimeNode = Get-ChildItem -LiteralPath $runtimeRoot -Directory |
      Sort-Object LastWriteTime -Descending |
      ForEach-Object { Join-Path $_.FullName 'node\node.exe' } |
      Where-Object { Test-Path -LiteralPath $_ } |
      Select-Object -First 1
    if ($runtimeNode) { return $runtimeNode }
  }

  $candidates = @()
  if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe') }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

$NodeExe = Find-NodeExecutable
if ($NodeExe) { $env:REPROCHECK_NODE = $NodeExe }

function Test-BackendReady {
  try {
    $response = Invoke-WebRequest -Uri $BackendUrl -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -eq 200 -and $response.Content -match '"status"\s*:\s*"ok"')
  } catch {
    return $false
  }
}

function Test-FrontendReady {
  try {
    $response = Invoke-WebRequest -Uri $FrontendUrl -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -eq 200 -and $response.Content -match 'ReproCheck')
  } catch {
    return $false
  }
}

function Test-PortListening([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $Port)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Get-PortOwner([int]$Port) {
  try {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
    if ($connection) {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
      return "PID $($connection.OwningProcess) / $($process.Name)"
    }
  } catch {}
  return '未知进程'
}

Write-Host '============================================' -ForegroundColor DarkCyan
Write-Host '  ReproCheck 科研复现审计官 · 一键启动' -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor DarkCyan
Write-Host ''

$PythonExe = Join-Path $BackendDir '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $PythonExe)) {
  throw '缺少后端虚拟环境：backend\.venv\Scripts\python.exe。请先按 README 安装后端依赖。'
}
try {
  & $PythonExe -c 'import fastapi, uvicorn' 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'backend/.venv 中的 Python 或依赖不可用' }
} catch {
  throw '后端虚拟环境无法运行。请检查 backend/.venv 的解释器路径，并按 README 重建环境。'
}
if (-not (Test-Path -LiteralPath (Join-Path $FrontendDir 'node_modules\vite\bin\vite.js'))) {
  throw '缺少前端依赖：frontend\node_modules。请先在 frontend 目录执行 npm install。'
}

$backendReady = Test-BackendReady
$frontendReady = Test-FrontendReady

if (-not $backendReady) {
  if (Test-PortListening 8000) {
    throw "端口 8000 已被占用，但不是可用的 ReproCheck 后端。占用：$(Get-PortOwner 8000)。请先关闭该进程。"
  }
  Write-Host '[启动] 正在拉起后端 http://127.0.0.1:8000 ...' -ForegroundColor Yellow
  Start-Process -FilePath $CmdExe -ArgumentList '/k', "`"$(Join-Path $PSScriptRoot 'backend-window.cmd')`"" -WorkingDirectory $Root -WindowStyle Minimized
} else {
  Write-Host '[复用] 后端已在运行，跳过重复启动。' -ForegroundColor Green
}

if (-not $frontendReady) {
  if (Test-PortListening 5173) {
    throw "端口 5173 已被占用，但不是可用的 ReproCheck 前端。占用：$(Get-PortOwner 5173)。请先关闭该进程。"
  }
  Write-Host '[启动] 正在拉起前端 http://127.0.0.1:5173 ...' -ForegroundColor Yellow
  Start-Process -FilePath $CmdExe -ArgumentList '/k', "`"$(Join-Path $PSScriptRoot 'frontend-window.cmd')`"" -WorkingDirectory $Root -WindowStyle Minimized
} else {
  Write-Host '[复用] 前端已在运行，跳过重复启动。' -ForegroundColor Green
}

$deadline = (Get-Date).AddSeconds(90)
do {
  Start-Sleep -Milliseconds 700
  $backendReady = Test-BackendReady
  $frontendReady = Test-FrontendReady
  Write-Host '.' -NoNewline
} while ((-not $backendReady -or -not $frontendReady) -and (Get-Date) -lt $deadline)
Write-Host ''
Write-Host ''

if (-not $backendReady) {
  throw "后端未在 90 秒内就绪。请查看最小化的 [ReproCheck - 后端 :8000] 窗口，或检查端口 8000。"
}
if (-not $frontendReady) {
  throw "前端未在 90 秒内就绪。请查看最小化的 [ReproCheck - 前端 :5173] 窗口，或检查端口 5173。"
}

Write-Host '[成功] 后端健康检查：http://127.0.0.1:8000/api/v1/health' -ForegroundColor Green
Write-Host '[成功] 前端已就绪：http://127.0.0.1:5173/' -ForegroundColor Green
Write-Host '[提示] 关闭对应的两个启动窗口，即可停止服务。' -ForegroundColor Gray
Write-Host ''

Start-Process $AppUrl
Write-Host '浏览器已打开，可以开始使用。' -ForegroundColor Cyan
