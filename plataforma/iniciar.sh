#!/bin/sh
# Aterriza — plataforma de retroalimentación del aterrizaje (UTB) · macOS y Linux
# (en Windows: iniciar.ps1 o doble clic en «Abrir Aterriza (Windows).cmd»)
#   ./iniciar.sh          compila el frontend (si hace falta) y abre http://127.0.0.1:8000
#   ./iniciar.sh red      igual, pero accesible desde otros equipos (Tailscale / LAN)
#   ./iniciar.sh dev      modo desarrollo con recarga en caliente (Vite :5173 + API :8000)
set -e
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin:$PATH"

if ! command -v uv >/dev/null 2>&1; then
  echo "→ Instalando uv (gestor de Python, instalador oficial de astral.sh)…"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
if ! command -v npm >/dev/null 2>&1; then
  case "$(uname -s)" in
    Darwin) echo "Falta Node.js (versión 20 o superior): brew install node   o   https://nodejs.org" ;;
    *)      echo "Falta Node.js (versión 20 o superior): https://nodejs.org  (o el gestor de paquetes de tu distribución)" ;;
  esac
  exit 1
fi

echo "→ Preparando Python (la primera vez tarda ~1 min)…"
(cd backend && uv sync --python 3.12 -q)

if [ ! -d frontend/node_modules ]; then
  echo "→ Instalando dependencias del frontend…"
  (cd frontend && npm ci --silent)
fi

MODE="${1:-}"
if [ "$MODE" = "dev" ]; then
  (cd backend && uv run uvicorn app.main:app --port 8000 --reload) &
  API=$!
  trap 'kill $API 2>/dev/null' EXIT INT TERM
  cd frontend && npx vite --open
  exit 0
fi

if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src -newer frontend/dist/index.html -print -quit)" ]; then
  echo "→ Compilando la interfaz…"
  (cd frontend && npx vite build --logLevel error)
fi

HOST=127.0.0.1
if [ "$MODE" = "red" ]; then
  HOST=0.0.0.0
  TS=$(command -v tailscale >/dev/null 2>&1 && tailscale ip -4 2>/dev/null | head -1)
  [ -n "$TS" ] && echo "→ Por Tailscale: http://$TS:8000"
fi
echo "→ Abriendo http://127.0.0.1:8000  (Ctrl+C para detener)"
ABRIR=$(command -v open || command -v xdg-open || true)
[ -n "$ABRIR" ] && (sleep 2 && "$ABRIR" "http://127.0.0.1:8000" >/dev/null 2>&1) &
cd backend && exec uv run uvicorn app.main:app --host "$HOST" --port 8000 --log-level warning
