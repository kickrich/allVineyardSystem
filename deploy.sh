#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Файл .env не найден."
  echo "Скопируйте шаблон: cp .env.production.example .env"
  exit 1
fi

require_var() {
  local name="$1"
  if ! grep -q "^${name}=.\+" "$ENV_FILE" 2>/dev/null; then
    echo "Заполните переменную ${name} в .env"
    exit 1
  fi
}

require_var POSTGRES_PASSWORD
require_var MINIO_ROOT_PASSWORD
require_var BACKEND_SECRET_KEY_BASE
require_var VINEYARD_SECRET_KEY_BASE
require_var PUBLIC_URL

echo "==> Сборка и запуск production-стека..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

echo "==> Ожидание healthcheck PostgreSQL..."
sleep 5

echo "==> Проверка контейнеров..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

echo
echo "Готово."
echo "Откройте в браузере: $(grep '^PUBLIC_URL=' "$ENV_FILE" | cut -d= -f2-)"
echo
echo "Полезные команды:"
echo "  docker compose -f $COMPOSE_FILE logs -f nginx backend vineyard-app cv"
echo "  docker compose -f $COMPOSE_FILE exec backend bin/rails db:seed"
echo "  docker compose -f $COMPOSE_FILE down"
