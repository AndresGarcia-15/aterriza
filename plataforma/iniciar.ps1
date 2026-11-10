# Aterriza — plataforma de retroalimentación del aterrizaje (UTB) · Windows
#   .\iniciar.ps1          compila la interfaz (si hace falta) y abre http://127.0.0.1:8000
#   .\iniciar.ps1 red      igual, pero accesible desde otros equipos (Tailscale / LAN)
#   .\iniciar.ps1 dev      desarrollo con recarga en caliente (Vite :5173 + API :8000)
# Doble clic: «Abrir Aterriza (Windows).cmd»
param([string]$Modo = "")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:PYTHONUTF8 = "1"

function Tiene($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

if (-not (Tiene "uv")) {
  Write-Host "→ Instalando uv (gestor de Python, instalador oficial de astral.sh)…"
  powershell -ExecutionPolicy ByPass -NoProfile -Command "irm https://astral.sh/uv/install.ps1 | iex"
  $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}
if (-not (Tiene "npm")) {
  Write-Host "Falta Node.js (versión 20 o superior). Instálalo con:  winget install OpenJS.NodeJS.LTS"
  Write-Host "y vuelve a abrir esta ventana."
  exit 1
}

Write-Host "→ Preparando Python (la primera vez tarda ~1 min)…"
Push-Location backend; uv sync --python 3.12 -q; Pop-Location
if ($LASTEXITCODE -ne 0) { throw "uv sync falló" }

if (-not (Test-Path frontend\node_modules)) {
  Write-Host "→ Instalando dependencias de la interfaz…"
  Push-Location frontend; npm ci --silent; Pop-Location
}

if ($Modo -eq "dev") {
  $api = Start-Process -PassThru -NoNewWindow -WorkingDirectory backend uv "run uvicorn app.main:app --port 8000 --reload"
  try { Push-Location frontend; npx vite --open } finally { Pop-Location; Stop-Process -Id $api.Id -ErrorAction SilentlyContinue }
  exit 0
}

$index = "frontend\dist\index.html"
$viejo = -not (Test-Path $index)
if (-not $viejo) {
  $t = (Get-Item $index).LastWriteTime
  $viejo = [bool](Get-ChildItem frontend\src -Recurse -File | Where-Object { $_.LastWriteTime -gt $t } | Select-Object -First 1)
}
if ($viejo) {
  Write-Host "→ Compilando la interfaz…"
  Push-Location frontend; npx vite build --logLevel error; Pop-Location
}

$hostIp = "127.0.0.1"
if ($Modo -eq "red") {
  $hostIp = "0.0.0.0"
  if (Tiene "tailscale") { Write-Host "→ Por Tailscale: http://$((tailscale ip -4) | Select-Object -First 1):8000" }
}
Write-Host "→ Abriendo http://127.0.0.1:8000  (Ctrl+C para detener)"
Start-Job { Start-Sleep 2; Start-Process "http://127.0.0.1:8000" } | Out-Null
Set-Location backend
uv run uvicorn app.main:app --host $hostIp --port 8000 --log-level warning
