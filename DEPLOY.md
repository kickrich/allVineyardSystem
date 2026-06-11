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

## 3. Rails master keys

На **локальной машине** (где вы разрабатываете) найдите ключи:

```bash
cat backend/config/master.key
cat vineyardApp/config/master.key
```

Если файлов нет — создайте:

```bash
cd backend && bin/rails credentials:edit
cd ../vineyardApp && bin/rails credentials:edit
```

Скопируйте значения `master.key` — они понадобятся в `.env`.

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
| `BACKEND_RAILS_MASTER_KEY` | из `backend/config/master.key` |
| `VINEYARD_RAILS_MASTER_KEY` | из `vineyardApp/config/master.key` |

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

## CV-модель (опционально)

Положите веса в `cvService/models/best.onnx`, затем в `.env`:

```env
CV_DUMMY_INFERENCE=false
```

Перезапуск:

```bash
docker compose -f docker-compose.prod.yml up -d --build cv
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
| backend не стартует | `docker compose logs backend` — часто неверный `BACKEND_RAILS_MASTER_KEY` |
| CV не отвечает | `docker compose logs cv` |
| 502 от nginx | Дождитесь запуска backend/vineyard-app: `docker compose ps` |
