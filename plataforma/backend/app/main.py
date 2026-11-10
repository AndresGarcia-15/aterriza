"""
API de la plataforma de retroalimentación del aterrizaje (UTB).
  - WebSocket /ws/live: pose a 30 Hz, estado del sistema y resultados de cada salto.
  - REST /api/...: atletas, sesiones, saltos, progreso, exportación y Modo profesional.
  - Sirve el frontend compilado (frontend/dist) en http://127.0.0.1:8000
"""
from __future__ import annotations

import asyncio
import csv
import io
import secrets
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import banco, db, engine, settings
from .bridge import list_usb_ports
from .db import Atleta, PruebaBanco, Salto, Sesion, select
from .live import HUB
from .reference import reference

DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
TOKENS: set[str] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    HUB.loop_task = asyncio.create_task(HUB.run())
    asyncio.get_running_loop().run_in_executor(None, reference)   # precalienta el fantasma
    yield
    HUB.loop_task.cancel()
    HUB.disconnect()


app = FastAPI(title="Plataforma de aterrizaje UTB", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


# ------------------------------------------------------------------ modelos
class AtletaIn(BaseModel):
    nombre: str
    deporte: str = ""
    pierna_dominante: str = "derecha"
    estatura_cm: float | None = None
    masa_kg: float | None = None


class ConectarIn(BaseModel):
    fuente: str = "demo"          # demo | usb | wokwi
    puerto: str | None = None
    url: str | None = None
    escenario: int = 0
    imu: dict[str, bool] | None = None    # banco virtual: qué IMU simular conectadas


class SesionIn(BaseModel):
    atleta_id: int
    objetivo: int | None = None


class SaltarIn(BaseModel):
    escenario: int | None = None


def _pro(token: str | None):
    if not token or token not in TOKENS:
        raise HTTPException(401, "Modo profesional bloqueado")


# ------------------------------------------------------------------ atletas
@app.get("/api/atletas")
def atletas():
    with db.session() as s:
        out = []
        for a in s.exec(select(Atleta).where(Atleta.deporte != banco.MARCA_BANCO).order_by(Atleta.creado.desc())).all():
            saltos = s.exec(select(Salto).where(Salto.atleta_id == a.id)).all()
            ult = max(saltos, key=lambda x: x.fecha) if saltos else None
            out.append({**a.model_dump(), "saltos": len(saltos),
                        "ultimo_indice": ult.indice if ult else None,
                        "ultima_categoria": ult.categoria if ult else None})
        return out


@app.post("/api/atletas")
def crear_atleta(body: AtletaIn):
    if not body.nombre.strip():
        raise HTTPException(422, "El nombre es obligatorio")
    with db.session() as s:
        a = Atleta(**body.model_dump())
        s.add(a)
        s.commit()
        s.refresh(a)
        return a.model_dump()


@app.get("/api/atletas/{aid}")
def atleta(aid: int):
    with db.session() as s:
        a = s.get(Atleta, aid)
        if not a:
            raise HTTPException(404, "Atleta no encontrado")
        return a.model_dump()


@app.put("/api/atletas/{aid}")
def editar_atleta(aid: int, body: AtletaIn):
    with db.session() as s:
        a = s.get(Atleta, aid)
        if not a:
            raise HTTPException(404)
        for k, v in body.model_dump().items():
            setattr(a, k, v)
        s.add(a)
        s.commit()
        return a.model_dump()


@app.delete("/api/atletas/{aid}")
def borrar_atleta(aid: int):
    """Privacidad: borra al atleta y TODOS sus datos de este equipo."""
    with db.session() as s:
        for row in s.exec(select(Salto).where(Salto.atleta_id == aid)).all():
            s.delete(row)
        for row in s.exec(select(Sesion).where(Sesion.atleta_id == aid)).all():
            s.delete(row)
        a = s.get(Atleta, aid)
        if a:
            s.delete(a)
        s.commit()
    if HUB.atleta and HUB.atleta["id"] == aid:
        HUB.session_id, HUB.atleta = None, None
    return {"ok": True}


@app.get("/api/atletas/{aid}/exportar.csv")
def exportar_atleta(aid: int):
    with db.session() as s:
        a = s.get(Atleta, aid)
        if not a:
            raise HTTPException(404)
        saltos = s.exec(select(Salto).where(Salto.atleta_id == aid).order_by(Salto.fecha)).all()
    buf = io.StringIO()
    keys = ["rodilla_contacto", "rodilla_pico", "rodilla_desplazamiento", "tronco_contacto", "tronco_desplazamiento",
            "cadera_contacto", "cadera_desplazamiento", "antepie_a_talon_ms", "diferencia_contacto_ms",
            "lsi_carga_pct", "tronco_lateral_max", "valgo_der_max", "carga_pico_rel", "tasa_carga_rel_s",
            "rigidez", "saturado_pct"]
    w = csv.writer(buf)
    w.writerow(["atleta", "salto_id", "sesion_id", "fecha", "indice", "categoria", "confianza", "escenario_demo", *keys])
    for j in saltos:
        m = j.resultado.get("metricas", {})
        w.writerow([a.nombre, j.id, j.sesion_id, j.fecha.isoformat(timespec="seconds"), j.indice, j.categoria,
                    j.confianza, j.escenario or "", *[m.get(k, "") for k in keys]])
    name = "".join(ch if ch.isalnum() else "_" for ch in a.nombre)
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}_saltos.csv"'})


