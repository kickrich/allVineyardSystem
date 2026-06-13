# Локальный запуск allVineyardSystem (как на deploy)

Поднимает **тот же** production-стек, что на VPS: postgres, MinIO, CV, backend, vineyardApp, frontend, nginx.

## Требования

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/macOS) или Docker Engine (Linux)
- Модель **`cvService/models/best.onnx`** (не в git — положите вручную)
- Опционально: видео в **`test_mission_shard_videos/`** для тестовых миссий

## Быстрый старт (Windows)

```powershell
cd D:\misha\VKR\Diplom\1234\allVineyardSystem
.\local-dev.ps1
```

Первый запуск создаст `.env` из `.env.local.example`.

Откройте в браузере:

| URL | Назначение |
|-----|------------|
| http://localhost:8080 | Frontend + API |
| http://localhost:8080/vineyard/ | Дашборд CV / шарды |
| http://127.0.0.1:8000/ | CV service (JSON, `onnx_providers`) |
| http://127.0.0.1:9001 | MinIO Console |

## Linux / macOS

```bash
chmod +x local-dev.sh
./local-dev.sh
```

## GPU локально (NVIDIA + Docker)

В `.env`:

```env
CV_USE_GPU=true
```

Нужен [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) / GPU в Docker Desktop.

Скрипт автоматически добавит `docker-compose.gpu.yml`.

## Ручной запуск

```powershell
copy .env.local.example .env
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml --env-file .env up -d --build
```

С GPU:

```powershell
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml -f docker-compose.gpu.yml --env-file .env up -d --build cv
```

## Проверка CV после обработки шарда

```powershell
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml exec vineyard-app bin/rails runner "
  s = VideoShard.where(status: 2).order(:id).last
  puts \"bushes=#{s.bushes_count} gaps=#{s.gaps_count}\"
  puts \"time=#{s.result_json&.dig('video_info', 'processing_time')}\"
  puts s.result_json&.dig('tracking_stats').inspect
"
```

```powershell
curl http://127.0.0.1:8000/
```

## Остановка

```powershell
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml down
```

Данные БД/MinIO сохраняются в Docker volumes. Полный сброс:

```powershell
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml down -v
```

## Сравнение с VPS

| Параметр | Локально (.env.local.example) | VPS |
|----------|-------------------------------|-----|
| `PUBLIC_URL` | http://localhost:8080 | http://IP |
| `HTTP_PORT` | 8080 | 80 |
| Образ CV CPU | `Dockerfile` | `Dockerfile` или `Dockerfile.gpu` |

Код CV монтируется с диска (`cvService/app`) — изменения в Python без пересборки: `docker compose ... restart cv`.
