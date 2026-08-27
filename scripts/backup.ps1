param(
  [string]$DataRoot = 'E:\Cephalon-Ordis\data',
  [string]$BackupRoot = 'D:\Ordis-Backups'
)
$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$destination = Join-Path $BackupRoot $stamp
New-Item -ItemType Directory -Force -Path $destination | Out-Null
docker compose -f 'E:\Cephalon-Ordis\code\compose.yaml' exec -T postgres pg_dump -U ordis -d ordis -Fc -f /tmp/ordis.dump
docker cp cephalon-ordis-postgres-1:/tmp/ordis.dump (Join-Path $destination 'ordis.dump')
Copy-Item -LiteralPath (Join-Path $DataRoot 'artifacts') -Destination $destination -Recurse
Write-Host "Backup staged at $destination"

