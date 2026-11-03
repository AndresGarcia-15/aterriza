"""
Enlace con el ESP32: lee el CSV del firmware desde
  - el simulador integrado (gemelo digital con el código real del firmware),
  - la simulación de Wokwi (rfc2217://localhost:4000),
  - la placa real por USB,
lo guarda en un búfer para las gráficas en vivo, envía comandos y graba ensayos
en el mismo formato que logger.py (CSV crudo + JSON de metadatos).
"""
from __future__ import annotations

import glob
import json
import subprocess
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path

from . import paths

FLAG_NAMES = {0: "sat_P1_H", 1: "sat_P1_F", 2: "sat_P2_H", 3: "sat_P2_F", 4: "err_IMU_T",
              5: "err_IMU_P", 6: "err_IMU_L", 7: "solo_giro", 8: "overrun", 9: "calibrando", 10: "sin_tara"}
ESCENARIOS = {0: "Controlado", 1: "Rígido", 2: "Asimétrico + valgo"}


def find_usb_port() -> str | None:
    for pat in ("/dev/cu.usbserial*", "/dev/cu.wchusbserial*", "/dev/cu.SLAB_USBtoUART*",
                "/dev/cu.usbmodem*", "/dev/ttyUSB*", "/dev/ttyACM*"):
        found = sorted(glob.glob(pat))
        if found:
            return found[0]
    return None


# ----------------------------------------------------------------- fuentes
class SerialSource:
    """Puerto serie real o URL de pyserial (rfc2217://, socket://)."""

    def __init__(self, url: str, baud: int = 921600):
        import serial  # pyserial
        self.label = url
        self.ser = serial.serial_for_url(url, baudrate=baud, timeout=0.2)
        time.sleep(0.3)
        self.ser.reset_input_buffer()

    def readline(self) -> str | None:
        raw = self.ser.readline()
        return raw.decode("ascii", errors="replace").strip() if raw else None

    def write(self, data: bytes):
        self.ser.write(data)

    def close(self):
        try:
            self.ser.close()
        except Exception:
            pass


class ReplaySource:
    """Simulador integrado: reproduce en tiempo real la salida del firmware
    ejecutado en el gemelo digital (arranque, calibración, tara a los 5-6 s y un
    aterrizaje cada 10 s, en bucle)."""

    LOOP_START, LOOP_END = 6.5, 16.5

    def __init__(self, escenario: int, r_div: float, transfer: float, rate: int = 100, ma: int = 3):
        from .experiments import gemelo_binary, ensure_gemelo
        ensure_gemelo()
        self.label = f"simulador integrado ({ESCENARIOS[escenario]}, R={r_div:.0f} Ω)"
        out = paths.CACHE / f"fw_{escenario}_{r_div:.0f}_{transfer:.2f}_{rate}_{ma}.csv"
        if not out.exists():
            subprocess.run([str(gemelo_binary(rate, ma)), str(escenario), str(r_div), str(transfer),
                            str(paths.CACHE / "_cmp.csv"), str(out), str(self.LOOP_END + 0.5)],
                           check=True, capture_output=True)
        lines = out.read_text().splitlines()
        self.header = lines[0]
        self.rows = []
        for ln in lines[1:]:
            seq, t_us, rest = ln.split(",", 2)
            self.rows.append((int(t_us) / 1e6, rest))
        self.period = 1.0 / rate
        self.loop_idx = next(i for i, (t, _) in enumerate(self.rows) if t >= self.LOOP_START)
        self.end_idx = next(i for i, (t, _) in enumerate(self.rows) if t >= self.LOOP_END)
        self.pending = deque(["#BOOT Simulador integrado: firmware real ejecutado en el gemelo digital",
                              f"#COLS,{self.header}"])
        self.t0 = time.monotonic()
        self.i, self.loops, self.seq = 0, 0, 0

    def readline(self) -> str | None:
        if self.pending:
            return self.pending.popleft()
        t_rel, rest = self.rows[self.i]
        t_virtual = t_rel + self.loops * (self.LOOP_END - self.LOOP_START)
        wait = self.t0 + t_virtual - time.monotonic()
        if wait > 0:
            time.sleep(min(wait, 0.2))
            if wait > 0.2:
                return None
        line = f"{self.seq},{int(round(t_virtual * 1e6))},{rest}"
        if self.loops > 0:   # tras la primera vuelta ya hay tara y no se está calibrando
            parts = line.rsplit(",", 1)
            line = f"{parts[0]},{int(parts[1]) & ~((1 << 9) | (1 << 10))}"
        self.seq += 1
        self.i += 1
        if self.i >= self.end_idx:
            self.i = self.loop_idx
            self.loops += 1
        return line

    def write(self, data: bytes):
        for ch in data.decode(errors="ignore"):
            if ch == "t":
                self.pending.append("#OK tara aplicada: rodilla y tronco = 0 deg en esta postura")
            elif ch == "i":
                self.pending.append(f"#INFO {self.label} | 100 Hz | sin pérdidas")
            elif ch in "gamr":
                self.pending.append("#INFO simulador integrado: las calibraciones se hacen al arrancar")
            elif ch == "s":
                self.pending.append(f"#COLS,{self.header}")

    def close(self):
        pass


