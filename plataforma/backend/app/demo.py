"""
Modo demostración: reproduce, en tiempo real y en el formato CSV exacto del
ESP32, la salida del firmware REAL ejecutado en el gemelo digital
(simulacion/gemelo/bin/sim_100_ma3) para los 3 escenarios:
  0 controlado · 1 rígido · 2 asimétrico con valgo.
El atleta virtual queda de pie (bucle de quietud) hasta que se pide un salto;
entonces se reproduce el aterrizaje del escenario elegido.
Divisor de los FSR: 1 kΩ (recomendado por el gemelo: sin saturación).
"""
from __future__ import annotations

import subprocess
import threading
import time
from collections import deque
from pathlib import Path

from .bridge import PROJECT

DATA = Path(__file__).resolve().parents[1] / "data" / "demo"
GEMELO = PROJECT / "simulacion" / "gemelo"
ESCENARIOS = {0: "Controlado", 1: "Rígido", 2: "Asimétrico con valgo"}
R_DIV, TRANSFER, DUR = 1000, 0.10, 24
STAND = (12.0, 17.0)       # de pie, quieto (tras el primer aterrizaje simulado)
JUMP = (17.0, 21.0)        # se deja caer a 17,71 s, contacto a 18,0 s, recuperado ~19,3 s
CLEAR = ~((1 << 9) | (1 << 10))


def ensure_data() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    for s in ESCENARIOS:
        out = DATA / f"esc{s}.csv"
        if out.exists():
            continue
        binary = GEMELO / "bin" / "sim_100_ma3"
        if not binary.exists():
            subprocess.run(["sh", "build.sh"], cwd=GEMELO, check=True, capture_output=True)
        subprocess.run([str(binary), str(s), str(R_DIV), str(TRANSFER), "/dev/null", str(out), str(DUR)],
                       check=True, capture_output=True)


def _load(s: int):
    lines = (DATA / f"esc{s}.csv").read_text().splitlines()
    header = lines[0]
    rows = []
    for ln in lines[1:]:
        _, t_us, rest = ln.split(",", 2)
        body, flags = rest.rsplit(",", 1)
        rows.append((int(t_us) / 1e6, body, int(flags)))
    return header, rows


class DemoSource:
    def __init__(self, escenario: int = 0, auto: bool = False):
        ensure_data()
        self.lock = threading.Lock()
        self.header = None
        self.jumps = {}
        for s in ESCENARIOS:
            h, rows = _load(s)
            self.header = h
            self.jumps[s] = [r for r in rows if JUMP[0] <= r[0] < JUMP[1]]
            if s == 0:
                self.stand = [r for r in rows if STAND[0] <= r[0] < STAND[1]]
        self.label = "demostración (gemelo digital con el firmware real)"
        self.escenario = escenario
        self.auto = auto
        self.auto_seq = [0, 1, 2]
        self.auto_i = 0
        self.tared = False
        self.queue: deque = deque()
        self.pending = deque(["#BOOT Demostración: firmware real ejecutado en el gemelo digital",
                              f"#COLS,{self.header}"])
        self.i = 0
        self.seq = 0
        self.t0 = time.monotonic()
        self.next_auto = time.monotonic() + 4.0
        self.playing: list | None = None
        self.last_escenario: int | None = None

    # -- control desde la API
    def trigger(self, escenario: int | None = None) -> bool:
        with self.lock:
            if self.playing is not None:
                return False
            self.last_escenario = self.escenario if escenario is None else int(escenario)
            self.playing = self.jumps[self.last_escenario]
            self.i = 0
            return True

    def set_auto(self, on: bool):
        with self.lock:
            self.auto = on
            self.next_auto = time.monotonic() + 2.5

    # -- interfaz de fuente para core.link.Link
    def readline(self) -> str | None:
        if self.pending:
            return self.pending.popleft()
        t_virtual = self.seq * 0.01
        wait = self.t0 + t_virtual - time.monotonic()
        if wait > 0:
            time.sleep(min(wait, 0.05))
            if wait > 0.05:
                return None
        with self.lock:
            if self.playing is None and self.auto and time.monotonic() >= self.next_auto:
                self.last_escenario = self.auto_seq[self.auto_i % len(self.auto_seq)]
                self.playing = self.jumps[self.last_escenario]
                self.auto_i += 1
                self.i = 0
            src = self.playing if self.playing is not None else self.stand
            _, body, flags = src[self.i]
            self.i += 1
            if self.i >= len(src):
                self.i = 0
                if self.playing is not None:
                    self.playing = None
                    self.next_auto = time.monotonic() + 3.5
        flags &= CLEAR
        if not self.tared:
            flags |= 1 << 10
        line = f"{self.seq},{int(round(t_virtual * 1e6))},{body},{flags}"
        self.seq += 1
        return line

    def write(self, data: bytes):
        for ch in data.decode(errors="ignore"):
            if ch == "t":
                self.tared = True
                self.pending.append("#OK tara aplicada: rodilla y tronco = 0 deg en esta postura")
            elif ch == "i":
                self.pending.append(f"#INFO {self.label} | 100 Hz | FSR con divisor de {R_DIV} ohm")
            elif ch in "gam":
                self.pending.append("#INFO demostración: las calibraciones ya están hechas")
            elif ch == "s":
                self.pending.append(f"#COLS,{self.header}")

    def close(self):
        pass
