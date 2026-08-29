param(
  [ValidateSet('all', 'test', 'typecheck', 'lint', 'build', 'skills', 'subscription')]
  [string]$Check = 'all'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeCandidates = @(
  'C:\Program Files\nodejs\node.exe'
  'C:\nvm4w\nodejs\node.exe'
  (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
)
$nodeExe = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1
if (-not $nodeExe) { throw 'Node.js was not found in a supported location.' }

$nodeDir = Split-Path -Parent $nodeExe
$npmDir = Join-Path $env:APPDATA 'npm'
$pnpmExe = Join-Path $npmDir 'pnpm.cmd'
if (-not (Test-Path -LiteralPath $pnpmExe)) {
  throw ('pnpm.cmd was not found at {0}.' -f $pnpmExe)
}

if ($Check -in @('all', 'skills') -and -not $env:ORDIS_SKILL_VALIDATOR) {
  $validatorCandidates = @(
    (Join-Path $env:USERPROFILE '.codex\skills\.system\skill-creator\scripts\quick_validate.py')
    (Join-Path $env:USERPROFILE '.agents\skills\skill-creator\scripts\quick_validate.py')
  )
  $skillValidator = $validatorCandidates |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
  if (-not $skillValidator) {
    throw 'Skill validator was not found. Set ORDIS_SKILL_VALIDATOR to quick_validate.py.'
  }
  [Environment]::SetEnvironmentVariable(
    'ORDIS_SKILL_VALIDATOR',
    $skillValidator,
    'Process'
  )
}

# Put known-good executables before any stale or malformed user PATH entries.
[Environment]::SetEnvironmentVariable(
  'Path',
  ('{0};{1};{2}' -f $nodeDir, $npmDir, $env:Path),
  'Process'
)
Set-Location -LiteralPath $repoRoot

function Invoke-PnpmCheck {
  param([string]$Name, [string[]]$Arguments)
  Write-Host ('Running {0}...' -f $Name) -ForegroundColor Cyan
  & $pnpmExe @Arguments
  if ($LASTEXITCODE -ne 0) { throw ('{0} failed.' -f $Name) }
}

function Invoke-NodeCheck {
  param([string]$Name, [string]$Script)
  Write-Host ('Running {0}...' -f $Name) -ForegroundColor Cyan
  & $nodeExe $Script
  if ($LASTEXITCODE -ne 0) { throw ('{0} failed.' -f $Name) }
}

Write-Host ('Verification runtime: Node {0}' -f (& $nodeExe --version)) -ForegroundColor DarkCyan

if ($Check -in @('all', 'test')) {
  Invoke-PnpmCheck -Name 'tests' -Arguments @('-r', 'test')
}
if ($Check -in @('all', 'typecheck')) {
  Invoke-PnpmCheck -Name 'typechecks' -Arguments @('-r', 'typecheck')
}
if ($Check -in @('all', 'lint')) {
  Invoke-PnpmCheck -Name 'lint' -Arguments @('lint')
}
if ($Check -in @('all', 'build')) {
  Invoke-PnpmCheck -Name 'builds' -Arguments @('-r', 'build')
}
if ($Check -in @('all', 'skills')) {
  Invoke-NodeCheck -Name 'skill validation' -Script 'scripts/validate-skills.mjs'
}
if ($Check -in @('all', 'subscription')) {
  Invoke-NodeCheck -Name 'subscription-only audit' -Script 'scripts/audit-subscription-only.mjs'
}

Write-Host 'Cephalon Ordis verification passed.' -ForegroundColor Green