@app.get("/api/atletas/{aid}/progreso")
def progreso(aid: int):
    with db.session() as s:
        a = s.get(Atleta, aid)
        if not a:
            raise HTTPException(404)
        sesiones = s.exec(select(Sesion).where(Sesion.atleta_id == aid).order_by(Sesion.inicio)).all()
        out = []
        for se in sesiones:
            saltos = s.exec(select(Salto).where(Salto.sesion_id == se.id).order_by(Salto.fecha)).all()
            if not saltos:
                continue
            res = [j.resultado for j in saltos]
            summ = engine.session_summary(res)
            out.append({"id": se.id, "inicio": se.inicio.isoformat(timespec="minutes"), **summ,
                        "saltos_lista": [{"id": j.id, "indice": j.indice, "categoria": j.categoria,
                                          "confianza": j.confianza, "fecha": j.fecha.isoformat(timespec="seconds")}
                                         for j in saltos]})
    meta = None
    if out:
        last = out[-1]
        if last.get("principal"):
            p = last["principal"]
            meta = {"texto": p["mensaje"], "grupo": p["grupo"], "nombre": p["nombre"]}
        prom = last.get("promedio") or 0
        objetivo = next((c["min"] for c in reversed(engine.load_rules()["categorias"]) if c["min"] > prom), None)
        if meta is None and objetivo:
            meta = {"texto": f"Sube tu índice promedio a {objetivo} o más.", "grupo": None, "nombre": "Índice"}
        if meta is not None:
            meta["indice_objetivo"] = objetivo
    return {"atleta": a.model_dump(), "sesiones": out, "proxima_meta": meta}


# ------------------------------------------------------------------ conexión
@app.get("/api/puertos")
def puertos():
    ports = list_usb_ports()
    return {"puertos": ports, "sugerido": ports[0] if ports else None}


@app.post("/api/conectar")
async def conectar(body: ConectarIn):
    kw = {"escenario": body.escenario} if body.fuente == "demo" else {}
    if body.fuente == "virtual" and body.imu is not None:
        kw["imu"] = body.imu
    if body.puerto:
        kw["port"] = body.puerto
    if body.url:
        kw["url"] = body.url
    ok = await asyncio.to_thread(HUB.connect, body.fuente, **kw)
    if body.fuente == "demo":
        HUB.demo_escenario = body.escenario
    st = HUB.status()
    if not ok:
        raise HTTPException(400, st["error"] or "No se pudo conectar")
    return st


@app.post("/api/desconectar")
async def desconectar():
    await asyncio.to_thread(HUB.disconnect)
    return {"ok": True}


