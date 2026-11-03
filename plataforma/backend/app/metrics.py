"""
Métricas de un aterrizaje. Cada variable lleva su
fuente en `docs/ciencia.md` y en feedback/rules.yaml.

Entrada: DataFrame con las columnas del firmware (t en s) + las derivadas por
orientation.py (thigh, valgus, lateral). Salida: diccionario plano de métricas
con None cuando una variable no se puede medir.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .bridge import analysis
from .orientation import SegmentTracker

FSR = ["P1_H", "P1_F", "P2_H", "P2_F"]          # izq. talón, izq. antepié, der. talón, der. antepié
IMU_COLS = {k: [f"{k}_{c}" for c in ("ax", "ay", "az", "gx", "gy", "gz")] for k in ("T", "P", "L")}

WIN_POST_S = 0.50        # ítems 2, 4: "en los 500 ms tras el contacto"
WIN_LOAD_S = 0.30        # ítem 8: "carga izquierda vs. derecha en los primeros 300 ms"
WIN_RATE_S = 0.10        # ítem 11: tasa de carga en los primeros 100 ms
SAT_RAW = 4000           # FSR_SATURATION_RAW del firmware


def derive(df: pd.DataFrame) -> pd.DataFrame:
    """Agrega thigh / valgus / lateral (absolutos) con el filtro Mahony en el PC."""
    df = df.copy()
    if "t" not in df:
        df["t"] = (df["t_us"] - df["t_us"].iloc[0]) / 1e6
    if not all(c in df for cols in IMU_COLS.values() for c in cols):
        df["thigh"] = df["valgus"] = df["lateral"] = np.nan
        return df
    tr = SegmentTracker()
    arr = {k: df[v].to_numpy(float) for k, v in IMU_COLS.items()}
    t = df["t"].to_numpy(float)
    out = np.empty((len(df), 3))
    for i in range(len(df)):
        out[i] = tr.step(t[i], {k: tuple(a[i]) for k, a in arr.items()})
    df["thigh"], df["valgus"], df["lateral"] = out[:, 0], out[:, 1], out[:, 2]
    return df


def find_contacts(df: pd.DataFrame) -> list[int]:
    """Índices de contacto inicial: fase de vuelo (plantillas casi descargadas,
    80 ms - 1,5 s) seguida de carga. Mismo criterio que laboratorio/core/analysis.py."""
    if not set(FSR).issubset(df.columns) or len(df) < 50:
        return []
    s = df[FSR].sum(axis=1).to_numpy(float)
    base = np.percentile(s, 75)
    if base <= 0:
        return []
    air = s < 0.08 * base
    t = df["t"].to_numpy(float)
    out, i, n = [], 1, len(s)
    while i < n:
        if air[i - 1] and not air[i] and s[i] > 0.15 * base:
            j0 = i - 1
            while j0 > 0 and air[j0 - 1]:
                j0 -= 1
            if 0.08 <= t[i] - t[j0] <= 1.5:
                out.append(i)
                i += int(0.8 / max(float(np.median(np.diff(t))), 1e-3))
                continue
        i += 1
    return out


def _onset(t, x, level, c, n_after):
    """Instante (s) en que x cruza `level`, interpolado, buscando desde 3 muestras
    antes del contacto. Permite resolver el orden antepié → talón por debajo del
    periodo de muestreo (10 ms a 100 Hz)."""
    lo = max(c - 3, 1)
    for i in range(lo, min(c + n_after, len(x))):
        if x[i] >= level > x[i - 1]:
            return t[i - 1] + (level - x[i - 1]) / (x[i] - x[i - 1]) * (t[i] - t[i - 1])
        if x[i] >= level and i == lo:
            return t[i]
    return None


def landing_metrics(df: pd.DataFrame, c: int, r_div: float = 1000.0) -> dict:
    t = df["t"].to_numpy(float)
    tc = t[c]
    dt = float(np.median(np.diff(t)))
    post = (t >= tc) & (t <= tc + WIN_POST_S)
    ip = np.where(post)[0]
    m: dict = {"t_contacto_s": round(float(tc), 3)}

    # --- vuelo y postura de pie previa (referencia de los ángulos sin tara)
    raw = df[FSR].to_numpy(float)
    force = np.column_stack([analysis.fsr_force_estimate(raw[:, k], r_div) for k in range(4)])
    tot = force.sum(axis=1)
    pre_all = np.where((t < tc - 0.05) & (t >= tc - 3.0))[0]
    s_raw = raw.sum(axis=1)
    thr_air = 0.08 * max(np.percentile(s_raw[pre_all], 75), 1) if len(pre_all) else 1
    # despegue = inicio del tramo sin carga que termina en el contacto (no el primer instante
    # sin carga de la ventana: antes de ponerse de pie también pudo no haber carga)
    t_takeoff = tc - 0.3
    if len(pre_all) and s_raw[pre_all[-1]] < thr_air:
        k = len(pre_all) - 1
        while k > 0 and s_raw[pre_all[k - 1]] < thr_air:
            k -= 1
        t_takeoff = t[pre_all[k]]
    m["vuelo_ms"] = round((tc - t_takeoff) * 1000)
    stand = np.where((t >= t_takeoff - 1.2) & (t < t_takeoff - 0.15))[0]
    if len(stand) < 10:
        stand = pre_all[: max(len(pre_all) // 2, 1)]
    stand_force = np.median(force[stand], axis=0) if len(stand) else np.ones(4)
    stand_total = float(stand_force.sum()) or 1.0

    # --- 1-2 rodilla (knee_flex del firmware, relativo a la tara de pie)
    if "knee_flex" in df:
        k = df["knee_flex"].to_numpy(float)
        ipk = ip[np.argmax(k[ip])]
        m["rodilla_contacto"] = round(float(k[c]), 1)
        m["rodilla_pico"] = round(float(k[ipk]), 1)
        m["rodilla_desplazamiento"] = round(float(k[ipk] - k[c]), 1)
        m["t_pico_rodilla_ms"] = round((t[ipk] - tc) * 1000)
    # --- 3-4 tronco
    if "trunk_flex" in df:
        tr = df["trunk_flex"].to_numpy(float)
        m["tronco_contacto"] = round(float(tr[c]), 1)
        m["tronco_pico"] = round(float(tr[ip].max()), 1)
        m["tronco_desplazamiento"] = round(float(tr[ip].max() - tr[c]), 1)
    # --- 5 cadera aprox. = tronco + inclinación del muslo (ambos respecto a estar de pie)
    if "thigh" in df and np.isfinite(df["thigh"]).all() and "trunk_flex" in df:
        th = df["thigh"].to_numpy(float) - float(np.median(df["thigh"].to_numpy(float)[stand]))
        hip = df["trunk_flex"].to_numpy(float) + th
        m["cadera_contacto"] = round(float(hip[c]), 1)
        m["cadera_pico"] = round(float(hip[ip].max()), 1)
        m["cadera_desplazamiento"] = round(float(hip[ip].max() - hip[c]), 1)
    # --- 6-7 patrón de apoyo y simetría de contacto
    n_after = int(0.15 / dt) + 1
    onset = []
    for k in range(4):
        lvl = 0.25 * max(stand_force[k], 1e-3)
        onset.append(_onset(t, force[:, k], lvl, c, n_after))
    if all(o is not None for o in onset):
        dl = (onset[0] - onset[1]) * 1000          # talón − antepié (izq.)
        dr = (onset[2] - onset[3]) * 1000          # talón − antepié (der.)
        m["antepie_a_talon_ms"] = round(float(np.mean([dl, dr])), 1)
        m["antepie_a_talon_izq_ms"] = round(float(dl), 1)
        m["antepie_a_talon_der_ms"] = round(float(dr), 1)
        m["diferencia_contacto_ms"] = round(abs(min(onset[0], onset[1]) - min(onset[2], onset[3])) * 1000, 1)
    # --- 8 simetría de carga (primeros 300 ms)
    early = (t >= tc) & (t <= tc + WIN_LOAD_S)
    left, right = force[early][:, 0:2].sum(), force[early][:, 2:4].sum()
    if left + right > 0:
        m["lsi_carga_pct"] = round(float(100 * min(left, right) / max(left, right)), 1)
        m["carga_izquierda_pct"] = round(float(100 * left / (left + right)), 1)
    # --- 9 inclinación lateral del tronco
    if "lateral" in df and np.isfinite(df["lateral"]).all():
        lat = df["lateral"].to_numpy(float) - float(np.median(df["lateral"].to_numpy(float)[stand]))
        m["tronco_lateral_max"] = round(float(np.abs(lat[ip]).max()), 1)
    # --- 10 valgo dinámico aprox. (pierna derecha)
    if "valgus" in df and np.isfinite(df["valgus"]).all():
        vg = df["valgus"].to_numpy(float) - float(np.median(df["valgus"].to_numpy(float)[stand]))
        m["valgo_der_max"] = round(float(max(vg[ip].max(), 0.0)), 1)
    # --- 11 carga de impacto (relativa a la carga de pie: los FSR no están calibrados)
    m["carga_pico_rel"] = round(float(tot[ip].max() / stand_total), 2)
    rate_w = np.where((t >= tc) & (t <= tc + WIN_RATE_S))[0]
    if len(rate_w) > 1:
        m["tasa_carga_rel_s"] = round(float(np.max(np.diff(tot[rate_w])) / dt / stand_total), 1)
    # --- calidad de la medición
    flags = df["flags"].to_numpy(int) if "flags" in df else np.zeros(len(df), int)
    w = (t >= tc - 0.1) & (t <= tc + WIN_POST_S)
    m["saturado_pct"] = round(100 * float((raw[w] >= SAT_RAW).any(axis=1).mean()), 1)
    m["error_imu"] = bool((flags[w] & 0b1110000).any())
    m["sin_tara"] = bool((flags[w] & (1 << 10)).any())
    m["calibrando"] = bool((flags[w] & (1 << 9)).any())
    if "seq" in df:
        seq = df["seq"].to_numpy(int)[w]
        m["perdidas"] = int(max(0, seq[-1] - seq[0] + 1 - len(seq))) if len(seq) else 0
    return m


def series(df: pd.DataFrame, c: int, pre_s: float = 0.6, post_s: float = 1.0, r_div: float = 1000.0) -> dict:
    """Serie compacta para la animación 3D (repetición en cámara lenta)."""
    t = df["t"].to_numpy(float)
    tc = t[c]
    w = np.where((t >= tc - pre_s) & (t <= tc + post_s))[0]
    pre = np.where((t >= tc - 2.0) & (t < tc - 0.45))[0]
    raw = df[FSR].to_numpy(float)
    force = np.column_stack([analysis.fsr_force_estimate(raw[:, k], r_div) for k in range(4)])
    sf = np.maximum(np.median(force[pre], axis=0), 1e-3) if len(pre) else np.ones(4)
    out = {"t": [round(float(x - tc), 3) for x in t[w]]}

    def rel(col):
        x = df[col].to_numpy(float)
        return x - (np.median(x[pre]) if len(pre) else 0)

    for key, col in (("knee", "knee_flex"), ("trunk", "trunk_flex")):
        out[key] = [round(float(v), 1) for v in df[col].to_numpy(float)[w]]
    for key in ("thigh", "valgus", "lateral"):
        out[key] = [round(float(v), 1) for v in rel(key)[w]] if key in df and np.isfinite(df[key]).all() else None
    out["fsr"] = [[round(float(v), 2) for v in (force[i] / sf)] for i in w]
    return out


def analyze_dataframe(df: pd.DataFrame, r_div: float = 1000.0) -> list[dict]:
    df = derive(df)
    return [landing_metrics(df, c, r_div) for c in find_contacts(df)]
