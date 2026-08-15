# backup-and-migrate.ps1 -- Pre-release data backup + TypeORM migration + verify
#
# Issue #11 release gate. Run this BEFORE any public routing change (IIS
# web.config flip). It:
#   1. Backs up the production PostgreSQL database (custom-format pg_dump).
#   2. Backs up the uploads volume (Next.js media store).
#   3. Backs up the production .env (secrets stay on the server).
#   4. Applies TypeORM migrations + seed through the compiled CLI
#      (frontend/db/cli.ts -- the sole schema authority).
#   5. Verifies migration state with `migration:verify`; the run FAILS when
#      any migration is still pending, so routing cannot proceed on an
#      unverified schema.
#
# Usage (on the production host, from the application directory):
#   powershell -ExecutionPolicy Bypass -File deployment\release\backup-and-migrate.ps1
#
# Options:
#   -ComposeFile     Path to the compose file (default: auto-detect
#                    deployment/docker-compose.prod.yml, else docker-compose.yml)
#   -BackupDir       Where backups land (default: <app-root>\backups)
#   -UploadsVolume   Docker volume holding the media store
#                    (default: thaiarts_uploads_data)
#   -SkipUploadsBackup  Skip the uploads volume tar (e.g. when the volume
#                    does not exist yet on a fresh host)
#
# Requires: Docker Desktop / Docker Engine with the compose v2 plugin, and
# the production stack running (`docker compose ps` shows postgres up).

[CmdletBinding()]
param(
    [string]$ComposeFile = "",
    [string]$BackupDir = "",
    [string]$UploadsVolume = "thaiarts_uploads_data",
    [switch]$SkipUploadsBackup
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
if (-not $BackupDir) {
    $BackupDir = Join-Path $AppRoot "backups"
}
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

function Invoke-Compose([string[]]$Arguments) {
    & docker compose -f $ComposeFile @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

# --- 0. Pre-flight -----------------------------------------------------------
Write-Host "==> Pre-flight: compose file $ComposeFile"
& docker compose -f $ComposeFile ps --format json 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "The production stack is not running. Start it with 'docker compose up -d' first."
}

$PostgresUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "postgres" }
$PostgresDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "web_rs_thaiarts" }
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"

# --- 1. PostgreSQL backup (custom format, inside the container) --------------
Write-Host "==> Backing up PostgreSQL database '$PostgresDb'"
Invoke-Compose @("exec", "-T", "postgres", "pg_isready", "-U", $PostgresUser, "-d", $PostgresDb) | Out-Null
$DumpName = "thaiarts-db-$Stamp.dump"
$ContainerDump = "/tmp/$DumpName"
Invoke-Compose @("exec", "-T", "postgres", "pg_dump", "-U", $PostgresUser, "-d", $PostgresDb, "-Fc", "-f", $ContainerDump) | Out-Null
Invoke-Compose @("cp", "postgres:$ContainerDump", (Join-Path $BackupDir $DumpName)) | Out-Null
Invoke-Compose @("exec", "-T", "postgres", "rm", "-f", $ContainerDump) | Out-Null
Write-Host "    -> $(Join-Path $BackupDir $DumpName)"

# --- 2. Uploads volume backup ------------------------------------------------
if (-not $SkipUploadsBackup) {
    Write-Host "==> Backing up uploads volume '$UploadsVolume'"
    $UploadsName = "thaiarts-uploads-$Stamp.tar.gz"
    & docker run --rm -v "${UploadsVolume}:/data:ro" -v "${BackupDir}:/backup" alpine tar czf "/backup/$UploadsName" -C /data .
    if ($LASTEXITCODE -ne 0) {
        throw "Uploads volume backup failed with exit code $LASTEXITCODE"
    }
    Write-Host "    -> $(Join-Path $BackupDir $UploadsName)"
} else {
    Write-Host "==> Skipping uploads volume backup (-SkipUploadsBackup)"
}

# --- 3. .env backup ----------------------------------------------------------
$EnvFile = Join-Path (Split-Path -Parent $ComposeFile) ".env"
if (Test-Path -LiteralPath $EnvFile) {
    $EnvBackup = Join-Path $BackupDir "env-$Stamp.txt"
    Copy-Item -LiteralPath $EnvFile -Destination $EnvBackup
    Write-Host "==> Backed up .env -> $EnvBackup"
} else {
    Write-Host "==> WARNING: no .env found next to the compose file; skipping."
}

# --- 4. Apply migrations + seed + verify -------------------------------------
Write-Host "==> Applying TypeORM migrations + seed + migration:verify"
Invoke-Compose @("--profile", "tools", "run", "--rm", "migrate")
Write-Host "==> Migration state verified: current"

Write-Host ""
Write-Host "Backup + migration + verification complete. Backups in: $BackupDir"
Write-Host "Next: deploy the new images, run smoke-test.ps1, then flip IIS routing."
