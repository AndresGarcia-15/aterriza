"""
Banco de pruebas (sin atleta).

1. `BancoVirtualSource`: un ESP32 virtual que entrega el CSV EXACTO del firmware
   (36 columnas, 100 Hz, mismos flags y comandos), pero cuyas plantillas y IMU se
   manejan desde la interfaz (clic en los sensores 3D, teclado, botones). Sirve
   para probar la plataforma sin hardware y para ensayar la prueba guiada.
2. `filtrar_metricas`: en el banco no siempre están las 3 IMU conectadas. Las
   variables que dependen de una IMU ausente se marcan como "no disponibles"
   (el motor las excluye del índice) en vez de invalidar todo el salto.
"""
from __future__ import annotations

import math
import random
import threading
import time
from collections import deque

FSR = ["P1_H", "P1_F", "P2_H", "P2_F"]
IMUS = ("T", "P", "L")
COLS = (["seq", "t_us", *FSR]
        + [f"{k}_{c}" for k in IMUS for c in ("ax", "ay", "az", "gx", "gy", "gz", "mx", "my", "mz")]
        + ["knee_flex", "trunk_flex", "flags"])
REPOSO, PRESION = 12.0, 2500.0
GIRO_S, GIRO_DEG = 1.6, 80.0          # giro de prueba: sube 80° y vuelve en 1,6 s
NOMBRE_BANCO = "Banco de pruebas"
MARCA_BANCO = "__banco__"             # valor de Atleta.deporte que identifica al atleta del banco


class BancoVirtualSource:
    label = "banco virtual (sensores simulados en el PC)"

    def __init__(self, imu: dict | None = None):
        self.lock = threading.Lock()
        self.target = [REPOSO] * 4
        self.cur = [REPOSO] * 4
        self.imu_on = {k: True for k in IMUS} if imu is None else {k: bool(imu.get(k, True)) for k in IMUS}
        self.giro: dict[str, float] = {}
        self.tared = False
        self.pending = deque(["#BOOT Banco virtual: ESP32 simulado (mismo CSV que el firmware)",
                              "#COLS," + ",".join(COLS)])
        self.seq = 0
        self.t0 = time.monotonic()
        self.rng = random.Random(7)

    # ---- control desde la interfaz
    def set(self, fsr=None, imu=None, giro=None):
        with self.lock:
            if fsr is not None:
                for i, v in enumerate(list(fsr)[:4]):
                    if v is None:
                        continue
                    if isinstance(v, bool):
                        self.target[i] = PRESION if v else REPOSO
                    else:
                        self.target[i] = max(0.0, min(4095.0, float(v)))
            if imu is not None:
                for k, v in imu.items():
                    if k in self.imu_on:
                        self.imu_on[k] = bool(v)
            if giro in IMUS:
                self.giro[giro] = time.monotonic()

    def estado(self) -> dict:
        with self.lock:
            return {"fsr": [round(x) for x in self.target], "imu": dict(self.imu_on)}

    def _theta(self, k: str, now: float) -> tuple[float, float]:
        t0 = self.giro.get(k)
        if t0 is None:
            return 0.0, 0.0
        u = (now - t0) / GIRO_S
        if u >= 1:
            self.giro.pop(k, None)
            return 0.0, 0.0
        th = GIRO_DEG * math.sin(math.pi * u)
        dth = GIRO_DEG * math.pi / GIRO_S * math.cos(math.pi * u)
        return th, dth

    # ---- interfaz de fuente para core.link.Link
    def readline(self) -> str | None:
        if self.pending:
            return self.pending.popleft()
        t_virtual = self.seq * 0.01
        wait = self.t0 + t_virtual - time.monotonic()
        if wait > 0:
            time.sleep(min(wait, 0.05))
            if wait > 0.05:
                return None
        g = self.rng.gauss
        with self.lock:
            a = 1 - math.exp(-0.01 / 0.012)
            raw = []
            for i in range(4):
                self.cur[i] += (self.target[i] - self.cur[i]) * a
                raw.append(int(max(0, min(4095, self.cur[i] + g(0, 4)))))
            now = self.t0 + t_virtual
            vals, flags, th = [], 0, {}
            for n, k in enumerate(IMUS):
                if not self.imu_on[k]:
                    vals += [0.0] * 9
                    flags |= 1 << (4 + n)
                    th[k] = None
                    continue
                t, dt = self._theta(k, now)
                th[k] = t
                s, c = math.sin(math.radians(t)), math.cos(math.radians(t))
                # placa de canto con X hacia arriba (como en el prototipo y sobre el cuerpo),
                # girando sobre su eje Y: el "arriba" en ejes del sensor es (cos θ, 0, sen θ)
                vals += [c + g(0, 0.004), g(0, 0.004), s + g(0, 0.004),
                         g(0, 0.25), dt + g(0, 0.25), g(0, 0.25),
                         -40 * c + 25 * s, 3.0, -40 * s - 25 * c]
            for i, r in enumerate(raw):
                if r >= 4000:
                    flags |= 1 << i
            if not self.tared:
                flags |= 1 << 10
            knee = -(th["P"] - th["T"]) if th["P"] is not None and th["T"] is not None else 0.0
            trunk = th["L"] if th["L"] is not None else 0.0
        body = ",".join([*(str(r) for r in raw), *(f"{v:.3f}" for v in vals)])
        line = f"{self.seq},{int(round(t_virtual * 1e6))},{body},{knee:.2f},{trunk:.2f},{flags}"
        self.seq += 1
        return line

    def write(self, data: bytes):
        for ch in data.decode(errors="ignore"):
            if ch == "t":
                self.tared = True
                self.pending.append("#OK tara aplicada: rodilla y tronco = 0 deg en esta postura")
            elif ch == "i":
                on = ", ".join(k for k, v in self.imu_on.items() if v) or "ninguna"
                self.pending.append(f"#INFO {self.label} | 100 Hz | IMU conectadas: {on}")
            elif ch in "gamr":
                self.pending.append("#INFO banco virtual: no necesita calibración")
            elif ch == "s":
                self.pending.append("#COLS," + ",".join(COLS))

    def close(self):
        pass


