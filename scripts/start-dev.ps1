param([switch]$SkipPostgres)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env'
$runner = Join-Path $PSScriptRoot 'run-dev-service.ps1'

if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Missing .env. Copy .env.example to .env and fill its placeholders.'
}
$envContents = Get-Content -LiteralPath $envFile -Raw
if ($envContents -match 'replace-with-') {
  throw 'The .env file still contains placeholder values.'
}
Set-Location -LiteralPath $repoRoot

if (-not $SkipPostgres) {
  $dockerExe = Get-Command docker.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty Source
  if (-not $dockerExe) { throw 'Docker was not found. Start Docker Desktop.' }
  Write-Host 'Starting PostgreSQL...' -ForegroundColor Cyan
  & $dockerExe compose --file (Join-Path $repoRoot 'compose.yaml') up -d --wait --wait-timeout 60 postgres
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL failed to start.' }
}

$shellCommand = (Get-Command powershell.exe -ErrorAction Stop).Source
function Start-OrdisService {
  param([ValidateSet('coordinator', 'worker', 'web')][string]$Service)
  $arguments = @(
    '-NoExit'
    '-NoProfile'
    '-ExecutionPolicy'
    'Bypass'
    '-File'
    $runner
    '-Service'
    $Service
  )
  Start-Process -FilePath $shellCommand -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Normal -PassThru
}

$processes = @()
$coordinatorProcess = Start-OrdisService -Service 'coordinator'
$processes += $coordinatorProcess

Write-Host 'Waiting for The Helm...' -ForegroundColor Cyan
$coordinatorReady = $false
$healthUrl = 'http://127.0.0.1:4310/health'
$deadline = [DateTime]::UtcNow.AddSeconds(60)
while ([DateTime]::UtcNow -lt $deadline) {
  if ($coordinatorProcess.HasExited) {
    throw 'The Helm exited before becoming ready. Check the coordinator window.'
  }
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
    if ($health.ok -eq $true) {
      $coordinatorReady = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
if (-not $coordinatorReady) {
  throw 'The Helm did not become ready within 60 seconds. Check the coordinator window.'
}
Write-Host 'The Helm is ready.' -ForegroundColor Green

foreach ($service in @('worker', 'web')) {
  $processes += Start-OrdisService -Service $service
}

Write-Host ''
Write-Host 'Cephalon Ordis services launched.' -ForegroundColor Green
Write-Host 'Coordinator: http://127.0.0.1:4310'
Write-Host 'Dashboard:   http://127.0.0.1:5173'
Write-Host ('Process IDs: {0}' -f ($processes.Id -join ', '))
Write-Host 'Use Ctrl+C inside a service window to stop it.'
