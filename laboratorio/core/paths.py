"""Rutas del proyecto (todo relativo a la carpeta 'Proyecto Biomecanica')."""
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent
PROJECT = LAB.parent
FIRMWARE = PROJECT / "firmware"
SIM = PROJECT / "simulacion"
GEMELO = SIM / "gemelo"
ENSAYOS = LAB / "ensayos"
CACHE = LAB / ".cache"
LOGGER_ENSAYOS = FIRMWARE / "tools" / "ensayos"   # ensayos grabados con logger.py

for p in (ENSAYOS, CACHE):
    p.mkdir(parents=True, exist_ok=True)
