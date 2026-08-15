$ErrorActionPreference = "Stop"

function Test-Url([string]$Name, [string]$Url) {
    try {
        $Response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 15
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

$Results = @(
    Test-Url "Backend health" "http://127.0.0.1:8001/health"
    Test-Url "Frontend" "http://127.0.0.1:3000/"
)
$Results | Format-Table -AutoSize -Wrap

if ($Results.Result -contains "OK" -and ($Results | Where-Object Result -ne "OK").Count -eq 0) {
    exit 0
}
exit 1

