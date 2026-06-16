# Деплой allVineyardSystem на VPS

Проект разворачивается **одной командой** через Docker Compose: PostgreSQL, MinIO, CV, backend, vineyardApp, frontend и nginx.

Локальная разработка по-прежнему: `docker compose up -d` (только MinIO + CV) + Rails/npm на хосте.

## Требования к серверу

- Ubuntu 22.04 / 24.04 (или другой Linux с Docker)
- Минимум **4 GB RAM**, лучше **8 GB** (с CV-моделью)
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
git clone -b allVineyardSystem-deploy2 https://github.com/kickrich/allVineyardSystem.git
cd allVineyardSystem
```

## 3. Секреты (SECRET_KEY_BASE)

В Docker-деплое **не нужны** `master.key` — используйте `SECRET_KEY_BASE`:

```bash
openssl rand -hex 64   # → BACKEND_SECRET_KEY_BASE
openssl rand -hex 64   # → VINEYARD_SECRET_KEY_BASE
```

## 4. Настройка `.env`

```bash
cp .env.production.example .env
nano .env
```

| Переменная | Описание |
|------------|----------|
| `PUBLIC_URL` | `http://ВАШ_IP` или `https://ваш-домен.ru` |
| `POSTGRES_PASSWORD` | Надёжный пароль БД |
| `MINIO_ROOT_PASSWORD` | Пароль MinIO |
| `BACKEND_SECRET_KEY_BASE` | `openssl rand -hex 64` |
| `VINEYARD_SECRET_KEY_BASE` | другой `openssl rand -hex 64` |
| `VITE_VIDEO_FROM_FOLDER` | `true` — после миссии грузить `.mp4` из `local_videos/` в MinIO (нужна **пересборка** frontend) |

Положите модель CV: `cvService/models/best.onnx`

Тестовые видео: `.mp4`/`.webm` в `local_videos/` (на VPS: `/opt/allVineyardSystem/local_videos/`). В git видео не попадают — скопируйте через SFTP. Имена: `row_1.mp4`, `row_2.mp4` или по алфавиту.

После изменения `VITE_VIDEO_FROM_FOLDER` пересоберите frontend:

```bash
docker compose -f docker-compose.prod.yml build --no-cache frontend
docker compose -f docker-compose.prod.yml up -d frontend nginx
```

## 5. Запуск

```bash
chmod +x deploy.sh
./deploy.sh
```

Windows (PowerShell):

```powershell
copy .env.production.example .env
# заполните .env
.\deploy.ps1
```

Или вручную:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Откройте `PUBLIC_URL` в браузере. Дашборд vineyardApp: `PUBLIC_URL/vineyard/`

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

## MinIO (веб-консоль)

Порты проброшены только на localhost VPS. С Windows:

```powershell
ssh -L 9001:127.0.0.1:9001 -L 9000:127.0.0.1:9000 root@ВАШ_IP
```

Консоль: http://localhost:9001 (логин из `.env`: `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`)

## CV на GPU (NVIDIA)

1. Установите [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) на хосте
2. В `.env`: `CV_USE_GPU=true`
3. Перезапуск: `./deploy.sh`

## HTTPS

1. Направьте домен на IP сервера
2. В `.env`:

```env
PUBLIC_URL=https://ваш-домен.ru
BEHIND_SSL_PROXY=true
```

3. Настройте SSL на хосте (certbot) и перезапустите: `./deploy.sh`

## Полезные команды

```bash
# Логи
docker compose -f docker-compose.prod.yml logs -f nginx backend vineyard-app cv

# Rails console
docker compose -f docker-compose.prod.yml exec backend bin/rails console

# Остановка
docker compose -f docker-compose.prod.yml down

# Полная переустановка БД (удалит данные!)
docker compose -f docker-compose.prod.yml down -v
./deploy.sh
```

## Устранение проблем

| Симптом | Решение |
|---------|---------|
| CORS error | `PUBLIC_URL` в `.env` должен совпадать с URL в браузере |
| `key must be 16 bytes` | Удалите `RAILS_MASTER_KEY*` из `.env`, используйте только `SECRET_KEY_BASE` |
| backend не стартует | `docker compose logs backend` — проверьте `SECRET_KEY_BASE` (128 hex-символов) |
| CV не отвечает | Проверьте `cvService/models/best.onnx` и `docker compose logs cv` |
| 502 от nginx | Подождите 1–2 мин или `docker compose restart nginx` |
| vineyardApp без стилей | Пересоберите: `docker compose -f docker-compose.prod.yml build vineyard-app` |
