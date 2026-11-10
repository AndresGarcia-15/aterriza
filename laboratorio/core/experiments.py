"""
Experimentos y automatización:
  - gemelo digital: compilar, simulación individual, barrido completo
  - Wokwi: escenario/resistencia en diagram.json y compilación del firmware
  - protocolo automático: conectar, tara en quietud, grabar, analizar
Cada tarea larga corre en un hilo; la interfaz consulta su estado.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import pandas as pd

from . import paths

# --------------------------------------------------------------- tareas
class Jobs:
    def __init__(self):
        self.lock = threading.Lock()
        self.jobs: dict[str, dict] = {}

    def start(self, name: str, fn, *args, **kw) -> str:
        jid = uuid.uuid4().hex[:8]
        job = {"id": jid, "name": name, "state": "corriendo", "log": [], "result": None,
               "started": time.time(), "ended": None}
        with self.lock:
            self.jobs[jid] = job

        def log(msg):
            with self.lock:
                job["log"].append(f"{time.strftime('%H:%M:%S')}  {msg}")

        def run():
            try:
                job["result"] = fn(log, *args, **kw)
                job["state"] = "ok"
            except Exception as e:  # noqa: BLE001
                log(f"ERROR: {e}")
                job["state"] = "error"
            job["ended"] = time.time()

        threading.Thread(target=run, daemon=True).start()
        return jid

    def get(self, jid):
        with self.lock:
            j = self.jobs.get(jid)
            return dict(j, log=list(j["log"])) if j else None

    def recent(self, n=6):
        with self.lock:
            js = sorted(self.jobs.values(), key=lambda j: j["started"], reverse=True)[:n]
            return [dict(j, log=list(j["log"])) for j in js]

    def busy(self, name):
        with self.lock:
            return any(j["name"] == name and j["state"] == "corriendo" for j in self.jobs.values())


JOBS = Jobs()


def _env():
    env = dict(os.environ)
    extra = [] if os.name == "nt" else ["/opt/homebrew/bin", "/usr/local/bin"]
    extra.append(str(Path.home() / ".local" / "bin"))
    env["PATH"] = os.pathsep.join(extra + [env.get("PATH", "")])
    return env


def _instalar(que: str) -> str:
    """Cómo instalar una herramienta en este sistema operativo."""
    pistas = {
        "c++": {"darwin": "xcode-select --install", "linux": "sudo apt install g++",
                "win32": "winget install BrechtSanders.WinLibs.POSIX.UCRT"},
        "arduino-cli": {"darwin": "brew install arduino-cli", "linux": "ver arduino.github.io/arduino-cli/latest/installation",
                        "win32": "winget install ArduinoSA.CLI"},
    }[que]
    return pistas.get(sys.platform, pistas["linux"])


def _run(cmd, log, cwd=None):
    log("$ " + " ".join(str(c) for c in cmd))
    p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", env=_env())
    out = []
    for line in p.stdout:
        line = line.rstrip()
        out.append(line)
        if line:
            log(line)
    if p.wait() != 0:
        raise RuntimeError(f"el comando terminó con código {p.returncode}")
    return out


# --------------------------------------------------------- gemelo digital
def gemelo_binary(rate: int, ma: int) -> Path:
    return paths.GEMELO / "bin" / f"sim_{rate}_ma{ma}{'.exe' if os.name == 'nt' else ''}"


def gemelo_ready() -> bool:
    return all(gemelo_binary(r, m).exists() for r in (100, 200) for m in (1, 3))


def build_gemelo(log=print):
    if not any(shutil.which(c, path=_env()["PATH"]) for c in ("c++", "g++", "clang++")):
        raise RuntimeError(f"Falta el compilador de C++. Instálalo con: {_instalar('c++')}")
    _run([sys.executable, "build.py"], log, cwd=paths.GEMELO)
    return True


_build_lock = threading.Lock()


def ensure_gemelo(log=print):
    with _build_lock:
        if not gemelo_ready():
            build_gemelo(log)


def run_single(log, escenario: int, r: float, transfer: float, rate: int, ma: int):
    ensure_gemelo(log)
    out = paths.CACHE / f"exp_{escenario}_{r:.0f}_{transfer:.2f}_{rate}_{ma}.csv"
    log(f"Simulando: escenario {escenario}, R={r:.0f} Ω, fracción {transfer:.2f}, {rate} Hz, promedio {ma}")
    res = subprocess.run([str(gemelo_binary(rate, ma)), str(escenario), str(r), str(transfer), str(out)],
                         capture_output=True, text=True, check=True)
    metrics = json.loads(res.stdout)
    log("Listo: " + ", ".join(f"{k}={v}" for k, v in metrics.items() if k.startswith(("rmse", "pct", "pico_fuerza"))))
    return {"metrics": metrics, "csv": str(out)}


def run_sweep(log):
    ensure_gemelo(log)
    log("Barrido de 108 configuraciones (escenario × resistencia × fracción × frecuencia × filtro)…")
    _run([sys.executable, "run_sweep.py"], log, cwd=paths.GEMELO)
    return {"csv": str(paths.GEMELO / "resultados" / "metricas.csv")}


def load_sweep() -> pd.DataFrame | None:
    p = paths.GEMELO / "resultados" / "metricas.csv"
    return pd.read_csv(p) if p.exists() else None


# ------------------------------------------------------------------ Wokwi
DIAGRAM = paths.SIM / "diagram.json"


def wokwi_config() -> dict:
    d = json.loads(DIAGRAM.read_text(encoding="utf-8"))
    cfg = {"escenario": 0, "r": 10000.0, "transfer": 0.10}
    for p in d["parts"]:
        if p["type"] == "chip-fsr":
            a = p.get("attrs", {})
            cfg = {"escenario": int(a.get("scenario", 0)), "r": float(a.get("r_divider", 10000)),
                   "transfer": float(a.get("transfer", 0.10))}
    return cfg


def set_wokwi_config(escenario: int, r: float, transfer: float):
    d = json.loads(DIAGRAM.read_text(encoding="utf-8"))
    for p in d["parts"]:
        if p["type"] in ("chip-gy85", "chip-fsr"):
            p.setdefault("attrs", {})["scenario"] = str(int(escenario))
        if p["type"] == "chip-fsr":
            p["attrs"]["r_divider"] = str(int(r))
            p["attrs"]["transfer"] = f"{transfer:.2f}"
    DIAGRAM.write_text(json.dumps(d, indent=2), encoding="utf-8")


def build_firmware_wokwi(log):
    if not shutil.which("arduino-cli", path=_env()["PATH"]):
        raise RuntimeError(f"No se encontró arduino-cli. Instálalo con: {_instalar('arduino-cli')}")
    _run(["arduino-cli", "compile", "--fqbn", "esp32:esp32:esp32",
          "--build-property", "compiler.cpp.extra_flags=-DCFG_AUTO_STATS_S=3",
          "--output-dir", "build", str(paths.FIRMWARE / "BiomecanicaESP32")], log, cwd=paths.SIM)
    return True


# ---------------------------------------------------- protocolo automático
def run_protocol(log, link, fuente: str, conectar_kw: dict, participante: str, ensayo: str,
                 duracion: float, aterrizajes_info: str = ""):
    """Conecta (si hace falta), hace la tara cuando el atleta está quieto,
    graba 'duracion' segundos y deja el ensayo listo para el análisis."""
    snap = link.snapshot(1)
    if snap["status"] != "conectado":
        log(f"Conectando a {fuente}…")
        if not link.connect(fuente, **conectar_kw):
            raise RuntimeError(link.snapshot(1)["error"] or "no se pudo conectar")
    for _ in range(50):
        if link.snapshot(1)["columns"]:
            break
        time.sleep(0.1)
    else:
        raise RuntimeError("no llega el encabezado del firmware (#COLS)")
    log("Tara automática: esperando 1 s de quietud del atleta…")
    link.request_tare_when_still()
    if not link.tared_event.wait(timeout=25):
        log("Aviso: no se confirmó la tara (¿atleta en movimiento?). Se graba igual.")
    else:
        log("Tara confirmada por el firmware.")
    path = link.start_recording(participante, ensayo, {"protocolo": "automático", "notas": aterrizajes_info})
    if not path:
        raise RuntimeError("no se pudo iniciar la grabación")
    log(f"Grabando {duracion:.0f} s en {path.name}…")
    t_end = time.time() + duracion
    while time.time() < t_end:
        time.sleep(0.5)
        if link.snapshot(1)["status"] != "conectado":
            log("Se perdió la conexión durante la grabación.")
            break
    link.stop_recording()
    log("Ensayo guardado. Ya aparece en la pestaña Ensayos.")
    return {"ensayo": str(path)}