@app.post("/api/tara")
async def tara():
    if HUB.link.status != "conectado":
        raise HTTPException(400, "Conecta el dispositivo primero")
    ok = await HUB.tare()
    return {"ok": ok}


@app.get("/api/estado")
def estado():
    return HUB.status()


# ------------------------------------------------------------------ modo de salto
class ModoIn(BaseModel):
    modo: str


@app.put("/api/modo")
def modo_salto(body: ModoIn):
    """Caída desde el cajón (protocolo LESS) o salto vertical en el sitio. Cambia solo la
    representación y las instrucciones; la detección y las métricas del aterrizaje son las mismas."""
    if body.modo not in ("cajon", "sitio"):
        raise HTTPException(422, "Modo desconocido")
    settings.update({"modo_salto": body.modo})
    return {"modo_salto": body.modo}


# ------------------------------------------------------------------ demo
@app.post("/api/demo/saltar")
def demo_saltar(body: SaltarIn):
    d = HUB.demo
    if not d:
        raise HTTPException(400, "El modo demostración no está activo")
    esc = HUB.demo_escenario if body.escenario is None else body.escenario
    HUB.demo_escenario = esc
    return {"ok": d.trigger(esc), "escenario": esc}


@app.post("/api/demo/auto")
def demo_auto(on: bool = True):
    d = HUB.demo
    if not d:
        raise HTTPException(400, "El modo demostración no está activo")
    d.set_auto(on)
    return {"auto": on}


# ------------------------------------------------------------------ sesiones
@app.post("/api/sesion")
def iniciar_sesion(body: SesionIn):
    with db.session() as s:
        a = s.get(Atleta, body.atleta_id)
        if not a:
            raise HTTPException(404, "Atleta no encontrado")
        atleta = a.model_dump(mode="json")
        se = Sesion(atleta_id=a.id, fuente=HUB.link.kind or "", objetivo=body.objetivo or settings.get()["objetivo_saltos"])
        s.add(se)
        s.commit()
        s.refresh(se)
        HUB.session_id, HUB.atleta, HUB.objetivo, HUB.count = se.id, atleta, se.objetivo, 0
        HUB.banco = False
        return {"id": se.id, "objetivo": se.objetivo}


@app.post("/api/sesion/fin")
def fin_sesion():
    sid = HUB.session_id
    if sid:
        with db.session() as s:
            se = s.get(Sesion, sid)
            if se:
                se.fin = datetime.now()
                s.add(se)
                s.commit()
    HUB.session_id, HUB.count = None, 0
    return {"id": sid}


@app.get("/api/sesiones/{sid}")
def sesion(sid: int):
    with db.session() as s:
        se = s.get(Sesion, sid)
        if not se:
            raise HTTPException(404)
        saltos = s.exec(select(Salto).where(Salto.sesion_id == sid).order_by(Salto.fecha)).all()
        res = [j.resultado for j in saltos]
        return {"id": se.id, "atleta_id": se.atleta_id, "inicio": se.inicio.isoformat(timespec="minutes"),
                "objetivo": se.objetivo, "resumen": engine.session_summary(res),
                "saltos": [{"id": j.id, "indice": j.indice, "categoria": j.categoria, "confianza": j.confianza,
                            "escenario": j.escenario} for j in saltos]}


@app.get("/api/saltos/{jid}")
def salto(jid: int):
    with db.session() as s:
        j = s.get(Salto, jid)
        if not j:
            raise HTTPException(404, "Salto no encontrado")
        a = s.get(Atleta, j.atleta_id)
        hermanos = s.exec(select(Salto.id).where(Salto.sesion_id == j.sesion_id).order_by(Salto.fecha)).all()
        return {"id": j.id, "sesion_id": j.sesion_id, "fecha": j.fecha.isoformat(timespec="seconds"),
                "resultado": j.resultado, "serie": j.serie, "escenario": j.escenario,
                "atleta": a.model_dump(mode="json") if a else None, "numero": hermanos.index(j.id) + 1,
                "total": len(hermanos)}