# ---------------------------------------------------------------- métricas
# Qué IMU necesita cada variable (T muslo, P pierna, L lumbar).
DEPENDE = {
    ("T", "P"): ["rodilla_contacto", "rodilla_pico", "rodilla_desplazamiento", "t_pico_rodilla_ms"],
    ("L",): ["tronco_contacto", "tronco_pico", "tronco_desplazamiento", "tronco_lateral_max"],
    ("T", "L"): ["cadera_contacto", "cadera_pico", "cadera_desplazamiento"],
    ("P",): ["valgo_der_max"],
}
NOMBRE_IMU = {"T": "muslo", "P": "pierna", "L": "lumbar"}


def estado_imus(df, col_flags: str = "flags") -> dict[str, str]:
    """Estado de cada IMU en la ventana del salto:
      "ok"           sin errores y con un acelerómetro que mide algo razonable
      "ausente"      no conectada (error en >= 90 % de las muestras o sin datos)
      "intermitente" falló a ratos: el salto se mide, pero con confianza baja
    """
    import numpy as np
    flags = df[col_flags].to_numpy(int) if col_flags in df else np.zeros(len(df), int)
    out = {}
    for n, k in enumerate(IMUS):
        err = (flags & (1 << (4 + n))) != 0
        frac = float(err.mean()) if len(err) else 1.0
        if not all(f"{k}_a{a}" in df for a in "xyz") or frac >= 0.9:
            out[k] = "ausente"
            continue
        g = np.sqrt(sum(df[f"{k}_a{a}"].to_numpy(float)[~err] ** 2 for a in "xyz"))
        if not (0.4 < float(np.median(g)) < 3.0):
            out[k] = "ausente"
        else:
            out[k] = "intermitente" if frac > 0 else "ok"
    return out


def imus_disponibles(df, col_flags: str = "flags") -> dict[str, bool]:
    return {k: v != "ausente" for k, v in estado_imus(df, col_flags).items()}


def filtrar_metricas(m: dict, estado: dict[str, str] | dict[str, bool]) -> tuple[dict, dict]:
    """Las variables de una IMU ausente pasan a "no disponibles" (el motor las excluye del
    índice) en vez de invalidar todo el salto. Una IMU intermitente sí baja la confianza."""
    est = {k: (v if isinstance(v, str) else ("ok" if v else "ausente")) for k, v in estado.items()}
    usa = {k: est.get(k, "ausente") != "ausente" for k in IMUS}
    m = dict(m)
    for req, keys in DEPENDE.items():
        if not all(usa[k] for k in req):
            for key in keys:
                m[key] = None
    usadas = [k for k in IMUS if usa[k]]
    m["error_imu"] = any(est.get(k) == "intermitente" for k in usadas)
    if not usadas:
        m["sin_tara"] = False       # sin IMU la tara no afecta (solo define el cero de los ángulos)
    faltan = [NOMBRE_IMU[k] for k in IMUS if not usa[k]]
    texto = ("Con las 3 IMU conectadas se evalúan todos los ítems." if not faltan else
             f"Sin IMU de {', '.join(faltan)}: los ítems que dependen de ella quedan como no disponibles; "
             "el índice usa solo lo que sí se pudo medir.")
    return m, {"imus": usa, "usadas": usadas, "faltan": faltan, "texto": texto}
