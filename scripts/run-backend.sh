#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
case "$action" in
  python-path|api|worker|migrate) shift ;;
  *)
    echo 'Usage: bash scripts/run-backend.sh {python-path|api|worker|migrate} [module options]' >&2
    exit 2
    ;;
esac

if [[ "$action" != python-path && "${GEOJSON_DATABASE_PATH:-}" != /* ]]; then
  echo 'Set GEOJSON_DATABASE_PATH to an explicit absolute path before starting the backend.' >&2
  exit 2
fi

runtime_python="${GEOJSON_RUNTIME_PY:-$HOME/Library/Application Support/GeoJSONEditor/Runtimes/cpython-3.13.18-sqlite-3.53.1/venv/bin/python}"
if [[ "$runtime_python" != /* || ! -f "$runtime_python" || ! -x "$runtime_python" ]]; then
  printf 'Python runtime not found or not executable: %s\n' "$runtime_python" >&2
  echo 'Install the runtime described in docs/RUNBOOK.md or set GEOJSON_RUNTIME_PY.' >&2
  exit 1
fi

"$runtime_python" -I -B - <<'PY'
import sqlite3
import sys

python = ".".join(str(value) for value in sys.version_info[:3])
sqlite = sqlite3.sqlite_version
if (python, sqlite) != ("3.13.18", "3.53.1"):
    sys.exit(f"Runtime mismatch: expected Python 3.13.18 / SQLite 3.53.1, found Python {python} / SQLite {sqlite}")
PY

if [[ "$action" == python-path ]]; then
  printf '%s\n' "$runtime_python"
  exit 0
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../backend"
export PYTHONDONTWRITEBYTECODE=1
case "$action" in
  api) exec "$runtime_python" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 "$@" ;;
  worker) exec "$runtime_python" -m app.workers.import_worker --poll-interval 0.25 "$@" ;;
  migrate) exec "$runtime_python" -m alembic upgrade head "$@" ;;
esac
