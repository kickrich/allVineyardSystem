# Local deploy stack on http://localhost:8080
# Requires Docker Desktop (Windows) or Docker Engine
# Tip: Docker Desktop Settings -> Resources -> Memory 8 GB+

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker not found. Install Docker Desktop."
}

$envFile = ".env"
if (-not (Test-Path $envFile)) {
    if (-not (Test-Path ".env.local.example")) {
        Write-Error ".env.local.example not found"
    }
    Copy-Item ".env.local.example" $envFile
    Write-Host "Created $envFile from .env.local.example - edit if needed."
}

$modelPath = Join-Path $PSScriptRoot "cvService\models\best.onnx"
if (-not (Test-Path $modelPath)) {
    Write-Warning "Missing cvService\models\best.onnx - set CV_DUMMY_INFERENCE=true or add the model."
}

$composeArgs = @(
    "compose",
    "-f", "docker-compose.prod.yml",
    "-f", "docker-compose.local.yml"
)

$envText = Get-Content $envFile -Raw
if ($envText -match '(?m)^CV_USE_GPU=(1|true|yes|on)\s*$') {
    $composeArgs += @("-f", "docker-compose.gpu.yml")
    Write-Host "GPU: docker-compose.gpu.yml"
}

# Less parallel builds = fewer Docker Desktop EOF crashes on Windows
$env:COMPOSE_PARALLEL_LIMIT = "1"

function Invoke-DockerCompose {
    param([string[]]$ExtraArgs)
    & docker @composeArgs --env-file $envFile @ExtraArgs
    return $LASTEXITCODE
}

Write-Host "==> Building images (first run 15-30 min, one service at a time)..."
$buildExit = Invoke-DockerCompose @("build")
if ($buildExit -ne 0) {
    Write-Host ""
    Write-Host "Build failed. Often Docker Desktop ran out of memory at vineyard-app unpack."
    Write-Host "1) Docker Desktop -> Settings -> Resources -> Memory 8 GB+"
    Write-Host "2) Restart Docker Desktop"
    Write-Host "3) Retry only vineyard-app:"
    Write-Host '   docker compose -f docker-compose.prod.yml -f docker-compose.local.yml --env-file .env build vineyard-app'
    Write-Host '   docker compose -f docker-compose.prod.yml -f docker-compose.local.yml --env-file .env up -d'
    exit $buildExit
}

Write-Host "==> Starting containers..."
$upExit = Invoke-DockerCompose @("up", "-d")
if ($upExit -ne 0) { exit $upExit }

Start-Sleep -Seconds 8
Invoke-DockerCompose @("ps") | Out-Null

$base = "http://localhost:8080"
Write-Host ""
Write-Host "Ready."
Write-Host "  Site:        $base"
Write-Host "  VineyardApp: ${base}/vineyard/"
Write-Host "  CV API:      http://127.0.0.1:8000/"
Write-Host "  MinIO UI:    http://127.0.0.1:9001  (minioadmin + password from .env)"
Write-Host ""
Write-Host 'Logs: docker compose -f docker-compose.prod.yml -f docker-compose.local.yml logs -f cv vineyard-app backend'
Write-Host 'Stop: docker compose -f docker-compose.prod.yml -f docker-compose.local.yml down'
