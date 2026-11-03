"""
Centro en vivo: lee el CSV del firmware (USB, Wokwi o demostración) con el
enlace probado del laboratorio (core/link.py), estima la pose a cada muestra,
detecta aterrizajes, los analiza y empuja todo por WebSocket a 30 Hz.
"""
from __future__ import annotations

import asyncio
import json
import math
import time
from collections import deque

import numpy as np
import pandas as pd

from . import banco, db, engine, settings
from .bridge import Link, analysis
from .demo import ESCENARIOS, DemoSource
from .metrics import FSR, landing_metrics, series
from .orientation import SegmentTracker

FRAME_HZ = 30
STATUS_HZ = 2
POST_S = 1.05          # se analiza cuando hay 1 s de datos tras el contacto
PRE_S = 3.0
FSR_SEEN_RAW = 300     # lectura a partir de la cual una plantilla cuenta como "presionada"


class PlatformLink(Link):
    """Link del laboratorio + fuente de demostración."""

    BUFFER_S = 40

    def connect(self, kind: str, **kw):
        if kind not in ("demo", "virtual"):
            return super().connect(kind, **kw)
        self.disconnect()
        if kind == "virtual":
            src = banco.BancoVirtualSource(kw.get("imu"))
        else:
            src = DemoSource(int(kw.get("escenario", 0)), bool(kw.get("auto", False)))
        with self.lock:
            self.source = src
            self.kind, self.kw, self.reconnects = kind, dict(kw), 0
            self.columns, self.col = [], {}
            self.buf.clear()
            self.rows_total = self.gaps = self.bad = 0
            self.last_seq = None
            self.running = True
            self.status, self.error = "conectado", ""
            self.messages.append(f"#LAB conectado a {src.label}")
        import threading
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        return True


