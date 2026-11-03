"""Banco de pruebas: banco virtual + salto simulado con las manos → análisis real."""
import time

from fastapi.testclient import TestClient

from app import db
from app.main import app


def _salto_manos(c, antepie_primero=True):
    c.post("/api/banco/virtual", json={"fsr": [True, True, True, True]})
    time.sleep(2.0)                                  # "de pie": carga estable
    c.post("/api/banco/virtual", json={"fsr": [False, False, False, False]})
    time.sleep(0.3)                                  # vuelo
    if antepie_primero:
        c.post("/api/banco/virtual", json={"fsr": [None, 2800, None, 2800]})
        time.sleep(0.05)
        c.post("/api/banco/virtual", json={"fsr": [2600, None, 2600, None]})
    else:
        c.post("/api/banco/virtual", json={"fsr": [True, True, True, True]})


def _esperar(c, n, timeout=6.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        saltos = c.get("/api/banco/saltos").json()
        if len(saltos) >= n:
            return saltos
        time.sleep(0.1)
    raise AssertionError("no se detectó el salto")


def test_banco_virtual_sin_imu(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "engine", db.create_engine(f"sqlite:///{tmp_path/'t.db'}"))
    with TestClient(app) as c:
        c.post("/api/atletas", json={"nombre": "Real"})
        assert c.post("/api/conectar", json={"fuente": "virtual", "imu": {"T": False, "P": False, "L": False}}).status_code == 200
        time.sleep(0.5)
        st = c.get("/api/estado").json()
        assert st["virtual"]["imu"] == {"T": False, "P": False, "L": False}
        assert all(i["error"] for i in st["imu"])
        ses = c.post("/api/banco/iniciar").json()
        assert c.get("/api/estado").json()["banco"] is True
        _salto_manos(c)
        saltos = _esperar(c, 1)
        j = c.get(f"/api/saltos/{saltos[0]['id']}").json()
        r = j["resultado"]
        assert r["confianza"] != "baja", r["motivos_confianza"]
        est = {i["id"]: i["estado"] for i in r["items"]}
        assert est["rodilla_contacto"] == "no_disponible" and est["valgo"] == "no_disponible"
        assert est["apoyo"] == "ok"                  # antepié 50 ms antes que el talón
        assert est["simetria_carga"] == "ok"
        assert r["banco"]["usadas"] == []
        assert j["atleta"]["nombre"] == "Banco de pruebas"
        # el atleta del banco no aparece en la lista de atletas
        assert [a["nombre"] for a in c.get("/api/atletas").json()] == ["Real"]
        # reportes de la prueba guiada
        rep = c.post("/api/banco/reportes", json={"fuente": "virtual", "aprobado": True,
                                                  "checks": [{"id": "fsr_P1_H", "estado": "ok"}]}).json()
        assert rep["id"] and c.get("/api/banco/reportes").json()[0]["checks"][0]["estado"] == "ok"
        c.post("/api/banco/fin")
        assert c.get("/api/estado").json()["banco"] is False
        assert ses["sesion_id"]
        c.post("/api/desconectar")


def test_banco_virtual_con_imu_y_giro(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "engine", db.create_engine(f"sqlite:///{tmp_path/'t.db'}"))
    with TestClient(app) as c:
        c.post("/api/conectar", json={"fuente": "virtual"})
        time.sleep(1.3)
        assert c.post("/api/tara").json()["ok"]
        c.post("/api/banco/iniciar")
        c.post("/api/banco/virtual", json={"giro": "P"})
        time.sleep(0.5)
        st = c.get("/api/estado").json()
        assert st["tara"] and all(i["ok"] for i in st["imu"])
        time.sleep(1.4)
        _salto_manos(c, antepie_primero=False)
        saltos = _esperar(c, 1)
        r = c.get(f"/api/saltos/{saltos[0]['id']}").json()["resultado"]
        assert r["banco"]["usadas"] == ["T", "P", "L"]
        est = {i["id"]: i["estado"] for i in r["items"]}
        assert est["rodilla_contacto"] != "no_disponible"
        assert est["apoyo"] in ("parcial", "no")     # apoyo simultáneo: no hubo antepié → talón
        c.post("/api/desconectar")


def test_atleta_con_prototipo_sin_lumbar(tmp_path, monkeypatch):
    """Como el prototipo real: IMU de muslo y pierna, lumbar aún no instalada."""
    monkeypatch.setattr(db, "engine", db.create_engine(f"sqlite:///{tmp_path/'t.db'}"))
    with TestClient(app) as c:
        a = c.post("/api/atletas", json={"nombre": "Prototipo"}).json()
        c.post("/api/conectar", json={"fuente": "virtual", "imu": {"T": True, "P": True, "L": False}})
        time.sleep(1.3)
        st = c.get("/api/estado").json()
        assert [i["ausente"] for i in st["imu"]] == [False, False, True]
        assert not any(f["visto"] for f in st["fsr"])          # nadie ha presionado todavía
        assert c.post("/api/tara").json()["ok"]
        sid = c.post("/api/sesion", json={"atleta_id": a["id"]}).json()["id"]
        _salto_manos(c)
        for _ in range(60):
            saltos = c.get(f"/api/sesiones/{sid}").json()["saltos"]
            if saltos:
                break
            time.sleep(0.1)
        r = c.get(f"/api/saltos/{saltos[0]['id']}").json()["resultado"]
        assert r["confianza"] != "baja", r["motivos_confianza"]
        est = {i["id"]: i["estado"] for i in r["items"]}
        assert est["rodilla_contacto"] != "no_disponible" and est["valgo"] != "no_disponible"
        assert est["tronco_contacto"] == "no_disponible" and est["cadera"] == "no_disponible"
        assert any(x["tipo"] == "sensores" for x in r["avisos"])
        assert "banco" not in r and r["sensores"]["faltan"] == ["lumbar"]
        assert all(f["visto"] for f in c.get("/api/estado").json()["fsr"])
        c.post("/api/desconectar")


def test_tara_con_sesgo_de_giroscopio():
    """Un MPU6050 quieto con el sesgo sin calibrar marca ~ -3 °/s: igual debe detectarse la quietud."""
    import random
    from app.bridge import Link

    class Fuente:
        def __init__(self):
            self.enviado = b""

        def write(self, data):
            self.enviado += data

    L = Link()
    cols = ["seq", "t_us", "P1_H", "P1_F", "P2_H", "P2_F"] + [f"{k}_{c}" for k in "TPL" for c in
            ("ax", "ay", "az", "gx", "gy", "gz", "mx", "my", "mz")] + ["knee_flex", "trunk_flex", "flags"]
    L._handle("#COLS," + ",".join(cols))
    L.source = Fuente()
    L.request_tare_when_still()
    rng = random.Random(1)
    for i in range(130):
        imu = []
        for b in (-2.4, -3.3, 0.0):
            imu += [1.0, 0.0, 0.03, b + rng.gauss(0, 0.3), 0.5 + rng.gauss(0, 0.3), 0.8 + rng.gauss(0, 0.3), 0, 0, 0]
        L._handle(",".join(str(x) for x in [i, i * 10000, 0, 0, 0, 0, *imu, 0, 0, 1024 + 64]))
    assert L.source.enviado == b"t"


def test_modo_salto_y_pro(tmp_path, monkeypatch):
    """El modo de salto se guarda, viaja en el estado y en el resultado; los saltos de banco salen marcados en Pro."""
    from app import settings
    monkeypatch.setattr(db, "engine", db.create_engine(f"sqlite:///{tmp_path/'t.db'}"))
    monkeypatch.setattr(settings, "PATH", tmp_path / "config.json")
    monkeypatch.setattr(settings, "_cache", None)
    with TestClient(app) as c:
        assert c.put("/api/modo", json={"modo": "nada"}).status_code == 422
        assert c.put("/api/modo", json={"modo": "sitio"}).json() == {"modo_salto": "sitio"}
        assert settings.get()["modo_salto"] == "sitio"
        r = c.post("/api/conectar", json={"fuente": "virtual", "imu": {"T": True, "P": True, "L": False}})
        assert r.status_code == 200, r.text
        c.post("/api/banco/iniciar")
        time.sleep(1.5)                                  # reposo sin carga antes de "ponerse de pie"
        n0 = len(c.get("/api/banco/saltos").json())
        _salto_manos(c)
        saltos = _esperar(c, n0 + 1)
        j = c.get(f"/api/saltos/{saltos[0]['id']}").json()
        assert j["resultado"]["modo_salto"] == "sitio"
        # el vuelo se mide desde que se soltó (no desde el reposo sin carga de antes)
        assert 200 <= j["resultado"]["metricas"]["vuelo_ms"] <= 600, j["resultado"]["metricas"]["vuelo_ms"]
        tok = c.post("/api/pro/entrar", json={"pin": str(settings.get()["pin"])}).json()["token"]
        filas = c.get("/api/pro/saltos", headers={"x-pro-token": tok}).json()
        fila = next(f for f in filas if f["id"] == saltos[0]["id"])
        assert fila["banco"] is True and fila["modo_salto"] == "sitio"
        assert c.post("/api/pro/comando", json={"cmd": "c"}, headers={"x-pro-token": tok}).json() == {"ok": True}
        c.put("/api/modo", json={"modo": "cajon"})
        c.post("/api/banco/fin")
        c.post("/api/desconectar")
