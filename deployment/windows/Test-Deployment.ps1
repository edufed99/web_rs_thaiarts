$ErrorActionPreference = "Stop"

function Test-Url([string]$Name, [string]$Url, [hashtable]$Headers = @{}) {
    try {
        $Response = Invoke-WebRequest -Uri $Url -UseBasicParsing -Headers $Headers -TimeoutSec 15
        [PSCustomObject]@{
            Service = $Name
            Url = $Url
            Status = [int]$Response.StatusCode
            Result = "OK"
        }
    } catch {
        [PSCustomObject]@{
            Service = $Name
            Url = $Url
            Status = $null
            Result = $_.Exception.Message
        }
    }
}

# The FastAPI process is the Private Model Service (issue #10): its health
# endpoint is /internal/v1/health and requires the Internal Service
# Credential from backend/.env.
$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Secret = $null
$BackendEnv = Join-Path $AppRoot "backend\.env"
if (Test-Path -LiteralPath $BackendEnv) {
    $Line = Get-Content -LiteralPath $BackendEnv | Where-Object { $_ -match "^RECSYS_INTERNAL_SERVICE_SECRET=" } | Select-Object -First 1
    if ($Line) {
        $Secret = ($Line -split "=", 2)[1].Trim()
    }
}
$ModelHeaders = @{}
if ($Secret) {
    $ModelHeaders["Authorization"] = "Bearer $Secret"
}

$Results = @(
    Test-Url "Model service health" "http://127.0.0.1:8001/internal/v1/health" $ModelHeaders
    Test-Url "Frontend API health" "http://127.0.0.1:3000/api/health"
    Test-Url "Frontend" "http://127.0.0.1:3000/"
)
$Results | Format-Table -AutoSize -Wrap

if ($Results.Result -contains "OK" -and ($Results | Where-Object Result -ne "OK").Count -eq 0) {
    exit 0
}
exit 1