@app.get("/api/saltos/{jid}/crudo.csv")
def salto_crudo(jid: int, x_pro_token: str | None = Header(None), token: str | None = None):
    _pro(x_pro_token or token)
    with db.session() as s:
        j = s.get(Salto, jid)
        if not j:
            raise HTTPException(404)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(j.crudo.get("columnas", []))
    w.writerows(j.crudo.get("filas", []))
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="salto_{jid}_crudo.csv"'})


@app.get("/api/referencia")
def ref():
    return reference()


@app.get("/api/ciencia")
def ciencia():
    r = engine.load_rules()
    return {"version": r["version"], "aviso": r["aviso"], "no_disponible": r["no_disponible"],
            "reglas": [{k: x.get(k) for k in ("id", "item", "nombre", "variable", "umbral_ok", "umbral_parcial",
                                               "unidad", "peso", "porque", "fuente", "tipo")} for x in r["reglas"]]}


# ------------------------------------------------------------------ banco de pruebas
def _atleta_banco(s) -> Atleta:
    a = s.exec(select(Atleta).where(Atleta.deporte == banco.MARCA_BANCO)).first()
    if not a:
        a = Atleta(nombre=banco.NOMBRE_BANCO, deporte=banco.MARCA_BANCO, pierna_dominante="derecha")
        s.add(a)
        s.commit()
        s.refresh(a)
    return a


@app.post("/api/banco/iniciar")
def banco_iniciar():
    """Sesión del banco: los saltos simulados con las manos pasan por el MISMO análisis,
    pero se guardan aparte (atleta reservado «Banco de pruebas», oculto en la lista)."""
    with db.session() as s:
        if HUB.banco and HUB.session_id:
            se = s.get(Sesion, HUB.session_id)
            if se and se.fin is None:
                return {"sesion_id": se.id, "atleta": HUB.atleta}
        a = _atleta_banco(s)
        atleta = a.model_dump(mode="json")
        se = Sesion(atleta_id=a.id, fuente=HUB.link.kind or "", objetivo=0)
        s.add(se)
        s.commit()
        s.refresh(se)
        HUB.session_id, HUB.atleta, HUB.objetivo, HUB.count = se.id, atleta, 0, 0
        HUB.banco = True
        return {"sesion_id": se.id, "atleta": HUB.atleta}


@app.post("/api/banco/fin")
def banco_fin():
    if HUB.banco:
        fin_sesion()
        HUB.atleta, HUB.banco = None, False
    return {"ok": True}


class VirtualIn(BaseModel):
    fsr: list[float | bool | None] | None = None
    imu: dict[str, bool] | None = None
    giro: str | None = None


@app.post("/api/banco/virtual")
def banco_virtual(body: VirtualIn):
    v = HUB.virtual
    if not v:
        raise HTTPException(400, "El banco virtual no está conectado")
    v.set(fsr=body.fsr, imu=body.imu, giro=body.giro)
    return v.estado()


@app.get("/api/banco/saltos")
def banco_saltos():
    with db.session() as s:
        a = s.exec(select(Atleta).where(Atleta.deporte == banco.MARCA_BANCO)).first()
        if not a:
            return []
        rows = s.exec(select(Salto).where(Salto.atleta_id == a.id).order_by(Salto.fecha.desc()).limit(40)).all()
        return [{"id": j.id, "fecha": j.fecha.isoformat(timespec="seconds"), "indice": j.indice,
                 "categoria": j.categoria, "confianza": j.confianza,
                 "medibles": [i["nombre"] for i in j.resultado.get("items", []) if i["estado"] != "no_disponible"],
                 "imus": (j.resultado.get("banco") or {}).get("usadas", [])} for j in rows]


class ReporteIn(BaseModel):
    fuente: str = ""
    aprobado: bool = False
    notas: str = ""
    checks: list[dict] = []
    flujo: dict = {}


