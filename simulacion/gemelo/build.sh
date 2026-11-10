#!/bin/sh
# Compila el gemelo digital (macOS / Linux). La lógica vive en build.py, que también
# funciona en Windows:  python build.py
set -e
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then exec python3 build.py "$@"; fi
exec uv run --no-project python build.py "$@"
