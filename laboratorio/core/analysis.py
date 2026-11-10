"""
Análisis de ensayos: lectura de los archivos, detección de aterrizajes y
variables biomecánicas (Documentación Maestra, secciones 13-15).
La carga se reporta en cuentas del ADC o como "carga instrumentada estimada"
con la curva NOMINAL del FSR 402: hasta calibrar cada sensor no es una fuerza
de reacción del suelo medida.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import paths

FSR = ["P1_H", "P1_F", "P2_H", "P2_F"]


def list_ensayos() -> list[dict]:
    items = []
    for folder in (paths.ENSAYOS, paths.LOGGER_ENSAYOS):
        if not folder.exists():
            continue
        for csv in folder.glob("*.csv"):
            meta = {}
            j = csv.with_suffix(".json")
            if j.exists():
                try:
                    meta = json.loads(j.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    pass
            items.append({"path": str(csv), "name": csv.stem, "mtime": csv.stat().st_mtime,
                          "participante": meta.get("participante", "?"), "ensayo": meta.get("ensayo", csv.stem),
                          "fecha": meta.get("fecha", ""), "muestras": meta.get("muestras"),
                          "fuente": meta.get("fuente", ""), "grabando": not j.exists()})
    return sorted(items, key=lambda d: d["mtime"], reverse=True)


def load(path: str) -> tuple[pd.DataFrame, dict]:
    df = pd.read_csv(path)
    df = df.apply(pd.to_numeric, errors="coerce").dropna(how="all")
    if "t_us" in df:
        df["t"] = (df["t_us"] - df["t_us"].iloc[0]) / 1e6
    meta = {}
    j = Path(path).with_suffix(".json")
    if j.exists():
        try:
            meta = json.loads(j.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return df, meta


def fsr_force_estimate(raw, r_div: float):
    """Inversa de la curva nominal del FSR 402 con el divisor de r_div ohm
    (ESP32 a 11 dB: 0-3,1 V → 0-4095). Solo una estimación."""
    v = np.asarray(raw, dtype=float) / 4095.0 * 3.1
    with np.errstate(divide="ignore", invalid="ignore"):
        r = r_div * (3.3 / np.maximum(v, 1e-6) - 1.0)
        f = np.where(r >= 1000, 10000.0 / r, 10.0 * (np.maximum(r, 150) / 1000.0) ** (-1 / 0.6))
    return np.where(v < 0.005, 0.0, f)


def detect_landings(df: pd.DataFrame) -> list[dict]:
    """Aterrizaje = fase de vuelo (plantillas casi descargadas) seguida de contacto."""
    if not set(FSR).issubset(df.columns) or len(df) < 50:
        return []
    s = df[FSR].sum(axis=1).to_numpy()
    base = np.percentile(s, 75)
    if base <= 0:
        return []
    air = s < 0.08 * base
    t = df["t"].to_numpy()
    out = []
    i, n = 1, len(s)
    while i < n:
        if air[i - 1] and not air[i] and s[i] > 0.15 * base:
            j0 = i - 1
            while j0 > 0 and air[j0 - 1]:
                j0 -= 1
            flight = t[i] - t[j0]
            if 0.08 <= flight <= 1.5:
                out.append(_landing_metrics(df, i, flight))
                i += int(0.8 / max(np.median(np.diff(t)), 1e-3))
                continue
        i += 1
    return out


def _landing_metrics(df, c, flight):
    t = df["t"].to_numpy()
    w = (t >= t[c]) & (t <= t[c] + 1.0)
    early = (t >= t[c]) & (t <= t[c] + 0.30)
    d = {"t_contacto_s": round(float(t[c]), 3), "vuelo_ms": round(flight * 1000)}
    if "knee_flex" in df:
        k = df["knee_flex"].to_numpy()
        kw = np.where(w)[0]
        ipk = kw[np.argmax(k[kw])]
        d.update({"rodilla_contacto": round(float(k[c]), 1), "rodilla_pico": round(float(k[ipk]), 1),
                  "absorcion_ms": round((t[ipk] - t[c]) * 1000)})
    if "trunk_flex" in df:
        d["tronco_pico"] = round(float(df["trunk_flex"].to_numpy()[w].max()), 1)
    raw = df[FSR].to_numpy()
    d["fsr_pico_cuentas"] = int(raw[w].sum(axis=1).max())
    d["saturado_pct"] = round(100 * float((raw[w] >= 4000).any(axis=1).mean()), 1)
    left = raw[early][:, 0:2].sum()
    right = raw[early][:, 2:4].sum()
    d["asimetria_pct"] = round(float(100 * (left - right) / (left + right)), 1) + 0.0 if left + right > 0 else None
    return d


def summary(df: pd.DataFrame, meta: dict) -> dict:
    out = {"muestras": len(df)}
    if "t" in df and len(df) > 1:
        dur = float(df["t"].iloc[-1])
        out["duracion_s"] = round(dur, 1)
        out["frecuencia_hz"] = round((len(df) - 1) / dur, 1) if dur > 0 else 0
    if "seq" in df and len(df) > 1:
        out["perdidas"] = int(max(0, df["seq"].iloc[-1] - df["seq"].iloc[0] + 1 - len(df)))
    if set(FSR).issubset(df.columns):
        out["saturado_pct"] = round(100 * float((df[FSR] >= 4000).any(axis=1).mean()), 1)
    out["fuente"] = meta.get("fuente", "")
    return out