class Hub:
    def __init__(self):
        self.link = PlatformLink()
        self.clients: set = set()
        self.reset_state()
        self.session_id: int | None = None
        self.atleta: dict | None = None
        self.objetivo = 3
        self.count = 0
        self.last_jump: dict | None = None
        self.loop_task = None
        self.demo_escenario = 0
        self.banco = False              # sesión del Banco de pruebas (sin atleta)
        self.gen = 0                    # cambia en cada conexión: descarta análisis de la anterior
        self.connecting = False

    def reset_state(self):
        self.tracker = SegmentTracker()
        # lo que ya está en el búfer del enlace pertenece a la conexión anterior: no se re-analiza
        self.seen = self.link.rows_total
        self.cols: list[str] = []
        self.ci: dict[str, int] = {}
        self.hist: deque = deque(maxlen=200 * 45)
        self.base_ang = None            # (muslo, valgo, lateral) de pie
        self.ang_acc: list = []
        self.stand_force = None         # fuerza estimada de pie por región
        self.base_sum = None
        self.sum_win: deque = deque(maxlen=50)   # 0,5 s de suma de plantillas: detecta "cargado y estable"
        self.air_since = None
        self.pending_tc = None
        self.contact_flash = None
        self.last_row = None
        self.tare_ok = False
        self.fsr_seen = [False] * 4     # cada plantilla se marca al verla cargada al menos una vez

    # ----------------------------------------------------------- conexión
    def connect(self, fuente: str, **kw) -> bool:
        self.connecting = True
        try:
            ok = self.link.connect(fuente, **kw)
        finally:
            self.gen += 1
            self.reset_state()
            self.seen = 0               # el enlace nuevo empieza su búfer desde cero
            self.connecting = False
        return ok

    def disconnect(self):
        self.gen += 1
        self.link.disconnect()
        self.reset_state()

    @property
    def demo(self) -> DemoSource | None:
        src = self.link.source
        return src if isinstance(src, DemoSource) else None

    @property
    def virtual(self) -> banco.BancoVirtualSource | None:
        src = self.link.source
        return src if isinstance(src, banco.BancoVirtualSource) else None

    async def tare(self) -> bool:
        """Tara: la postura actual pasa a ser el cero. El firmware pone rodilla y tronco en 0°
        y aquí se toma como referencia la inclinación de muslo, pierna y tronco de este momento."""
        self.link.request_tare_when_still()
        ok = await asyncio.to_thread(self.link.tared_event.wait, 8.0)
        if ok:
            recent = [a for _, a in list(self.hist)[-60:]]
            vals = [a for a in recent if not any(math.isnan(x) for x in a)]
            self.base_ang = tuple(float(np.median([a[i] for a in vals])) for i in range(3)) if vals else None
            self.ang_acc = []
            self.tare_ok = True
        return ok

    # ----------------------------------------------------------- lectura
    def _pull(self):
        if self.connecting:
            return []
        L = self.link
        with L.lock:
            total = L.rows_total
            if total < self.seen:          # el enlace se reinició (reconexión): empezar de nuevo
                self.seen = 0
            new = total - self.seen
            if new <= 0 or not L.columns:
                return []
            if L.columns != self.cols:
                self.cols = list(L.columns)
                self.ci = {c: i for i, c in enumerate(self.cols)}
            n = min(new, len(L.buf))
            rows = list(L.buf)[-n:] if n else []
            self.seen = total
        return rows

    def _process(self, rows):
        ci = self.ci
        if not all(c in ci for c in FSR + ["knee_flex", "trunk_flex"]):
            return
        r_div = settings.get()["r_div"]
        has_imu = all(f"{k}_ax" in ci for k in "TPL")
        for v in rows:
            t = v[ci["t_us"]] / 1e6
            if has_imu:
                imu = {k: (v[ci[f"{k}_ax"]], v[ci[f"{k}_ay"]], v[ci[f"{k}_az"]],
                           v[ci[f"{k}_gx"]], v[ci[f"{k}_gy"]], v[ci[f"{k}_gz"]]) for k in "TPL"}
                ang = self.tracker.step(t, imu)
            else:
                ang = (math.nan, math.nan, math.nan)
            raw = [v[ci[c]] for c in FSR]
            for k, x in enumerate(raw):
                if x > FSR_SEEN_RAW:
                    self.fsr_seen[k] = True
            force = [float(analysis.fsr_force_estimate(x, r_div)) for x in raw]
            s = sum(raw)
            self.hist.append((v, ang))
            # referencia de pie (quieto y cargado) para normalizar ángulos y cargas
            quiet = has_imu and max(abs(v[ci[f"{k}_g{a}"]]) for k in "TPL" for a in "xyz") < 4.0
            # nivel "de pie": la primera vez que la carga se mantiene estable 0,5 s (antes bastaba
            # superar 200 y, si la carga subía despacio —p. ej. presionando con la mano—, el nivel
            # quedaba demasiado bajo y el vuelo no se detectaba nunca)
            self.sum_win.append(s)
            if self.base_sum is None and len(self.sum_win) == self.sum_win.maxlen:
                lo, hi = min(self.sum_win), max(self.sum_win)
                mean = sum(self.sum_win) / len(self.sum_win)
                if lo > 200 and hi - lo < 0.35 * mean:
                    self.base_sum = mean
            if quiet and self.base_sum and 0.6 * self.base_sum < s < 1.6 * self.base_sum and self.air_since is None:
                self.base_sum += 0.01 * (s - self.base_sum)
                sf = self.stand_force
                self.stand_force = force if sf is None else [a + 0.01 * (b - a) for a, b in zip(sf, force)]
                if self.base_ang is None:
                    self.ang_acc.append(ang)
                    if len(self.ang_acc) >= 50:
                        self.base_ang = tuple(float(np.median([a[i] for a in self.ang_acc])) for i in range(3))
            # detector: vuelo (plantillas descargadas) → contacto
            if self.base_sum:
                if s < 0.08 * self.base_sum:
                    if self.air_since is None:
                        self.air_since = t
                elif self.air_since is not None and s > 0.15 * self.base_sum:
                    flight = t - self.air_since
                    self.air_since = None
                    if 0.08 <= flight <= 1.5 and self.pending_tc is None:
                        self.pending_tc = t
                        self.contact_flash = {"t": t, "vuelo_ms": round(flight * 1000)}
            self.last_row = (v, ang, force, t)

    def _frame(self) -> dict | None:
        if not self.last_row:
            return None
        v, ang, force, t = self.last_row
        ci = self.ci
        b = self.base_ang or (0.0, 0.0, 0.0)
        sf = self.stand_force or [max(f, 1e-3) for f in force]
        rel = lambda a, i: None if a is None or math.isnan(a) else round(a - b[i], 1)
        return {
            "type": "live", "t": round(t, 3),
            "knee": round(v[ci["knee_flex"]], 1), "trunk": round(v[ci["trunk_flex"]], 1),
            "thigh": rel(ang[0], 0), "valgus": rel(ang[1], 1), "lateral": rel(ang[2], 2),
            "fsr": [round(f / max(s, 1e-3), 2) for f, s in zip(force, sf)],
            "air": self.air_since is not None,
            "air_t": round(t - self.air_since, 3) if self.air_since is not None else 0,
            "flags": int(v[ci["flags"]]) if "flags" in ci else 0,
            "hw": self._hw(v),
        }

    def _hw(self, v) -> dict:
        """Lecturas de hardware para el Banco de pruebas: ADC crudo de cada FSR y,
        por IMU, orientación (cuaternión del Mahony, eje Z del mundo hacia arriba),
        |a| en g y |giro| en °/s."""
        ci = self.ci
        out = {"raw": [int(v[ci[c]]) for c in FSR], "base": round(self.base_sum) if self.base_sum else None}
        if all(f"{k}_ax" in ci for k in "TPL"):
            flags = int(v[ci["flags"]]) if "flags" in ci else 0
            q, a, g, ok = [], [], [], []
            for n, k in enumerate("TPL"):
                f = self.tracker.f[k]
                q.append([round(f.q0, 4), round(f.q1, 4), round(f.q2, 4), round(f.q3, 4)])
                a.append(round(math.sqrt(sum(v[ci[f"{k}_a{x}"]] ** 2 for x in "xyz")), 3))
                g.append(round(math.sqrt(sum(v[ci[f"{k}_g{x}"]] ** 2 for x in "xyz")), 1))
                ok.append(not flags & (1 << (4 + n)) and 0.4 < a[-1] < 3.0)
            out.update(q=q, a=a, g=g, ok=ok)
        return out

    def status(self) -> dict:
        snap = self.link.snapshot(2)
        flags = 0
        fsr, imu = [], []
        if self.last_row and self.ci:
            v = self.last_row[0]
            flags = int(v[self.ci["flags"]]) if "flags" in self.ci else 0
            sf = self.stand_force
            for k, c in enumerate(FSR):
                raw = v[self.ci[c]]
                # una plantilla se da por buena cuando ya se la vio cargada (atleta de pie o mano)
                fsr.append({"id": c, "ok": self.fsr_seen[k] and not flags & (1 << k), "visto": self.fsr_seen[k],
                            "crudo": int(raw), "saturado": bool(flags & (1 << k))})
            for k, n in enumerate("TPL"):
                ax, ay, az = (v[self.ci[f"{n}_a{a}"]] for a in "xyz")
                g = math.sqrt(ax * ax + ay * ay + az * az)
                err = bool(flags & (1 << (4 + k)))
                imu.append({"id": n, "ok": not err and 0.5 < g < 1.6, "error": err,
                            "ausente": err and g < 0.05, "g": round(g, 2)})
        demo = self.demo
        return {
            "type": "status", "estado": snap["status"], "error": snap["error"], "fuente": snap["label"],
            "tipo": self.link.kind, "hz": round(snap["hz"], 1), "fresco": snap["fresh"],
            "perdidas": snap["gaps"], "fsr": fsr, "imu": imu,
            "tara": bool(self.last_row) and not flags & (1 << 10), "calibrando": bool(flags & (1 << 9)),
            "solo_giro": bool(flags & (1 << 7)), "tara_pendiente": snap["tare_pending"],
            "mensajes": [m for m in snap["messages"][-6:]],
            "sesion": {"id": self.session_id, "conteo": self.count, "objetivo": self.objetivo,
                       "atleta": self.atleta},
            "banco": self.banco,
            "modo_salto": settings.get()["modo_salto"],
            "virtual": self.virtual.estado() if self.virtual else None,
            "demo": {"escenario": self.demo_escenario, "auto": demo.auto, "reproduciendo": demo.playing is not None,
                     "escenarios": ESCENARIOS} if demo else None,
        }

    # ----------------------------------------------------------- análisis
    def _analyze(self, tc: float) -> dict | None:
        rows = [(v, a) for v, a in self.hist if tc - PRE_S <= v[self.ci["t_us"]] / 1e6 <= tc + POST_S]
        if len(rows) < 60:
            return None
        df = pd.DataFrame([v for v, _ in rows], columns=self.cols)
        ang = np.array([a for _, a in rows], dtype=float)
        df["t"] = df["t_us"] / 1e6
        df["thigh"], df["valgus"], df["lateral"] = ang[:, 0], ang[:, 1], ang[:, 2]
        c = int(np.searchsorted(df["t"].to_numpy(), tc))
        r_div = settings.get()["r_div"]
        m = landing_metrics(df, c, r_div)
        # IMU no conectadas (p. ej. la lumbar aún no instalada): sus ítems quedan "no disponibles"
        m, info = banco.filtrar_metricas(m, banco.estado_imus(df.iloc[max(0, c - 10): c + 60]))
        res = engine.evaluate(m, self.atleta)
        res["sensores"] = info
        res["modo_salto"] = settings.get()["modo_salto"]
        if self.banco:
            res["banco"] = info
        elif info["faltan"]:
            res["avisos"].append({"tipo": "sensores", "texto": f"Sin IMU de {', '.join(info['faltan'])}: "
                                  "esos ítems no se evaluaron en este salto."})
        ser = series(df, c, r_div=r_div)
        crudo = {"columnas": self.cols, "filas": df[self.cols].round(3).values.tolist()}
        return {"resultado": res, "serie": ser, "crudo": crudo}

    def _save(self, out: dict) -> dict:
        res = out["resultado"]
        demo = self.demo
        esc = ESCENARIOS.get(demo.last_escenario) if demo else None
        jump = {"id": None, "fecha": time.strftime("%Y-%m-%dT%H:%M:%S"), **out}
        if self.session_id:
            with db.session() as s:
                row = db.Salto(sesion_id=self.session_id, atleta_id=self.atleta["id"], indice=res["indice"],
                               categoria=res["categoria"], confianza=res["confianza"], escenario=esc,
                               resultado=res, serie=out["serie"], crudo=out["crudo"])
                s.add(row)
                s.commit()
                s.refresh(row)
                jump["id"] = row.id
            if res["confianza"] != "baja":
                self.count += 1
        jump["valido"] = res["confianza"] != "baja"
        jump["conteo"] = self.count
        jump["objetivo"] = self.objetivo
        self.last_jump = jump
        return jump

    # ----------------------------------------------------------- bucle
    async def broadcast(self, msg: dict):
        if not self.clients:
            return
        txt = json.dumps(msg, separators=(",", ":"))
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(txt)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def run(self):
        period = 1 / FRAME_HZ
        k = 0
        while True:
            t0 = time.perf_counter()
            try:
                rows = self._pull()
                if rows:
                    if len(rows) > 60:
                        await asyncio.to_thread(self._process, rows)
                    else:
                        self._process(rows)
                if self.contact_flash:
                    await self.broadcast({"type": "contacto", **self.contact_flash})
                    self.contact_flash = None
                if self.pending_tc is not None and self.last_row and self.last_row[3] >= self.pending_tc + POST_S:
                    tc, self.pending_tc = self.pending_tc, None
                    gen = self.gen
                    out = await asyncio.to_thread(self._analyze, tc)
                    if out and gen == self.gen:     # si se reconectó mientras tanto, se descarta
                        jump = self._save(out)
                        msg = {k2: v2 for k2, v2 in jump.items() if k2 != "crudo"}
                        await self.broadcast({"type": "salto", "salto": msg})
                fr = self._frame()
                if fr:
                    await self.broadcast(fr)
                if k % (FRAME_HZ // STATUS_HZ) == 0:
                    await self.broadcast(self.status())
            except Exception as e:  # noqa: BLE001
                import traceback
                traceback.print_exc()
                await self.broadcast({"type": "error", "texto": str(e)})
            k += 1
            await asyncio.sleep(max(0.0, period - (time.perf_counter() - t0)))


HUB = Hub()
