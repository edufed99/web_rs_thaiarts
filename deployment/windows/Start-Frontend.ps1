$ErrorActionPreference = "Stop"
$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Frontend = Join-Path $AppRoot "frontend"

if (-not (Test-Path -LiteralPath (Join-Path $Frontend ".next"))) {
    throw "Production frontend build not found. Run deploy/windows/Setup-App.ps1 first."
}

Push-Location $Frontend
try {
    & npm.cmd run start -- --hostname 127.0.0.1 --port 3000
} finally {
    Pop-Location
}

