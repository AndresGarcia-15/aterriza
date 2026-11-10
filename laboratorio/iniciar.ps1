# Inicia el Laboratorio biomecánico (Dash) y abre el navegador en http://127.0.0.1:8050 · Windows
# Doble clic: «Abrir laboratorio (Windows).cmd»
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:PYTHONUTF8 = "1"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Host "Instalando uv (gestor de Python, instalador oficial de astral.sh)…"
  powershell -ExecutionPolicy ByPass -NoProfile -Command "irm https://astral.sh/uv/install.ps1 | iex"
  $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}
Write-Host "Iniciando el laboratorio… (la primera vez descarga dependencias, ~1 min)"
uv run --python 3.12 --with "dash==2.18.2" --with "plotly==5.24.1" --with pandas --with numpy --with pyserial --with flask-compress python app.py
