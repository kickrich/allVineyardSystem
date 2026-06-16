$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$EnvFile = ".env"
$ComposeArgs = @("-f", "docker-compose.prod.yml")

if (-not (Test-Path $EnvFile)) {
    Write-Error "Файл .env не найден. Скопируйте: copy .env.production.example .env"
}

$content = Get-Content $EnvFile -Raw
foreach ($var in @("POSTGRES_PASSWORD", "MINIO_ROOT_PASSWORD", "BACKEND_SECRET_KEY_BASE", "VINEYARD_SECRET_KEY_BASE", "PUBLIC_URL")) {
    if ($content -notmatch "(?m)^${var}=.+") {
        Write-Error "Заполните переменную $var в .env"
    }
}

if ($content -match '(?m)^CV_USE_GPU=(1|true|yes|on)') {
    $ComposeArgs += @("-f", "docker-compose.gpu.yml")
    Write-Host "==> GPU-режим CV"
}

if (-not (Test-Path "cvService\models\best.onnx")) {
    Write-Warning "cvService\models\best.onnx не найден — CV-сервис может не работать."
}

Write-Host "==> Сборка и запуск production-стека..."
docker compose @ComposeArgs --env-file $EnvFile up -d --build

Start-Sleep -Seconds 5
docker compose @ComposeArgs --env-file $EnvFile ps

$publicUrl = (Select-String -Path $EnvFile -Pattern '^PUBLIC_URL=(.+)$').Matches.Groups[1].Value
Write-Host ""
Write-Host "Готово."
Write-Host "Откройте: $publicUrl"
Write-Host "Дашборд:  $publicUrl/vineyard/"
