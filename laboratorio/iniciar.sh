#!/bin/sh
# Inicia el Laboratorio biomecánico (Dash) y abre el navegador en http://127.0.0.1:8050
# macOS y Linux (en Windows: iniciar.ps1 o doble clic en «Abrir laboratorio (Windows).cmd»)
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  echo "Instalando uv (gestor de Python, instalador oficial de astral.sh)…"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
echo "Iniciando el laboratorio… (la primera vez descarga dependencias, ~1 min)"
exec uv run --python 3.12 --with "dash==2.18.2" --with "plotly==5.24.1" --with pandas --with numpy --with pyserial --with flask-compress python app.py
