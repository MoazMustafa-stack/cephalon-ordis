param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('coordinator', 'worker', 'web')]
  [string]$Service,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nodePaths = @(
  'C:\Program Files\nodejs\node.exe'
  'C:\nvm4w\nodejs\node.exe'
  (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
)
$nodeExe = $nodePaths | Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1
if (-not $nodeExe) { throw 'Node.js was not found in a supported location.' }

$nodeDir = Split-Path -Parent $nodeExe
$npmDir = Join-Path $env:APPDATA 'npm'
[Environment]::SetEnvironmentVariable('Path', ('{0};{1};{2}' -f $nodeDir, $npmDir, $env:Path), 'Process')
$envFile = Join-Path $repoRoot '.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Missing .env file.' }

foreach ($line in Get-Content -LiteralPath $envFile) {
  $text = $line.Trim()
  if (-not $text -or $text.StartsWith('#')) { continue }
  $split = $text.IndexOf('=')
  if ($split -le 0) { throw 'Invalid .env line.' }
  $name = $text.Substring(0, $split).Trim()
  $value = $text.Substring($split + 1).Trim()
  [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}

$pnpmExe = Join-Path $npmDir 'pnpm.cmd'
if (-not (Test-Path -LiteralPath $pnpmExe)) { throw 'pnpm.cmd was not found.' }
Set-Location -LiteralPath $repoRoot
if ($ValidateOnly) {
  Write-Host ('Validated {0}: Node {1}, pnpm and .env are available.' -f $Service, (& $nodeExe --version))
  exit 0
}
$host.UI.RawUI.WindowTitle = ('Cephalon Ordis - {0}' -f $Service)
Write-Host ('Starting {0} with Node {1}' -f $Service, (& $nodeExe --version)) -ForegroundColor Cyan
& $pnpmExe --filter ('@ordis/{0}' -f $Service) dev
exit $LASTEXITCODE
