#!/usr/bin/env python3
"""
Registrador de ensayos — Sistema de evaluación biomecánica del aterrizaje (UTB)

Lee el CSV que envía el ESP32 por USB, lo guarda SIN transformar (datos
crudos, como exige la documentación) y crea un archivo .json con los
metadatos del ensayo: participante, fecha, configuración y calibraciones.
Durante la captura informa la frecuencia real, paquetes perdidos,
saturación de FSR y errores de IMU.

Uso:
    uv run --with pyserial logger.py --participante P01 --ensayo salto1 --tara
    uv run --with pyserial logger.py --listar          # ver puertos

Ctrl+C termina el ensayo.
"""
import argparse
import glob
import json
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    sys.exit("Falta pyserial:  uv run --with pyserial logger.py ...  (o pip3 install pyserial)")

FLAG_NAMES = {
    0: "sat_P1_H", 1: "sat_P1_F", 2: "sat_P2_H", 3: "sat_P2_F",
    4: "err_IMU_T", 5: "err_IMU_P", 6: "err_IMU_L",
    7: "solo_giro", 8: "overrun", 9: "calibrando", 10: "sin_tara",
}


def find_port():
    patterns = ["/dev/cu.usbserial*", "/dev/cu.wchusbserial*", "/dev/cu.SLAB_USBtoUART*",
                "/dev/cu.usbmodem*", "/dev/ttyUSB*", "/dev/ttyACM*"]
    for p in patterns:
        found = sorted(glob.glob(p))
        if found:
            return found[0]
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", help="puerto serie (por defecto se detecta)")
    ap.add_argument("--baud", type=int, default=921600)
    ap.add_argument("--participante", default="anonimo")
    ap.add_argument("--ensayo", default="ensayo")
    ap.add_argument("--out", default="ensayos", help="carpeta de salida")
    ap.add_argument("--duracion", type=float, default=0, help="segundos (0 = hasta Ctrl+C)")
    ap.add_argument("--tara", action="store_true",
                    help="tara automática: espera 1 s de quietud (atleta erguido) y envía 't'")
    ap.add_argument("--listar", action="store_true", help="listar puertos y salir")
    args = ap.parse_args()

    if args.listar:
        for p in list_ports.comports():
            print(f"{p.device:35s} {p.description}")
        return

    port = args.port or find_port()
    if not port:
        sys.exit("No se encontró el ESP32. Conéctelo con un cable USB-C de DATOS y use --listar.")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    base = outdir / f"{args.participante}_{args.ensayo}_{stamp}"
    csv_path, meta_path = base.with_suffix(".csv"), base.with_suffix(".json")

    meta = {"participante": args.participante, "ensayo": args.ensayo,
            "fecha": datetime.now().isoformat(timespec="seconds"),
            "puerto": port, "baudios": args.baud, "mensajes_firmware": []}

    # serial_for_url acepta puertos reales (/dev/cu.*) y la simulación de
    # Wokwi por red (rfc2217://localhost:4000).
    ser = serial.serial_for_url(port, baudrate=args.baud, timeout=0.2)
    time.sleep(0.3)
    ser.reset_input_buffer()
    ser.write(b"s")   # (re)inicia transmisión y reenvía el encabezado
    time.sleep(0.05)
    ser.write(b"i")   # estado del firmware al metadato
    ser.write(b"c")   # calibraciones vigentes al metadato
    tare_pending = args.tara
    still_count, gyro_idx = 0, []
    if tare_pending:
        print(">> TARA: esperando 1 s de quietud (atleta erguido e inmóvil)...")

    columns, n_cols = None, 0
    last_seq, gaps, rows, bad = None, 0, 0, 0
    t_first = None
    flag_counts = {k: 0 for k in FLAG_NAMES}
    t_start = time.time()
    t_report, rows_at_report = t_start, 0

    print(f"Registrando en {csv_path}  (Ctrl+C para terminar)")
    with open(csv_path, "w", newline="") as f:
        try:
            while True:
                if args.duracion and time.time() - t_start >= args.duracion:
                    break
                raw = ser.readline()
                if not raw:
                    continue
                line = raw.decode("ascii", errors="replace").strip()
                if not line:
                    continue

                if line.startswith("#"):
                    if line.startswith("#COLS,"):
                        if columns is None:
                            columns = line[6:].split(",")
                            n_cols = len(columns)
                            gyro_idx = [i for i, c in enumerate(columns) if c[-3:] in ("_gx", "_gy", "_gz")]
                            f.write(",".join(columns) + "\n")
                    else:
                        meta["mensajes_firmware"].append(line)
                        if not line.startswith(("#INFO", "#CALDATA", "#HELP")):
                            print(line)
                    continue

                if columns is None:
                    continue  # aún no llega el encabezado
                parts = line.split(",")
                if len(parts) != n_cols:
                    bad += 1   # línea incompleta (p. ej. ruido de arranque)
                    continue
                f.write(line + "\n")
                rows += 1
                if t_first is None:
                    t_first = time.time()

                seq = int(parts[0])
                if last_seq is not None and seq != last_seq + 1:
                    gaps += max(seq - last_seq - 1, 0)
                last_seq = seq
                flags = int(parts[-1])
                if tare_pending and gyro_idx:
                    moving = max(abs(float(parts[i])) for i in gyro_idx)
                    calibrating = flags & (1 << 9)
                    still_count = still_count + 1 if (moving < 3.0 and not calibrating) else 0
                    if still_count >= 100:
                        ser.write(b"t")
                        tare_pending = False
                        print(">> quietud detectada: tara enviada")
                for bit in FLAG_NAMES:
                    if flags & (1 << bit):
                        flag_counts[bit] += 1

                now = time.time()
                if now - t_report >= 1.0:
                    rate = (rows - rows_at_report) / (now - t_report)
                    sat = sum(flag_counts[b] for b in range(4))
                    print(f"\r{rows:7d} muestras | {rate:6.1f} Hz | perdidas {gaps} | "
                          f"saturacion FSR {sat} | rodilla {float(parts[-3]):6.1f}° "
                          f"tronco {float(parts[-2]):6.1f}°   ", end="", flush=True)
                    t_report, rows_at_report = now, rows
        except KeyboardInterrupt:
            pass
    ser.close()

    elapsed = time.time() - t_start
    data_time = time.time() - t_first if t_first else 0
    meta.update({
        "columnas": columns, "muestras": rows, "duracion_s": round(elapsed, 3),
        "frecuencia_media_hz": round((rows - 1) / data_time, 2) if data_time > 0 and rows > 1 else 0,
        "paquetes_perdidos": gaps, "lineas_invalidas": bad,
        "conteo_flags": {FLAG_NAMES[k]: v for k, v in flag_counts.items() if v},
    })
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    print(f"\n\nListo: {rows} muestras, {gaps} perdidas, {bad} líneas inválidas.")
    print(f"  datos:     {csv_path}\n  metadatos: {meta_path}")
    if columns is None:
        print("ADVERTENCIA: no llegó el encabezado #COLS. ¿Firmware cargado y baudios = 921600?")


if __name__ == "__main__":
    main()
