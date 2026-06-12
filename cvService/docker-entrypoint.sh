#!/bin/sh
set -e

WORKERS="${CV_UVICORN_WORKERS:-1}"
# uvicorn требует целое >= 1
case "$WORKERS" in
  ''|*[!0-9]*)
    WORKERS=1
    ;;
  0)
    WORKERS=1
    ;;
esac

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "$WORKERS"
