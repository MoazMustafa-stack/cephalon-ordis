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
  & $dockerExe compose --file (Join-Path $repoRoot 'compose.yaml') up -d postgres
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL failed to start.' }
}

$shellCommand = (Get-Command powershell.exe -ErrorAction Stop).Source
$processes = foreach ($service in @('coordinator', 'worker', 'web')) {
  $arguments = @(
    '-NoExit'
    '-NoProfile'
    '-ExecutionPolicy'
    'Bypass'
    '-File'
    $runner
    '-Service'
    $service
  )
  Start-Process -FilePath $shellCommand -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Normal -PassThru
}

Write-Host ''
Write-Host 'Cephalon Ordis services launched.' -ForegroundColor Green
Write-Host 'Coordinator: http://127.0.0.1:4310'
Write-Host 'Dashboard:   http://127.0.0.1:5173'
Write-Host ('Process IDs: {0}' -f ($processes.Id -join ', '))
Write-Host 'Use Ctrl+C inside a service window to stop it.'
