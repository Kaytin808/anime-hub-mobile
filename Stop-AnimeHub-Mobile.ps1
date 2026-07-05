$ErrorActionPreference = 'SilentlyContinue'

$ports = @(3010, 4000)

Write-Host ''
Write-Host 'Stopping Anime Hub Mobile background servers...' -ForegroundColor Cyan

foreach ($port in $ports) {
  $connections = Get-NetTCPConnection -LocalPort $port -State Listen
  foreach ($connection in $connections) {
    $processId = $connection.OwningProcess
    if ($processId) {
      Stop-Process -Id $processId -Force
      Write-Host "Stopped process on port $port."
    }
  }
}

Write-Host 'Done. Press any key to close.'
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
