# smoke-test.ps1 -- End-to-end release smoke test + model-fallback check
#
# Issue #11 release gate. Run AFTER `docker compose up -d` with the new
# images and BEFORE flipping IIS routing (or after, against the public URL).
# Verifies:
#   1. The Private Model Service answers /internal/v1/health with the
#      Internal Service Credential and rejects requests without it (401).
#   2. The Next.js Application Backend serves health, catalogue browse,
#      contexts, and a model-backed recommendation (metadata.fallback=false).
#   3. Model fallback: with the model service stopped, recommendations still
#      answer 200 with metadata.fallback=true (issue #7 behaviour).
#   4. Network boundary: no host-published listeners on the model port
#      (8001) or PostgreSQL (5432) -- the compose topology publishes only
#      Next.js (issue #11).
#
# Usage (on the production host, from the application directory):
#   powershell -ExecutionPolicy Bypass -File deployment\release\smoke-test.ps1
#
# Options:
#   -ComposeFile       Compose file (auto-detected like backup-and-migrate.ps1)
#   -FrontendPort      Next.js port (default 3000)
#   -ModelSecret       Internal Service Credential (default: read from .env)
#   -SkipFallbackCheck Skip stopping/restarting the model service
#   -SkipBoundaryCheck Skip the host-port listener checks (needed on dev
#                      machines where WSL PostgreSQL occupies 5432)

[CmdletBinding()]
param(
    [string]$ComposeFile = "",
    [int]$FrontendPort = 3000,
    [string]$ModelSecret = "",
    [switch]$SkipFallbackCheck,
    [switch]$SkipBoundaryCheck
)

$ErrorActionPreference = "Stop"

$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $ComposeFile) {
    $ProdCompose = Join-Path $PSScriptRoot "..\docker-compose.prod.yml"
    $RootCompose = Join-Path $AppRoot "docker-compose.yml"
    if (Test-Path -LiteralPath $ProdCompose) {
        $ComposeFile = $ProdCompose
    } elseif (Test-Path -LiteralPath $RootCompose) {
        $ComposeFile = $RootCompose
    } else {
        throw "No compose file found. Pass -ComposeFile explicitly."
    }
}
$ComposeFile = (Resolve-Path -LiteralPath $ComposeFile).Path

if (-not $ModelSecret) {
    $EnvFile = Join-Path (Split-Path -Parent $ComposeFile) ".env"
    if (Test-Path -LiteralPath $EnvFile) {
        $Line = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match "^MODEL_SERVICE_SHARED_SECRET=" } | Select-Object -First 1
        if ($Line) { $ModelSecret = ($Line -split "=", 2)[1].Trim() }
    }
}
if (-not $ModelSecret) {
    throw "MODEL_SERVICE_SHARED_SECRET not found. Pass -ModelSecret or set it in .env."
}

$FrontendBase = "http://127.0.0.1:$FrontendPort"
$Failures = @()

function Assert-True([bool]$Condition, [string]$Message) {
    if ($Condition) {
        Write-Host "  [PASS] $Message"
    } else {
        Write-Host "  [FAIL] $Message"
        $script:Failures += $Message
    }
}

function Invoke-Compose([string[]]$Arguments) {
    & docker compose -f $ComposeFile @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Wait-ModelHealthy([int]$TimeoutSeconds = 120) {
    $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $Deadline) {
        $Code = & docker compose -f $ComposeFile exec -T backend curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $ModelSecret" http://127.0.0.1:8001/internal/v1/health 2>$null
        if ($LASTEXITCODE -eq 0 -and $Code -eq "200") { return $true }
        Start-Sleep -Seconds 3
    }
    return $false
}

Write-Host "==> Smoke test against $FrontendBase (compose: $ComposeFile)"

