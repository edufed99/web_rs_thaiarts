[CmdletBinding()]
param(
    [switch]$SkipPythonInstall,
    [switch]$SkipFrontendInstall
)

$ErrorActionPreference = "Stop"
$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Backend = Join-Path $AppRoot "backend"
$Frontend = Join-Path $AppRoot "frontend"
$Python = Join-Path $Backend ".venv\Scripts\python.exe"

function Require-Command([string]$Name, [string]$InstallHint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name was not found. $InstallHint"
    }
}

Require-Command "python" "Install 64-bit Python 3.11 or 3.12 and add it to PATH."
Require-Command "node" "Install Node.js 20 LTS."
Require-Command "npm.cmd" "Install Node.js 20 LTS."

$PythonVersion = & python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($PythonVersion -notin @("3.11", "3.12")) {
    Write-Warning "Python $PythonVersion detected. Python 3.11 or 3.12 is recommended."
}

$RandomBytes = New-Object byte[] 48
$RandomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $RandomGenerator.GetBytes($RandomBytes)
} finally {
    $RandomGenerator.Dispose()
}
$InternalServiceSecret = [Convert]::ToHexString($RandomBytes).ToLowerInvariant()

$BackendEnv = Join-Path $Backend ".env"
if (-not (Test-Path -LiteralPath $BackendEnv)) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "backend.env.production.example") -Destination $BackendEnv
    $EnvText = Get-Content -Raw -LiteralPath $BackendEnv
    $EnvText = $EnvText.Replace("<GENERATED_DURING_SETUP>", $InternalServiceSecret)
    [IO.File]::WriteAllText($BackendEnv, $EnvText, [Text.UTF8Encoding]::new($false))
    Write-Host "Created backend/.env with a random Internal Service Credential. Review it before production."
} else {
    Write-Host "Keeping existing backend/.env."
}

$FrontendEnv = Join-Path $Frontend ".env.production"
if (-not (Test-Path -LiteralPath $FrontendEnv)) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "frontend.env.production.example") -Destination $FrontendEnv
    $EnvText = Get-Content -Raw -LiteralPath $FrontendEnv
    $EnvText = $EnvText.Replace("<GENERATED_DURING_SETUP>", $InternalServiceSecret)
    [IO.File]::WriteAllText($FrontendEnv, $EnvText, [Text.UTF8Encoding]::new($false))
    Write-Host "Created frontend/.env.production with the matching Internal Service Credential."
} else {
    Write-Host "Keeping existing frontend/.env.production. Verify MODEL_SERVICE_SHARED_SECRET matches backend/.env."
}

if (-not $SkipPythonInstall) {
    if (-not (Test-Path -LiteralPath $Python)) {
        & python -m venv (Join-Path $Backend ".venv")
    }
    & $Python -m pip install --upgrade pip
    & $Python -m pip install -r (Join-Path $Backend "requirements.txt")
}

if (-not $SkipFrontendInstall) {
    Push-Location $Frontend
    try {
        & npm.cmd ci
        & npm.cmd run build
    } finally {
        Pop-Location
    }
}

New-Item -ItemType Directory -Force -Path (Join-Path $AppRoot "logs") | Out-Null
Write-Host "Setup complete. Review both environment files, configure PostgreSQL, then use the Start scripts."
