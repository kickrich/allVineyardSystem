# Local deploy stack on http://localhost:8080
# Requires Docker Desktop (Windows) or Docker Engine

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

Write-Host "==> Building and starting (first run may take 15-30 min)..."
& docker @composeArgs --env-file $envFile up -d --build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Start-Sleep -Seconds 8
& docker @composeArgs --env-file $envFile ps

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
