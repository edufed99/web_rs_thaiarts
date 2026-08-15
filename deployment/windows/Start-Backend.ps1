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
    # Issue #10: the backend is the Private Model Service only — it serves
    # /internal/v1/* with the Internal Service Credential and must never be
    # exposed by the reverse proxy.
    & $Python -m uvicorn app.private_main:app --host 127.0.0.1 --port 8001 --workers 1
} finally {
    Pop-Location
}