# ------------------------------------------------------------------ enlace
class Link:
    BUFFER_S = 30

    def __init__(self):
        self.lock = threading.RLock()
        self.source = None
        self.thread = None
        self.running = False
        self.status = "desconectado"
        self.error = ""
        self.columns: list[str] = []
        self.col: dict[str, int] = {}
        self.buf: deque = deque(maxlen=self.BUFFER_S * 200)
        self.messages: deque = deque(maxlen=300)
        self.rows_total = self.gaps = self.bad = 0
        self.last_seq = None
        self.last_rx = 0.0
        self.tare_pending = False
        self.still = 0
        self.still_win: deque = deque(maxlen=100)    # 1 s de giroscopio para detectar quietud
        self.tared_event = threading.Event()
        self.kind, self.kw = None, {}
        self.reconnects = 0
        # grabación
        self.rec_file = None
        self.rec_path: Path | None = None
        self.rec_meta: dict = {}
        self.rec_rows = 0
        self.rec_gaps = 0
        self.rec_flags = {k: 0 for k in FLAG_NAMES}
        self.rec_t_first = None

    # ---- conexión
    def connect(self, kind: str, **kw):
        self.disconnect()
        with self.lock:
            self.status, self.error = "conectando", ""
        try:
            if kind == "sim":
                src = ReplaySource(int(kw.get("escenario", 0)), float(kw.get("r", 1000)),
                                   float(kw.get("transfer", 0.10)))
            elif kind == "wokwi":
                src = SerialSource(kw.get("url") or "rfc2217://localhost:4000")
            else:
                port = kw.get("port") or find_usb_port()
                if not port:
                    raise RuntimeError("No se encontró el ESP32 por USB (¿cable de datos conectado?)")
                src = SerialSource(port)
        except Exception as e:  # noqa: BLE001
            with self.lock:
                self.status, self.error = "error", str(e)
                self.messages.append(f"#ERROR {e}")
            return False
        with self.lock:
            self.source = src
            self.kind, self.kw, self.reconnects = kind, dict(kw), 0
            self.columns, self.col = [], {}
            self.buf.clear()
            self.rows_total = self.gaps = self.bad = 0
            self.last_seq = None
            self.running = True
            self.status = "conectado"
            self.messages.append(f"#LAB conectado a {src.label}")
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        time.sleep(0.2)
        self.send("s")
        return True

    def disconnect(self):
        if self.rec_file:
            self.stop_recording()
        with self.lock:
            self.running = False
            src, self.source = self.source, None
        if self.thread:
            self.thread.join(timeout=1.0)
            self.thread = None
        if src:
            src.close()
        with self.lock:
            if self.status != "error":
                self.status = "desconectado"

    def send(self, cmd: str):
        with self.lock:
            if self.source:
                try:
                    self.source.write(cmd.encode())
                    self.messages.append(f"> {cmd}")
                except Exception as e:  # noqa: BLE001
                    self.messages.append(f"#ERROR al enviar: {e}")

    def request_tare_when_still(self):
        with self.lock:
            self.tare_pending, self.still = True, 0
            self.still_win.clear()
            self.tared_event.clear()
            self.messages.append("#LAB tara automática: esperando 1 s de quietud…")

    # ---- lectura
    def _reopen(self) -> bool:
        """Wokwi reinicia su servidor RFC2217 cada vez que se reinicia la
        simulación, y un cable USB puede soltarse: se reabre el puerto."""
        with self.lock:
            old, kind, kw = self.source, self.kind, self.kw
            self.status = "reconectando"
        if old:
            old.close()
        try:
            url = (kw.get("url") or "rfc2217://localhost:4000") if kind == "wokwi" else (kw.get("port") or find_usb_port())
            if not url:
                raise RuntimeError("puerto no disponible")
            src = SerialSource(url)
        except Exception as e:  # noqa: BLE001
            with self.lock:
                self.source = None
                self.error = str(e)
            return False
        with self.lock:
            self.source = src
            self.status, self.error = "conectado", ""
            self.reconnects += 1
            self.last_seq = None
            self.messages.append(f"#LAB reconectado a {src.label}")
        try:
            src.write(b"s")
        except Exception:  # noqa: BLE001
            pass
        return True

    def _run(self):
        last_data = time.monotonic()
        while True:
            with self.lock:
                if not self.running:
                    return
                src, kind = self.source, self.kind
            if src is None:                      # esperando para reintentar
                time.sleep(2.0)
                if self._reopen():
                    last_data = time.monotonic()
                continue
            try:
                line = src.readline()
            except Exception as e:  # noqa: BLE001
                if kind in ("wokwi", "usb"):
                    with self.lock:
                        self.messages.append(f"#LAB conexión perdida ({e}); reintentando…")
                    self._reopen()
                    last_data = time.monotonic()
                    continue
                with self.lock:
                    self.status, self.error, self.running = "error", f"lectura: {e}", False
                    self.messages.append(f"#ERROR {e}")
                return
            if line:
                last_data = time.monotonic()
                self._handle(line)
            elif kind in ("wokwi", "usb") and time.monotonic() - last_data > 4.0:
                with self.lock:
                    self.messages.append("#LAB sin datos hace 4 s; reabriendo la conexión "
                                         "(¿simulación reiniciada o pestaña de Wokwi oculta?)")
                self._reopen()
                last_data = time.monotonic()

    def _handle(self, line: str):
        with self.lock:
            if line.startswith("#"):
                if line.startswith("#COLS,"):
                    self.columns = line[6:].split(",")
                    self.col = {c: i for i, c in enumerate(self.columns)}
                    if self.rec_file and self.rec_rows == 0:
                        self.rec_file.write(",".join(self.columns) + "\n")
                else:
                    self.messages.append(line)
                    if self.rec_file:
                        self.rec_meta["mensajes_firmware"].append(line)
                    if line.startswith("#OK tara"):
                        self.tared_event.set()
                return
            if not self.columns:
                return
            parts = line.split(",")
            if len(parts) != len(self.columns):
                self.bad += 1
                return
            try:
                vals = [float(x) for x in parts]
            except ValueError:
                self.bad += 1
                return
            seq = int(vals[0])
            if self.last_seq is not None and seq > self.last_seq + 1:
                self.gaps += seq - self.last_seq - 1
                if self.rec_file:
                    self.rec_gaps += seq - self.last_seq - 1
            self.last_seq = seq
            self.rows_total += 1
            self.last_rx = time.monotonic()
            self.buf.append(vals)
            flags = int(vals[-1])
            if self.rec_file:
                if self.rec_rows == 0 and self.rec_t_first is None:
                    self.rec_t_first = time.time()
                self.rec_file.write(line + "\n")
                self.rec_rows += 1
                for b in FLAG_NAMES:
                    if flags & (1 << b):
                        self.rec_flags[b] += 1
            if self.tare_pending:
                # Quietud = el giro casi no VARÍA durante 1 s. Se mira la variación y no el valor
                # absoluto porque un MPU6050 con el sesgo sin calibrar marca -2 a -4 °/s quieto.
                gyro = [vals[i] for c, i in self.col.items() if c[-3:] in ("_gx", "_gy", "_gz")]
                calibrating = flags & (1 << 9)
                if calibrating or max(abs(g) for g in gyro) > 25.0:
                    self.still_win.clear()
                else:
                    self.still_win.append(gyro)
                quiet = len(self.still_win) == self.still_win.maxlen and all(
                    max(col) - min(col) < 5.0 for col in zip(*self.still_win))
                self.still = 100 if quiet else 0
                if self.still >= 100:
                    self.tare_pending = False
                    self.messages.append("#LAB quietud detectada: tara enviada")
                    try:
                        self.source.write(b"t")
                    except Exception:  # noqa: BLE001
                        pass

    # ---- grabación (mismo formato que logger.py)
    def start_recording(self, participante: str, ensayo: str, extra: dict | None = None) -> Path | None:
        with self.lock:
            if not self.source or self.rec_file:
                return None
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            safe = lambda s: "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in (s or "x"))
            self.rec_path = paths.ENSAYOS / f"{safe(participante)}_{safe(ensayo)}_{stamp}.csv"
            self.rec_file = open(self.rec_path, "w", newline="", buffering=1)  # por línea: legible mientras graba
            if self.columns:
                self.rec_file.write(",".join(self.columns) + "\n")
            self.rec_meta = {"participante": participante, "ensayo": ensayo,
                             "fecha": datetime.now().isoformat(timespec="seconds"),
                             "fuente": self.source.label, "mensajes_firmware": [], **(extra or {})}
            self.rec_rows = self.rec_gaps = 0
            self.rec_flags = {k: 0 for k in FLAG_NAMES}
            self.rec_t_first = None
            self.messages.append(f"#LAB grabando en {self.rec_path.name}")
        self.send("i")
        self.send("c")
        return self.rec_path

    def stop_recording(self) -> Path | None:
        with self.lock:
            if not self.rec_file:
                return None
            self.rec_file.close()
            self.rec_file = None
            dur = time.time() - self.rec_t_first if self.rec_t_first else 0
            self.rec_meta.update({
                "columnas": self.columns, "muestras": self.rec_rows, "duracion_s": round(dur, 2),
                "frecuencia_media_hz": round((self.rec_rows - 1) / dur, 2) if dur > 0 and self.rec_rows > 1 else 0,
                "paquetes_perdidos": self.rec_gaps,
                "conteo_flags": {FLAG_NAMES[k]: v for k, v in self.rec_flags.items() if v}})
            self.rec_path.with_suffix(".json").write_text(json.dumps(self.rec_meta, indent=2, ensure_ascii=False))
            self.messages.append(f"#LAB ensayo guardado: {self.rec_path.name} ({self.rec_rows} muestras)")
            return self.rec_path

    # ---- lectura para la interfaz
    def snapshot(self, seconds: float = 8.0):
        with self.lock:
            rows = list(self.buf)
            cols = list(self.columns)
            n_keep = int(seconds * 200)
            rows = rows[-n_keep:]
            if rows and cols:
                t_last = rows[-1][1]
                rows = [r for r in rows if t_last - r[1] <= seconds * 1e6]
            # frecuencia de las últimas 2 s
            hz = 0.0
            if len(rows) > 2:
                tail = [r for r in rows if rows[-1][1] - r[1] <= 2e6]
                if len(tail) > 2:
                    hz = (len(tail) - 1) / ((tail[-1][1] - tail[0][1]) / 1e6 or 1)
            return {
                "columns": cols, "rows": rows, "status": self.status, "error": self.error,
                "label": self.source.label if self.source else "", "rows_total": self.rows_total,
                "gaps": self.gaps, "hz": hz, "fresh": time.monotonic() - self.last_rx < 1.0,
                "recording": self.rec_file is not None, "rec_rows": self.rec_rows,
                "rec_name": self.rec_path.name if self.rec_path else "", "messages": list(self.messages)[-60:],
                "tare_pending": self.tare_pending,
            }


LINK = Link()
