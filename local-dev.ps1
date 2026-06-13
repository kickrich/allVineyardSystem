# Локальный запуск allVineyardSystem (как deploy, на localhost:8080)
# Требуется: Docker Desktop (Windows) или Docker Engine

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker не найден. Установите Docker Desktop."
}

$envFile = ".env"
if (-not (Test-Path $envFile)) {
    if (-not (Test-Path ".env.local.example")) {
        Write-Error "Не найден .env.local.example"
    }
    Copy-Item ".env.local.example" $envFile
    Write-Host "Создан $envFile из .env.local.example — при необходимости отредактируйте."
}

$modelPath = Join-Path $PSScriptRoot "cvService\models\best.onnx"
if (-not (Test-Path $modelPath)) {
    Write-Warning "Нет cvService\models\best.onnx — CV отдаст нулевые метрики или включите CV_DUMMY_INFERENCE=true в .env"
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

Write-Host "==> Сборка и запуск (первый раз может занять 15–30 мин)..."
& docker @composeArgs --env-file $envFile up -d --build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Start-Sleep -Seconds 8
& docker @composeArgs --env-file $envFile ps

$base = "http://localhost:8080"
Write-Host ""
Write-Host "Готово."
Write-Host "  Сайт:        $base"
Write-Host "  VineyardApp: ${base}/vineyard/"
Write-Host "  CV API:      http://127.0.0.1:8000/"
Write-Host "  MinIO UI:    http://127.0.0.1:9001  (minioadmin / пароль из .env)"
Write-Host ""
Write-Host "Логи:  docker compose -f docker-compose.prod.yml -f docker-compose.local.yml logs -f cv vineyard-app backend"
Write-Host "Стоп:  docker compose -f docker-compose.prod.yml -f docker-compose.local.yml down"
