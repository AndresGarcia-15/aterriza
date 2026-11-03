"""Flujo completo por la API en modo demostración (tiempo real, ~10 s)."""
import time

from fastapi.testclient import TestClient

from app import db
from app.main import app


def test_flujo_demo(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "engine", db.create_engine(f"sqlite:///{tmp_path/'t.db'}"))
    with TestClient(app) as c:
        a = c.post("/api/atletas", json={"nombre": "Prueba", "masa_kg": 70}).json()
        assert c.post("/api/conectar", json={"fuente": "demo"}).status_code == 200
        time.sleep(1.5)
        assert c.post("/api/tara").json()["ok"]
        sid = c.post("/api/sesion", json={"atleta_id": a["id"]}).json()["id"]
        cats = []
        for esc in (0, 1, 2):
            assert c.post("/api/demo/saltar", json={"escenario": esc}).json()["ok"]
            for _ in range(60):
                time.sleep(0.1)
                saltos = c.get(f"/api/sesiones/{sid}").json()["saltos"]
                if len(saltos) == len(cats) + 1:
                    break
            cats.append(saltos[-1]["categoria"])
            while c.get("/api/estado").json()["demo"]["reproduciendo"]:
                time.sleep(0.1)
        assert cats[0] in ("Bien", "Excelente")
        assert cats[1] == "A corregir"
        s = c.get(f"/api/sesiones/{sid}").json()
        assert s["resumen"]["validos"] == 3
        j = c.get(f"/api/saltos/{s['saltos'][2]['id']}").json()
        assert any(x["tipo"] == "asimetria" for x in j["resultado"]["avisos"])
        assert len(j["serie"]["t"]) > 100
        # privacidad: exportar y borrar
        csv = c.get(f"/api/atletas/{a['id']}/exportar.csv")
        assert csv.status_code == 200 and csv.text.count("\n") == 4
        assert c.delete(f"/api/atletas/{a['id']}").json()["ok"]
        assert c.get(f"/api/atletas/{a['id']}").status_code == 404
        # modo profesional protegido
        assert c.get("/api/pro/reglas").status_code == 401
        c.post("/api/desconectar")