@app.post("/api/banco/reportes")
def banco_guardar_reporte(body: ReporteIn):
    with db.session() as s:
        r = PruebaBanco(**body.model_dump())
        s.add(r)
        s.commit()
        s.refresh(r)
        return r.model_dump(mode="json")


@app.get("/api/banco/reportes")
def banco_reportes():
    with db.session() as s:
        return [r.model_dump(mode="json") for r in
                s.exec(select(PruebaBanco).order_by(PruebaBanco.fecha.desc()).limit(50)).all()]


# ------------------------------------------------------------------ modo profesional
class PinIn(BaseModel):
    pin: str


@app.post("/api/pro/entrar")
def pro_entrar(body: PinIn):
    if not secrets.compare_digest(body.pin, str(settings.get()["pin"])):
        raise HTTPException(401, "PIN incorrecto")
    tok = secrets.token_urlsafe(16)
    TOKENS.add(tok)
    return {"token": tok}


@app.get("/api/pro/reglas")
def pro_reglas(x_pro_token: str | None = Header(None)):
    _pro(x_pro_token)
    return engine.load_rules()


@app.put("/api/pro/reglas")
def pro_guardar_reglas(changes: dict, x_pro_token: str | None = Header(None)):
    _pro(x_pro_token)
    return engine.save_thresholds(changes)


@app.get("/api/pro/config")
def pro_config(x_pro_token: str | None = Header(None)):
    _pro(x_pro_token)
    return settings.get()


@app.put("/api/pro/config")
def pro_guardar_config(changes: dict, x_pro_token: str | None = Header(None)):
    _pro(x_pro_token)
    return settings.update(changes)


@app.get("/api/pro/crudo")
def pro_crudo(segundos: float = 6.0, x_pro_token: str | None = Header(None)):
    _pro(x_pro_token)
    snap = HUB.link.snapshot(segundos)
    rows = snap["rows"][::2]
    return {"columnas": snap["columns"], "filas": rows, "hz": snap["hz"], "mensajes": snap["messages"][-30:],
            "perdidas": snap["gaps"]}


@app.post("/api/pro/comando")
def pro_comando(body: dict, x_pro_token: str | None = Header(None)):
    _pro(x_pro_token)
    cmd = str(body.get("cmd", ""))[:1]
    if cmd not in "tigamcsx" or not cmd:
        raise HTTPException(422, "Comando no permitido")
    HUB.link.send(cmd)
    return {"ok": True}


@app.get("/api/pro/saltos")
def pro_saltos(x_pro_token: str | None = Header(None)):
    _pro(x_pro_token)
    with db.session() as s:
        rows = s.exec(select(Salto).order_by(Salto.fecha.desc()).limit(200)).all()
        atletas = {a.id: a for a in s.exec(select(Atleta)).all()}
        return [{"id": j.id, "atleta": atletas[j.atleta_id].nombre if j.atleta_id in atletas else "?",
                 "banco": j.atleta_id in atletas and atletas[j.atleta_id].deporte == banco.MARCA_BANCO,
                 "fecha": j.fecha.isoformat(timespec="seconds"),
                 "indice": j.indice, "categoria": j.categoria, "confianza": j.confianza, "escenario": j.escenario,
                 "modo_salto": j.resultado.get("modo_salto", "cajon"),
                 "metricas": j.resultado.get("metricas", {})} for j in rows]


@app.get("/api/pro/saltos/{jid}")
def pro_salto(jid: int, x_pro_token: str | None = Header(None)):
    _pro(x_pro_token)
    with db.session() as s:
        j = s.get(Salto, jid)
        if not j:
            raise HTTPException(404)
        return {"id": j.id, "resultado": j.resultado, "serie": j.serie, "crudo": j.crudo}


# ------------------------------------------------------------------ websocket
@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await ws.accept()
    HUB.clients.add(ws)
    try:
        await ws.send_json(HUB.status())
        while True:
            await ws.receive_text()      # el cliente solo envía pings
    except WebSocketDisconnect:
        pass
    finally:
        HUB.clients.discard(ws)


# ------------------------------------------------------------------ frontend
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
