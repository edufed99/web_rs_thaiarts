$ErrorActionPreference = "Stop"
$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Backend = Join-Path $AppRoot "backend"
$Python = Join-Path $Backend ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python environment not found. Run deploy/windows/Setup-App.ps1 first."
}
if (-not (Test-Path -LiteralPath (Join-Path $Backend ".env"))) {
    throw "backend/.env not found. Run Setup-App.ps1 and review the settings."
}

Push-Location $Backend
try {
    & $Python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --workers 1 --proxy-headers --forwarded-allow-ips 127.0.0.1
} finally {
    Pop-Location
}

