# Деплой allVineyardSystem на VPS

Проект разворачивается **одной командой** через Docker Compose: PostgreSQL, MinIO, CV, backend, vineyardApp, frontend и nginx.

## Требования к серверу

- Ubuntu 22.04 / 24.04 (или другой Linux с Docker)
- Минимум **4 GB RAM**, лучше **8 GB** (если используете CV-модель)
- Открыты порты **22** (SSH) и **80** (HTTP)

## 1. Подготовка VPS

```bash
ssh root@ВАШ_IP

apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y git ufw
ufw allow OpenSSH
ufw allow 80
ufw enable
```

## 2. Загрузка проекта

```bash
cd /opt
git clone <URL_ВАШЕГО_РЕПО> allVineyardSystem
cd allVineyardSystem
```

Или с локального ПК:

```bash
rsync -avz --exclude node_modules --exclude .git ./allVineyardSystem/ root@ВАШ_IP:/opt/allVineyardSystem/
```

## 3. Rails secret keys (SECRET_KEY_BASE)

В Docker-деплое **не нужны** `master.key` — используйте `SECRET_KEY_BASE`.

На VPS сгенерируйте два разных секрета:

```bash
openssl rand -hex 64   # → BACKEND_SECRET_KEY_BASE
openssl rand -hex 64   # → VINEYARD_SECRET_KEY_BASE
```

## 4. Настройка `.env`

```bash
cp .env.production.example .env
nano .env
```

Обязательно заполните:

| Переменная | Описание |
|------------|----------|
| `PUBLIC_URL` | `http://ВАШ_IP` или `https://ваш-домен.ru` |
| `POSTGRES_PASSWORD` | Надёжный пароль БД |
| `MINIO_ROOT_PASSWORD` | Пароль MinIO |
| `BACKEND_SECRET_KEY_BASE` | `openssl rand -hex 64` |
| `VINEYARD_SECRET_KEY_BASE` | `openssl rand -hex 64` (другой!) |

## 5. Запуск

```bash
chmod +x deploy.sh
./deploy.sh
```

Или вручную:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

После запуска откройте `PUBLIC_URL` в браузере.

## 6. Первичные данные (опционально)

```bash
docker compose -f docker-compose.prod.yml exec backend bin/rails db:seed
```

## Архитектура

```
Браузер → nginx:80
            ├── /           → frontend (React)
            ├── /api/       → backend (Rails API)
            └── /vineyard/  → vineyardApp (дашборд)

backend  → MinIO, vineyard-app, PostgreSQL
vineyard-app → CV, MinIO, PostgreSQL
cv       → MinIO
```

## Тестовые видео миссии (шарды)

После завершения миссии фронт может показывать реальные ролики с диска вместо фейковых. В `docker-compose.prod.yml` это уже включено по умолчанию.

1. На VPS создайте папку (если её нет после `git pull`):

```bash
mkdir -p /opt/allVineyardSystem/test_mission_shard_videos
```

2. Загрузите `.webm` или `.mp4` **с Windows** (не с VPS):

```powershell
scp "D:\путь\к\видео\*.webm" root@ВАШ_IP:/opt/allVineyardSystem/test_mission_shard_videos/
```

Файлы сортируются по имени — это порядок «рядов» на карте.

3. Пересоберите backend и frontend (флаг VITE зашивается при сборке):

```bash
docker compose -f docker-compose.prod.yml --env-file .env build frontend backend
docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate frontend backend
```

4. Проверка API:

```bash
curl -s http://127.0.0.1/api/v1/test_mission_video_shards
```

Чтобы отключить: в `.env` задайте `ENABLE_TEST_MISSION_VIDEO_SHARDS=false` и `VITE_USE_TEST_MISSION_SHARD_VIDEOS=false`, затем пересоберите frontend и backend.

## MinIO (веб-консоль)

Порты проброшены **только на localhost VPS** (`127.0.0.1`), не в интернет.

1. На Windows откройте SSH-туннель (окно держите открытым):

```powershell
ssh -L 9001:127.0.0.1:9001 -L 9000:127.0.0.1:9000 root@ВАШ_IP
```

2. В браузере: **http://localhost:9001**

3. Логин и пароль — из `.env` на сервере: `MINIO_ROOT_USER` и `MINIO_ROOT_PASSWORD`.

