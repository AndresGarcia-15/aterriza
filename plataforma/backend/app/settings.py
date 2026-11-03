"""Configuración local (data/config.json). El PIN protege el Modo profesional."""
from __future__ import annotations

import json
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "data" / "config.json"
DEFAULT = {
    "pin": "2468",            # cambiarlo en Modo profesional
    "r_div": 1000.0,          # divisor de los FSR en ohm (el gemelo recomienda 1 kΩ)
    "fsr_calibrado": False,   # mientras sea False la carga se reporta "relativa"
    "objetivo_saltos": 3,
    "modo_salto": "cajon",     # cajon = caída desde el cajón (protocolo LESS) · sitio = salto vertical en el sitio
}
_cache: dict | None = None


def get() -> dict:
    global _cache
    if _cache is None:
        data = dict(DEFAULT)
        if PATH.exists():
            try:
                data.update(json.loads(PATH.read_text()))
            except json.JSONDecodeError:
                pass
        _cache = data
    return _cache


def update(changes: dict) -> dict:
    global _cache
    data = dict(get())
    for k, v in changes.items():
        if k in DEFAULT and v is not None:
            data[k] = type(DEFAULT[k])(v)
    PATH.parent.mkdir(exist_ok=True)
    PATH.write_text(json.dumps(data, indent=2))
    _cache = data
    return data
