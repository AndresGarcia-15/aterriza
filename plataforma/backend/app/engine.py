"""
Motor de retroalimentación (reglas en feedback/rules.yaml).
Entrada: métricas de un aterrizaje (metrics.py) + perfil del atleta.
Salida: índice 0-100 y categoría, resultado por ítem, top 3 acciones
(peso × severidad, agrupadas para no repetir el mismo consejo), fortalezas,
confianza de la medición y aviso.
"""
from __future__ import annotations

import shutil
from collections import Counter
from datetime import datetime
from pathlib import Path

import yaml

RULES_PATH = Path(__file__).resolve().parents[1] / "feedback" / "rules.yaml"
HISTORY = RULES_PATH.parent / "historial"
_cache: dict = {"mtime": None, "data": None}

SEVERIDAD = {"ok": 0.0, "parcial": 0.5, "no": 1.0}
PUNTOS = {"ok": 1.0, "parcial": 0.5, "no": 0.0}


def load_rules() -> dict:
    mt = RULES_PATH.stat().st_mtime
    if _cache["mtime"] != mt:
        _cache["data"] = yaml.safe_load(RULES_PATH.read_text(encoding="utf-8"))
        _cache["mtime"] = mt
    return _cache["data"]


def save_thresholds(changes: dict[str, dict]) -> dict:
    """Ajuste de umbrales desde el Modo profesional: guarda una copia de la versión
    anterior en feedback/historial/ y aumenta el número de versión."""
    data = load_rules()
    HISTORY.mkdir(exist_ok=True)
    shutil.copy(RULES_PATH, HISTORY / f"rules_v{data['version']}_{datetime.now():%Y%m%d_%H%M%S}.yaml")
    editable = {"umbral_ok", "umbral_parcial", "peso", "carga_baja", "carga_media"}
    for r in data["reglas"]:
        for k, v in (changes.get(r["id"]) or {}).items():
            if k in editable and v is not None:
                r[k] = float(v)
    data["version"] = int(data["version"]) + 1
    data["actualizado"] = datetime.now().strftime("%Y-%m-%d")
    RULES_PATH.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=100), encoding="utf-8")
    _cache["mtime"] = None
    return load_rules()


def _fmt(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, float) and abs(v - round(v)) < 0.05:
        return str(int(round(v)))
    return f"{v:.1f}".replace(".", ",") if isinstance(v, float) else str(v)


def rigidez(m: dict, regla: dict) -> tuple[float | None, str | None]:
    """LESS ítem 16: combina recorrido de rodilla (ítem 4) y carga relativa (ítem 11)."""
    d, carga = m.get("rodilla_desplazamiento"), m.get("carga_pico_rel")
    if d is None:
        return None, None
    rk = next((r for r in load_rules()["reglas"] if r["id"] == "rodilla_desplazamiento"), {})
    pk = 1.0 if d > rk.get("umbral_ok", 45) else 0.5 if d >= rk.get("umbral_parcial", 30) else 0.0
    if carga is None:
        score = pk
    else:
        pc = 1.0 if carga <= regla["carga_baja"] else 0.5 if carga <= regla["carga_media"] else 0.0
        score = (pk + pc) / 2
    etiqueta = "suave" if score >= regla["umbral_ok"] else "media" if score >= regla["umbral_parcial"] else "rígida"
    return round(score, 2), etiqueta


def _estado(regla: dict, m: dict):
    ok, par = regla["umbral_ok"], regla["umbral_parcial"]
    if regla["tipo"] == "doble":
        a, b = m.get(regla["variable"]), m.get(regla["variable_2"])
        if a is None or b is None:
            return None, a
        n = (a >= ok) + (b >= par)
        return ("ok" if n == 2 else "parcial" if n == 1 else "no"), a
    v = m.get(regla["variable"])
    if v is None:
        return None, None
    if regla["tipo"] == "mayor":
        return ("ok" if v >= ok else "parcial" if v >= par else "no"), v
    return ("ok" if v < ok else "parcial" if v < par else "no"), v


def confidence(m: dict, cfg: dict) -> tuple[str, list[str]]:
    motivos = []
    nivel = "alta"
    if m.get("saturado_pct", 0) > cfg["saturado_pct_baja"]:
        motivos.append("Las plantillas se saturaron (carga fuera de rango).")
        nivel = "baja"
    elif m.get("saturado_pct", 0) > cfg["saturado_pct_media"]:
        motivos.append("Una plantilla se saturó por un instante.")
        nivel = "media"
    if m.get("error_imu"):
        motivos.append("Un sensor de movimiento (IMU) reportó error.")
        nivel = "baja"
    if m.get("sin_tara") or m.get("calibrando"):
        motivos.append("Faltaba la tara de pie o el sistema se estaba calibrando.")
        nivel = "baja"
    p = m.get("perdidas", 0) or 0
    if p > cfg["perdidas_baja"]:
        motivos.append(f"Se perdieron {p} muestras de datos.")
        nivel = "baja"
    elif p > 0 and nivel == "alta":
        motivos.append(f"Se perdieron {p} muestras de datos.")
        nivel = "media"
    return nivel, motivos