После `git pull` перезапустите MinIO:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d minio
```

## CV-модель (опционально)

Положите веса в `cvService/models/best.onnx`, затем в `.env`:

```env
CV_DUMMY_INFERENCE=false
```

**Ускорение CV на VPS 4 CPU / 6 GB** (уже в `.env.production.example`):

```env
CV_FRAME_INTERVAL=8          # 4=точнее, 12–16=быстрее
CV_ENHANCE_FRAMES=false      # без тяжёлого улучшения кадров
CV_ORT_INTRA_THREADS=4
```

Перезапуск:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build cv vineyard-app
```

## HTTPS (Let's Encrypt)

1. Направьте домен на IP сервера.
2. Установите certbot на **хосте** (не в контейнере):

```bash
apt install -y certbot
certbot certonly --standalone -d ваш-домен.ru
```

3. Обновите `deploy/nginx/default.conf` для SSL или используйте certbot nginx plugin.
4. В `.env` установите:

```env
PUBLIC_URL=https://ваш-домен.ru
BEHIND_SSL_PROXY=true
```

5. Перезапустите: `./deploy.sh`

## Видео в MinIO, но не в vineyardApp / CV

Цепочка: **MinIO** → transcode (`MediaUploadTranscodeJob`) → **vineyard-app** → **cv**.

1. Проверьте, что все сервисы запущены (не только frontend/backend):

```bash
docker compose -f docker-compose.prod.yml ps
```

2. Статус последних загрузок:

```bash
docker compose -f docker-compose.prod.yml exec backend bin/rails runner \
  'MediaUpload.order(:id).last(5).each { |m| p m.slice(:id,:mission_id,:status,:error_message) }'
```

3. Видео в vineyard-app:

```bash
docker compose -f docker-compose.prod.yml exec vineyard-app bin/rails runner \
  'Video.order(:id).last(3).each { |v| p v.slice(:id,:mission_id,:status); p v.video_shards.pluck(:id,:status,:shard_index) }'
```

4. Повторить обработку застрявших файлов:

```bash
docker compose -f docker-compose.prod.yml exec backend bin/rails media_uploads:retry_pipeline
# или для одной миссии:
docker compose -f docker-compose.prod.yml exec backend bin/rails media_uploads:retry_pipeline MISSION_ID=12
```

5. Логи:

```bash
docker compose -f docker-compose.prod.yml logs -f backend vineyard-app cv | grep -E 'Transcode|SendVideo|ProcessVideo|CV'
```

| `media_uploads.status` | Значение |
|------------------------|----------|
| `processing` | Ждёт transcode webm→mp4 |
| `ready` | В MinIO готово, ждёт отправки в vineyard-app |
| `sent_to_vineyard` | Шард передан, CV обрабатывает |
| `failed` | Смотрите `error_message` |

**vineyardApp UI:** URL всегда с префиксом `/vineyard/` (например `/vineyard/video/1`). После обновления: `build vineyard-app` и `up -d --force-recreate nginx vineyard-app`.

## Полезные команды

```bash
# Логи
docker compose -f docker-compose.prod.yml logs -f backend vineyard-app cv nginx

# Rails console
docker compose -f docker-compose.prod.yml exec backend bin/rails console

# Остановка
docker compose -f docker-compose.prod.yml down

# Полная переустановка БД (удалит данные!)
docker compose -f docker-compose.prod.yml down -v
./deploy.sh
```

## Локальная разработка

Для разработки по-прежнему используйте:

```bash
docker compose up -d          # только MinIO + CV
# + rails s в backend и vineyardApp, npm run dev во frontend
```

## Устранение проблем

| Симптом | Решение |
|---------|---------|
| CORS error | Проверьте `PUBLIC_URL` в `.env` (должен совпадать с URL в браузере) |
| `InvalidMessage` / `key must be 16 bytes` | Удалите `RAILS_MASTER_KEY*` из `.env`. Задайте только `BACKEND_SECRET_KEY_BASE` и `VINEYARD_SECRET_KEY_BASE` через `openssl rand -hex 64`. Пересоберите: `build --no-cache backend vineyard-app` |
| backend не стартует | `docker compose logs backend` — проверьте `SECRET_KEY_BASE` (128 hex-символов, не master.key) |
| CV не отвечает | `docker compose logs cv` |
| 502 от nginx | Дождитесь запуска backend/vineyard-app: `docker compose ps` |
| Видео в MinIO, нет в vineyardApp | `media_uploads:retry_pipeline`, проверьте `vineyard-app` и `cv` в `docker compose ps` |
| vineyardApp без стилей | Пересоберите vineyard-app (`RAILS_RELATIVE_URL_ROOT=/vineyard`), URL: `/vineyard/` |
