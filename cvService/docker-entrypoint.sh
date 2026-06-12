#!/bin/sh
set -e

# Несколько uvicorn workers = несколько копий ONNX + риск гонок трекера.
# Для корректного подсчёта кустов держим 1 worker (как preddeploy).
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
