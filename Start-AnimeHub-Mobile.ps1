$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $root 'server'
$mobileDir = Join-Path $root 'mobile-port'
$logsDir = Join-Path $root 'logs'
$serverLog = Join-Path $logsDir 'anime-backend.log'
$mobileLog = Join-Path $logsDir 'anime-mobile.log'

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

function Get-TailscaleIp {
  $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($tailscale) {
    try {
      $ip = (& $tailscale.Source ip -4 2>$null | Select-Object -First 1)
      if ($ip) {
        return $ip.Trim()
      }
    } catch {
      return $null
    }
  }

  $adapterIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -like '100.*' } |
    Select-Object -ExpandProperty IPAddress -First 1

  return $adapterIp
}

$tailscaleIp = Get-TailscaleIp

Write-Host ''
Write-Host 'Anime Hub Mobile launcher' -ForegroundColor Cyan
Write-Host '-------------------------' -ForegroundColor Cyan

if ($tailscaleIp) {
  Write-Host "Tailscale IP: $tailscaleIp" -ForegroundColor Green
  Write-Host "Phone app URL: http://$tailscaleIp:3010" -ForegroundColor Green
  Write-Host "Backend URL:   http://$tailscaleIp:4000" -ForegroundColor Green
} else {
  Write-Host 'Tailscale IP not found yet.' -ForegroundColor Yellow
  Write-Host 'Install/sign in to Tailscale, then run this launcher again.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Starting backend and mobile web server in the background...'

Start-Process powershell -ArgumentList @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-Command',
  "Set-Location '$serverDir'; npm run dev *> '$serverLog'"
) -WindowStyle Hidden

Start-Process powershell -ArgumentList @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-Command',
  "Set-Location '$mobileDir'; npm run dev *> '$mobileLog'"
) -WindowStyle Hidden

Write-Host ''
Write-Host 'Servers are running in the background.' -ForegroundColor Green
Write-Host "Backend log: $serverLog"
Write-Host "Mobile log:  $mobileLog"
Write-Host 'Use Stop Anime Hub Mobile.bat when you are done watching.' -ForegroundColor Yellow
Write-Host 'Press any key to close this launcher window.'
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