def evaluate(m: dict, atleta: dict | None = None) -> dict:
    data = load_rules()
    m = dict(m)
    reg_rig = next(r for r in data["reglas"] if r["id"] == "rigidez")
    m["rigidez_puntaje"], m["rigidez"] = rigidez(m, reg_rig)

    items, total_w, got = [], 0.0, 0.0
    for r in data["reglas"]:
        estado, valor = _estado(r, m)
        meta = r["umbral_ok"]
        it = {"id": r["id"], "item": r["item"], "nombre": r["nombre"], "grupo": r["grupo"],
              "estado": estado or "no_disponible", "valor": valor, "meta": meta, "unidad": r["unidad"],
              "peso": r["peso"], "porque": r["porque"].strip(), "fuente": r["fuente"],
              "tipo": r["tipo"]}
        if r["id"] == "rigidez":
            it["etiqueta"] = m["rigidez"]
        if estado is None:
            items.append(it)
            continue
        total_w += r["peso"]
        got += r["peso"] * PUNTOS[estado]
        txt = {"valor": _fmt(valor), "meta": _fmt(meta)}
        it["mensaje"] = (r["mensaje_bien"] if estado == "ok" else r["mensaje_corregir"]).format(**txt)
        it["impacto"] = r["peso"] * SEVERIDAD[estado]
        it["prioridad"] = r["prioridad"]
        items.append(it)

    indice = round(100 * got / total_w) if total_w else 0
    cat = next(c for c in data["categorias"] if indice >= c["min"])

    # Top 3 acciones: un consejo por grupo, ordenado por impacto acumulado del grupo.
    grupos: dict[str, dict] = {}
    for it in items:
        if it["estado"] in ("parcial", "no"):
            g = grupos.setdefault(it["grupo"], {"impacto": 0.0, "lider": it})
            g["impacto"] += it["impacto"]
            if (it["impacto"], -it["prioridad"]) > (g["lider"]["impacto"], -g["lider"]["prioridad"]):
                g["lider"] = it
    orden = sorted(grupos.values(), key=lambda g: (-g["impacto"], g["lider"]["prioridad"]))
    acciones = [{**g["lider"], "impacto_grupo": round(g["impacto"], 1)} for g in orden[:3]]
    fortalezas = sorted([it for it in items if it["estado"] == "ok"], key=lambda x: -x["peso"])[:3]

    conf, motivos = confidence(m, data["confianza"])
    avisos = []
    if any(i["id"] in ("simetria_carga", "simetria_contacto") and i["estado"] == "no" for i in items):
        avisos.append({"tipo": "asimetria", "texto": "Aterrizaje asimétrico: cargaste más una pierna que la otra."})
    if conf == "baja":
        avisos.insert(0, {"tipo": "confianza", "texto": "Este salto no se pudo medir bien; repítelo."})

    return {
        "indice": indice, "categoria": cat["nombre"], "estado": cat["estado"],
        "items": items, "acciones": acciones, "fortalezas": fortalezas,
        "confianza": conf, "motivos_confianza": motivos, "avisos": avisos,
        "rigidez": m["rigidez"], "metricas": m, "aviso": data["aviso"],
        "no_disponible": data["no_disponible"], "version_reglas": data["version"],
        "unidad_carga": "relativa a la carga de pie",
    }


def session_summary(results: list[dict]) -> dict:
    """Recomendación principal según el patrón repetido en ≥ 2 de los últimos 3 saltos."""
    validos = [r for r in results if r.get("confianza") != "baja"]
    if not validos:
        return {"saltos": len(results), "validos": 0}
    ult = validos[-3:]
    cnt = Counter(a["grupo"] for r in ult for a in r["acciones"])
    patron = [g for g, n in cnt.most_common() if n >= 2]
    principal = None
    if patron:
        g = patron[0]
        principal = next(a for r in reversed(ult) for a in r["acciones"] if a["grupo"] == g)
        principal = {**principal, "repeticiones": cnt[g], "de": len(ult)}
    idx = [r["indice"] for r in validos]
    return {"saltos": len(results), "validos": len(validos), "promedio": round(sum(idx) / len(idx)),
            "mejor": max(idx), "principal": principal}