# --- 1. Private Model Service contract ---------------------------------------
Write-Host "==> Private Model Service (/internal/v1/health)"
$ModelCode = & docker compose -f $ComposeFile exec -T backend curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $ModelSecret" http://127.0.0.1:8001/internal/v1/health 2>$null
Assert-True ($LASTEXITCODE -eq 0 -and $ModelCode -eq "200") "model health with credential -> HTTP $ModelCode (expected 200)"

$NoCredCode = & docker compose -f $ComposeFile exec -T backend curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8001/internal/v1/health 2>$null
Assert-True ($LASTEXITCODE -eq 0 -and $NoCredCode -eq "401") "model health without credential -> HTTP $NoCredCode (expected 401)"

# --- 2. Next.js public surface ------------------------------------------------
Write-Host "==> Next.js Application Backend"
$Health = Invoke-RestMethod -Uri "$FrontendBase/api/health" -TimeoutSec 15
Assert-True ($Health.status -eq "ok" -and $Health.database -eq "connected") "GET /api/health -> status=$($Health.status) database=$($Health.database)"

$Items = Invoke-RestMethod -Uri "$FrontendBase/api/items?limit=5" -TimeoutSec 15
Assert-True ($Items.Count -ge 1) "GET /api/items?limit=5 -> $($Items.Count) items"

$Contexts = Invoke-RestMethod -Uri "$FrontendBase/api/contexts" -TimeoutSec 15
Assert-True ($Contexts.contexts.Count -ge 1) "GET /api/contexts -> $($Contexts.contexts.Count) contexts"
$ContextId = [int]$Contexts.contexts[0].id

# --- 3. Model-backed recommendation -------------------------------------------
Write-Host "==> Recommendation with model service up"
$Body = @{ context_id = $ContextId; top_k = 5 } | ConvertTo-Json
$Rec = Invoke-RestMethod -Uri "$FrontendBase/api/recommendations" -Method Post -ContentType "application/json" -Body $Body -TimeoutSec 30
Assert-True ($Rec.metadata.fallback -eq $false) "POST /api/recommendations -> metadata.fallback=$($Rec.metadata.fallback) (expected False)"
Assert-True ($Rec.results.Count -ge 1) "POST /api/recommendations -> $($Rec.results.Count) results"

# --- 4. Model fallback check ---------------------------------------------------
if (-not $SkipFallbackCheck) {
    Write-Host "==> Model fallback (stopping the model service)"
    Invoke-Compose @("stop", "backend") | Out-Null
    try {
        $Fallback = Invoke-RestMethod -Uri "$FrontendBase/api/recommendations" -Method Post -ContentType "application/json" -Body $Body -TimeoutSec 30
        Assert-True ($Fallback.metadata.fallback -eq $true) "recommendation with model down -> metadata.fallback=$($Fallback.metadata.fallback) (expected True)"
        Assert-True ($Fallback.results.Count -ge 1) "fallback recommendation still returns $($Fallback.results.Count) results"
    } finally {
        Invoke-Compose @("start", "backend") | Out-Null
    }
    Assert-True (Wait-ModelHealthy) "model service healthy again after restart"
} else {
    Write-Host "==> Skipping model fallback check (-SkipFallbackCheck)"
}

# --- 5. Network boundary -------------------------------------------------------
if (-not $SkipBoundaryCheck) {
    Write-Host "==> Network boundary (host listeners)"
    $ModelListeners = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue
    Assert-True (-not $ModelListeners) "no host listener on port 8001 (model service is internal only)"
    $PgListeners = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
    Assert-True (-not $PgListeners) "no host listener on port 5432 (PostgreSQL is internal only)"
} else {
    Write-Host "==> Skipping network boundary check (-SkipBoundaryCheck)"
}

Write-Host ""
if ($Failures.Count -eq 0) {
    Write-Host "SMOKE TEST PASSED -- release is safe to route."
    exit 0
}
Write-Host "SMOKE TEST FAILED ($($Failures.Count) check(s)):"
$Failures | ForEach-Object { Write-Host "  - $_" }
exit 1
