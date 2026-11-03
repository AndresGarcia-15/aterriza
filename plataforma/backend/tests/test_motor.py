"""Motor de retroalimentación con los 3 escenarios del gemelo digital
(firmware real + modelo de aterrizaje). Criterios de aceptación §9."""
import pandas as pd
import pytest

from app.demo import DATA, ensure_data
from app.engine import evaluate, session_summary
from app.metrics import analyze_dataframe


@pytest.fixture(scope="module")
def resultados():
    ensure_data()
    out = {}
    for s in range(3):
        df = pd.read_csv(DATA / f"esc{s}.csv")
        df["t"] = (df["t_us"] - df["t_us"].iloc[0]) / 1e6
        ms = analyze_dataframe(df)
        assert len(ms) == 2, "cada archivo del gemelo trae 2 aterrizajes"
        out[s] = [evaluate(m) for m in ms]
    return out


def test_controlado_bien_o_excelente(resultados):
    for r in resultados[0]:
        assert r["categoria"] in ("Bien", "Excelente")
        assert r["confianza"] == "alta"
        assert r["rigidez"] == "suave"


def test_rigido_a_corregir_con_flexionar_rodillas(resultados):
    for r in resultados[1]:
        assert r["categoria"] == "A corregir"
        assert r["rigidez"] == "rígida"
        top = r["acciones"][0]
        assert top["grupo"] == "rodillas"
        assert "flexiona más las rodillas" in top["mensaje"].lower()


def test_asimetrico_avisa_asimetria(resultados):
    for r in resultados[2]:
        assert any(a["tipo"] == "asimetria" for a in r["avisos"])
        grupos = [a["grupo"] for a in r["acciones"]]
        assert "simetria" in grupos and "valgo" in grupos
        assert r["metricas"]["valgo_der_max"] > 10


def test_orden_de_indices(resultados):
    assert resultados[0][0]["indice"] > resultados[2][0]["indice"] > resultados[1][0]["indice"]


def test_mensajes_cortos_con_valor_y_cita(resultados):
    for rs in resultados.values():
        for it in rs[0]["items"]:
            assert it["fuente"], f"{it['id']} sin fuente"
            if "mensaje" in it:
                assert len(it["mensaje"].split()) < 15, it["mensaje"]


def test_confianza_baja_por_saturacion(resultados):
    m = dict(resultados[0][0]["metricas"], saturado_pct=60.0)
    r = evaluate(m)
    assert r["confianza"] == "baja"
    assert r["avisos"][0]["texto"] == "Este salto no se pudo medir bien; repítelo."


def test_recomendacion_de_sesion(resultados):
    s = session_summary([resultados[1][0], resultados[1][1], resultados[0][0]])
    assert s["principal"]["grupo"] == "rodillas"
    assert s["principal"]["repeticiones"] >= 2


def test_aviso_y_no_diagnostico(resultados):
    r = resultados[0][0]
    assert r["aviso"] == "Herramienta educativa de técnica; no es un diagnóstico médico."
    texto = " ".join(i.get("mensaje", "") for i in r["items"]).lower()
    assert "riesgo" not in texto and "lesión" not in texto
