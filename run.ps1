# run.ps1 — สคริปต์เปิดใช้งานระบบ Thai Arts Recommender บน Windows
[CmdletBinding()]
param()

$AppRoot = $PSScriptRoot
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Thai Arts Recommender - Local Startup Script   " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 0. Keep WSL VM alive (prevents the WSL2 idle-poweroff loop that restarts
#    docker.service and the app containers every ~minute — microsoft/WSL#40363).
#    Requires [wsl2] vmIdleTimeout=-1 + [general] instanceIdleTimeout=-1 in ~/.wslconfig.
Write-Host "==> 0. Ensuring WSL keepalive process..." -ForegroundColor Yellow
$keepalive = wsl.exe -d Ubuntu -e sh -c "pgrep -f 'sleep infinity' | head -1" 2>$null
if (-not $keepalive) {
    Start-Process -FilePath "wsl.exe" -ArgumentList "-d","Ubuntu","--","sleep","infinity" -WindowStyle Hidden
    Write-Host "    Keepalive started." -ForegroundColor Green
} else {
    Write-Host "    Keepalive already running (PID $keepalive)." -ForegroundColor Green
}

# 1. Start Docker containers in WSL
Write-Host "==> 1. Starting Docker containers (Postgres, Backend, Frontend)..." -ForegroundColor Yellow
& wsl.exe -d Ubuntu -e sh -c "cd /mnt/c/Users/Pichaya/Downloads/web_appRS1 && docker compose up -d"

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to start Docker compose in WSL." -ForegroundColor Red
    exit 1
}

# 2. Check and start WSL Port Bridge for Windows localhost:3000
Write-Host "==> 2. Checking Windows localhost:3000 port bridge..." -ForegroundColor Yellow
$bridgeRunning = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*wsl-port-bridge.js*"
}

if (-not $bridgeRunning) {
    Write-Host "    Starting background Port Bridge..." -ForegroundColor Gray
    $bridgeScript = Join-Path $AppRoot "scripts\wsl-port-bridge.js"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node.exe"
    $psi.Arguments = "`"$bridgeScript`""
    $psi.UseShellExecute = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.CreateNoWindow = $true
    [System.Diagnostics.Process]::Start($psi) | Out-Null
    Start-Sleep -Seconds 2
} else {
    Write-Host "    Port Bridge is already running." -ForegroundColor Green
}

# 3. Verify connection
Write-Host "==> 3. Verifying web app connection..." -ForegroundColor Yellow
$targetUrl = "http://localhost:3000"
$connected = $false
for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:3000" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            $connected = $true
            Write-Host "    Application is ONLINE at http://localhost:3000" -ForegroundColor Green
            break
        }
    } catch {
        Write-Host "    Waiting for services to become ready (attempt $attempt/5)..." -ForegroundColor Yellow
        Start-Sleep -Seconds 2
    }
}

if (-not $connected) {
    # Fallback to direct WSL IP if port bridge is inaccessible
    $wslIp = (wsl.exe -d Ubuntu -e hostname -I).Trim().Split()[0]
    if ($wslIp) {
        $targetUrl = "http://${wslIp}:3000"
        Write-Host "    Using direct WSL IP: $targetUrl" -ForegroundColor Yellow
    }
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Opening $targetUrl in your browser... " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan

Start-Process $targetUrl
