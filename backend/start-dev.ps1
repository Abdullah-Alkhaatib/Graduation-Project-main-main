param(
  [int]$Port = 8080
)

$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique

if ($listeners) {
  Write-Host "Stopping existing process(es) on port ${Port}: $($listeners -join ', ')" -ForegroundColor Yellow
  foreach ($pidValue in $listeners) {
    try {
      Stop-Process -Id $pidValue -Force -ErrorAction Stop
    } catch {
      Write-Warning "Could not stop process ID $pidValue."
    }
  }
}

Write-Host "Starting backend on port $Port..." -ForegroundColor Green
$env:PORT = "$Port"
node .\server.js