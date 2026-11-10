#!/usr/bin/env python3
"""Barrido del gemelo digital: escenarios × resistencia × frecuencia × filtro × fracción de carga.
Genera resultados/metricas.csv y resultados/panel_data.json (series para el panel)."""
import csv, json, os, subprocess, itertools
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "resultados"; OUT.mkdir(exist_ok=True)
ESC = {0: "Controlado", 1: "Rígido", 2: "Asimétrico + valgo"}
R_LIST = [10000, 3300, 1000]
TRANSFER = [0.05, 0.10, 0.20]
BUILDS = [(100, 3), (100, 1), (200, 3), (200, 1)]

metrics, series = [], {}
for (rate, ma), sc, r, tr in itertools.product(BUILDS, ESC, R_LIST, TRANSFER):
    tmp = OUT / "_run.csv"
    res = subprocess.run([str(HERE / "bin" / f"sim_{rate}_ma{ma}{'.exe' if os.name == 'nt' else ''}"), str(sc), str(r), str(tr), str(tmp)],
                         capture_output=True, text=True, check=True)
    m = json.loads(res.stdout); m["escenario_nombre"] = ESC[sc]; metrics.append(m)
    with open(tmp, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    key = f"{sc}|{r}|{tr:.2f}|{rate}|{ma}"
    cols = {c: [float(x[c]) for x in rows] for c in rows[0]}
    series[key] = {
        "t": [round(v - 8.0, 3) for v in cols["t"]],      # t = 0 en el contacto
        "knee_true": cols["knee_true"], "knee_meas": cols["knee_meas"],
        "trunk_true": cols["trunk_true"], "trunk_meas": cols["trunk_meas"],
        "valgus_true": cols["valgus_true"],
        "F_true": [round(sum(cols[f"F_true_{c}"][i] for c in ("P1H", "P1F", "P2H", "P2F")), 1) for i in range(len(rows))],
        "F_est": [round(sum(cols[f"F_est_{c}"][i] for c in ("P1H", "P1F", "P2H", "P2F")), 1) for i in range(len(rows))],
        "raw": {c: [int(v) for v in cols[f"raw_{c}"]] for c in ("P1H", "P1F", "P2H", "P2F")},
    }
tmp.unlink()

with open(OUT / "metricas.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(metrics[0].keys())); w.writeheader(); w.writerows(metrics)
json.dump({"escenarios": ESC, "r": R_LIST, "transfer": TRANSFER, "builds": BUILDS,
           "metricas": metrics, "series": series}, open(OUT / "panel_data.json", "w", encoding="utf-8"), separators=(",", ":"))
print(f"{len(metrics)} simulaciones -> {OUT/'metricas.csv'}, {OUT/'panel_data.json'}")
