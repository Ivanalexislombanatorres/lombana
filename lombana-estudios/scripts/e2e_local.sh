#!/usr/bin/env bash
# Ejecuta las pruebas de navegador contra un servidor nuevo con datos temporales.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')"
cd "$ROOT/backend"
LOMBANA_DATA_DIR="$TMP/data" LOMBANA_BACKUPS_DIR="$TMP/backups" python3 -m uvicorn app.main:app --host 127.0.0.1 --port $PORT > "$TMP/server.log" 2>&1 &
PID=$!
trap "kill $PID; wait $PID 2>/dev/null; rm -rf $TMP" EXIT
for i in $(seq 1 30); do curl -sf http://127.0.0.1:$PORT/api/health >/dev/null && break; sleep 0.5; done
cd "$ROOT" && LOMBANA_E2E_URL=http://127.0.0.1:$PORT python3 -m pytest tests/e2e -q "$@"
