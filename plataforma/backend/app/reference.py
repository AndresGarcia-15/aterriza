"""
Aterrizaje de referencia ("fantasma"): se genera con el escenario CONTROLADO del
gemelo digital (firmware real + modelo de aterrizaje) y se ajusta a la técnica
objetivo (docs/ciencia.md):
  - rodilla ≥ 30° en el contacto (LESS ítem 1) y ≥ 75° de pico,
  - tronco flexionado (≥ 10°) en el contacto (LESS ítem 3; Blackburn & Padua).
El ajuste suma un desfase que crece durante el vuelo (preparación) y se disipa
hasta el pico de flexión, de modo que la forma de la curva es la del gemelo.
"""
from __future__ import annotations

import math
from functools import lru_cache

import pandas as pd

from .demo import DATA, ensure_data
from .metrics import derive, find_contacts, landing_metrics, series

KNEE_CONTACT_TARGET = 32.0
TRUNK_CONTACT_TARGET = 11.0


def _w(t: float, t0: float, tpk: float) -> float:
    if t <= t0:
        return 0.0
    if t < 0:
        return 0.5 * (1 - math.cos(math.pi * (t - t0) / -t0))
    if t < tpk:
        return 0.5 * (1 + math.cos(math.pi * t / tpk))
    return 0.0


@lru_cache(maxsize=1)
def reference() -> dict:
    ensure_data()
    df = pd.read_csv(DATA / "esc0.csv")
    df["t"] = (df["t_us"] - df["t_us"].iloc[0]) / 1e6
    df = derive(df)
    c = find_contacts(df)[0]
    m = landing_metrics(df, c)
    s = series(df, c)
    dk = KNEE_CONTACT_TARGET - m["rodilla_contacto"]
    dtr = TRUNK_CONTACT_TARGET - m["tronco_contacto"]
    t0 = -m["vuelo_ms"] / 1000
    tpk = m["t_pico_rodilla_ms"] / 1000
    for i, t in enumerate(s["t"]):
        w = _w(t, t0, tpk)
        s["knee"][i] = round(s["knee"][i] + dk * w, 1)
        s["trunk"][i] = round(s["trunk"][i] + dtr * w, 1)
        if s["thigh"]:
            s["thigh"][i] = round(s["thigh"][i] + 0.55 * dk * w, 1)
    ik = max(range(len(s["t"])), key=lambda i: s["knee"][i] if 0 <= s["t"][i] <= 0.5 else -1e9)
    return {"serie": s, "contacto": {"rodilla": KNEE_CONTACT_TARGET, "tronco": TRUNK_CONTACT_TARGET},
            "pico": {"rodilla": s["knee"][ik], "tronco": max(s["trunk"]), "t": s["t"][ik]},
            "origen": "Gemelo digital, escenario controlado, ajustado a LESS ítems 1 y 3"}
