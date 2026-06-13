#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env"
COMPOSE_ARGS=(-f docker-compose.prod.yml -f docker-compose.local.yml)

if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.local.example "$ENV_FILE"
  echo "Создан $ENV_FILE из .env.local.example"
fi

if [[ ! -f cvService/models/best.onnx ]]; then
  echo "WARN: нет cvService/models/best.onnx"
fi

if grep -Eq '^CV_USE_GPU=(1|true|yes|on)' "$ENV_FILE" 2>/dev/null; then
  COMPOSE_ARGS+=(-f docker-compose.gpu.yml)
  echo "GPU: docker-compose.gpu.yml"
fi

echo "==> docker compose up --build"
docker compose "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" up -d --build
sleep 8
docker compose "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" ps

echo
echo "Сайт:        http://localhost:8080"
echo "VineyardApp: http://localhost:8080/vineyard/"
echo "CV:          http://127.0.0.1:8000/"
