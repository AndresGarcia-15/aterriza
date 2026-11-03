"""
Laboratorio biomecánico — Sistema portátil de evaluación del aterrizaje (UTB)

Un solo lugar para:
  · ver en vivo el ESP32 (simulador integrado, Wokwi o placa por USB), con el
    diagrama del sistema, la figura del atleta y las señales
  · enviar comandos, grabar ensayos y correr protocolos automáticos
  · ejecutar experimentos del gemelo digital y configurar Wokwi
  · analizar y comparar los ensayos grabados (se actualiza solo)

Ejecutar:  sh iniciar.sh   (o doble clic en "Abrir laboratorio.command")
"""
from __future__ import annotations

import time

import pandas as pd
from dash import Dash, Input, Output, State, ctx, dcc, html, no_update
from flask import request

try:  # gzip en las respuestas: clave al usar el panel por un túnel (devtunnels, ngrok…)
    import flask_compress  # noqa: F401
    _COMPRESS = True
except ImportError:
    _COMPRESS = False

from core import analysis, experiments, figures
from core.link import ESCENARIOS, LINK, find_usb_port

app = Dash(__name__, title="Laboratorio biomecánico", update_title=None, compress=_COMPRESS,
           external_stylesheets=["https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&"
                                 "family=IBM+Plex+Sans:wght@400;500;600&display=swap"])
server = app.server

R_OPTS = [{"label": "10 kΩ (actual)", "value": 10000}, {"label": "3,3 kΩ", "value": 3300},
          {"label": "1 kΩ (recomendada)", "value": 1000}]
ESC_OPTS = [{"label": v, "value": k} for k, v in ESCENARIOS.items()]
FR_OPTS = [{"label": f"{x:.2f}", "value": x} for x in (0.05, 0.10, 0.20)]


def card(title, *children, cls=""):
    return html.Section([html.H3(title, className="card-title"), *children], className=f"card {cls}")


def field(label, comp):
    return html.Label([html.Span(label, className="field-label"), comp], className="field")


def kpi(label, value, sub="", tone=""):
    return html.Div([html.Span(label, className="kpi-label"), html.Span(value, className=f"kpi-value {tone}"),
                     html.Span(sub, className="kpi-sub")], className="kpi")


# ================================================================ diseño
header = html.Header([
    html.Div([html.Div("◢", className="logo"),
              html.Div([html.H1("Laboratorio biomecánico"),
                        html.P("Sistema portátil de evaluación del aterrizaje · UTB")])], className="brand"),
    html.Div(id="hdr-status", className="pills"),
], className="topbar")

nav = dcc.RadioItems(id="nav", value="vivo", className="nav", inputClassName="nav-input", labelClassName="nav-item",
                     options=[{"label": "En vivo", "value": "vivo"}, {"label": "Experimentos", "value": "exp"},
                              {"label": "Ensayos", "value": "ens"}])

vivo = html.Div([
    html.Aside([
        card("Fuente de datos",
             dcc.RadioItems(id="src-kind", value="sim", className="seg", inputClassName="seg-input", labelClassName="seg-item",
                            options=[{"label": "Simulador", "value": "sim"}, {"label": "Wokwi", "value": "wokwi"},
                                     {"label": "ESP32 USB", "value": "usb"}]),
             html.Div([field("Escenario", dcc.Dropdown(id="sim-esc", options=ESC_OPTS, value=0, clearable=False)),
                       field("Resistencia del divisor", dcc.Dropdown(id="sim-r", options=R_OPTS, value=1000, clearable=False)),
                       field("Fracción de carga sobre el FSR", dcc.Dropdown(id="sim-tr", options=FR_OPTS, value=0.10, clearable=False)),
                       html.P("Firmware real ejecutado en el gemelo digital. Un aterrizaje cada 10 s.", className="hint")],
                      id="opts-sim"),
             html.Div([field("Dirección", dcc.Input(id="wk-url", value="rfc2217://localhost:4000", className="input")),
                       html.P("Inicia la simulación en VS Code y deja visible su pestaña.", className="hint")],
                      id="opts-wokwi"),
             html.Div([field("Puerto", dcc.Input(id="usb-port", placeholder="automático", className="input")),
                       html.P("Cable USB-C de datos. 921600 baudios.", className="hint")], id="opts-usb"),
             html.Div([html.Button("Conectar", id="btn-connect", className="btn primary"),
                       html.Button("Desconectar", id="btn-disconnect", className="btn")], className="row-btns"),
             html.Div(id="conn-msg", className="msg")),
        card("Comandos al firmware",
             html.Div([html.Button("Tara en quietud", id="cmd-tare-auto", className="btn primary", title="Espera 1 s de quietud y envía 't'"),
                       html.Button("Tara ya (t)", id="cmd-t", className="btn"),
                       html.Button("Estado (i)", id="cmd-i", className="btn"),
                       html.Button("Giroscopio (g)", id="cmd-g", className="btn"),
                       html.Button("Acelerómetro (a)", id="cmd-a", className="btn")], className="grid-btns"),
             html.Div(id="cmd-msg", className="msg")),
        card("Grabar ensayo",
             field("Participante", dcc.Input(id="rec-part", value="P01", className="input")),
             field("Ensayo", dcc.Input(id="rec-name", value="drop40cm", className="input")),
             html.Div([html.Button("● Grabar", id="rec-start", className="btn rec"),
                       html.Button("■ Detener", id="rec-stop", className="btn")], className="row-btns"),
             html.Div(id="rec-msg", className="msg")),
        card("Protocolo automático",
             html.P("Conecta, hace la tara cuando el atleta está quieto, graba y analiza.", className="hint"),
             field("Duración (s)", dcc.Slider(id="proto-dur", min=10, max=60, step=5, value=25,
                                              marks={10: "10", 25: "25", 40: "40", 60: "60"})),
             html.Button("Ejecutar protocolo", id="proto-btn", className="btn primary wide"),
             html.Div(id="proto-status", className="msg")),
    ], className="sidebar"),
    html.Main([
        html.Div([
            card("Sistema", dcc.Graph(id="sys-fig", config={"displayModeBar": False}), cls="grow"),
            card("Atleta", dcc.Graph(id="body-fig", config={"displayModeBar": False}), cls="body-card"),
        ], className="row"),
        card("Señales en vivo", dcc.Graph(id="live-fig", config={"displaylogo": False})),
        card("Consola del firmware", html.Pre(id="console", className="console")),
    ], className="main"),
], id="page-vivo", className="page")

exp = html.Div([
    html.Aside([
        card("Simular con el gemelo digital",
             field("Escenario", dcc.Dropdown(id="exp-esc", options=ESC_OPTS, value=0, clearable=False)),
             field("Resistencia del divisor", dcc.Dropdown(id="exp-r", options=R_OPTS, value=10000, clearable=False)),
             field("Fracción de carga", dcc.Dropdown(id="exp-tr", options=FR_OPTS, value=0.10, clearable=False)),
             field("Frecuencia de muestreo", dcc.Dropdown(id="exp-rate", value=100, clearable=False,
                                                          options=[{"label": "100 Hz", "value": 100}, {"label": "200 Hz", "value": 200}])),
             field("Promedio móvil FSR", dcc.Dropdown(id="exp-ma", value=3, clearable=False,
                                                      options=[{"label": "3 muestras (documento)", "value": 3}, {"label": "Sin promedio", "value": 1}])),
             html.Div([html.Button("Simular", id="exp-btn", className="btn primary"),
                       html.Button("Barrido completo", id="sweep-btn", className="btn", title="108 configuraciones")], className="row-btns")),
        card("Wokwi",
             html.Div(id="wk-current", className="hint"),
             html.Button("Enviar esta configuración a Wokwi", id="wk-send", className="btn wide"),
             html.Button("Recompilar firmware para Wokwi", id="wk-build", className="btn wide"),
             html.P("Wokwi se reinicia solo al cambiar el diagrama o el firmware.", className="hint"),
             html.Div(id="wk-msg", className="msg")),
        card("Registro de tareas", html.Pre(id="jobs-log", className="console small")),
    ], className="sidebar"),
    html.Main([
        html.Div(id="exp-kpis", className="kpis"),
        card("Real frente a medido", dcc.Graph(id="exp-fig", figure=figures.empty("Pulsa «Simular» para ejecutar el firmware contra el aterrizaje simulado", 600))),
        html.Div([card("Barrido: error del pico", dcc.Graph(id="hm-err", config={"displayModeBar": False}), cls="grow"),
                  card("Barrido: saturación", dcc.Graph(id="hm-sat", config={"displayModeBar": False}), cls="grow")], className="row"),
    ], className="main"),
], id="page-exp", className="page")

ens = html.Div([
    html.Aside([
        card("Ensayos grabados",
             html.P("Se actualiza solo. Elige uno para analizarlo.", className="hint"),
             dcc.RadioItems(id="ens-sel", className="list", labelClassName="list-item", inputClassName="list-input")),
        card("Comparar", html.P("Marca varios para superponer sus aterrizajes.", className="hint"),
             dcc.Checklist(id="ens-cmp", className="list", labelClassName="list-item", inputClassName="list-input")),
        card("Unidades de carga",
             dcc.Dropdown(id="ens-r", value=0, clearable=False,
                          options=[{"label": "Cuentas del ADC (crudo)", "value": 0}] +
                                  [{"label": f"Estimada con R = {o['label']}", "value": o["value"]} for o in R_OPTS]),
             html.P("La estimación usa la curva nominal del FSR 402; reemplázala por la calibración de cada sensor.", className="hint")),
    ], className="sidebar"),
    html.Main([
        html.Div(id="ens-kpis", className="kpis"),
        card("Aterrizajes detectados", html.Div(id="ens-table", className="table-wrap")),
        card("Señales del ensayo", dcc.Graph(id="ens-fig", figure=figures.empty("Elige un ensayo de la lista", 600))),
        card("Comparación", dcc.Graph(id="ens-cmp-fig", figure=figures.empty("Marca ensayos en «Comparar»", 380))),
    ], className="main"),
], id="page-ens", className="page")

app.layout = html.Div([
    header, nav, vivo, exp, ens,
    dcc.Interval(id="tick-live", interval=300), dcc.Interval(id="tick-slow", interval=1200),
    dcc.Store(id="exp-job"), dcc.Store(id="sweep-job"), dcc.Store(id="proto-job"), dcc.Store(id="wk-job"),
    dcc.Store(id="exp-rendered"), dcc.Store(id="sweep-version", data=0), dcc.Store(id="ens-sig"),
    dcc.Store(id="remote"), dcc.Location(id="loc"),
], className="app")


# ============================================================== callbacks
def _is_remote() -> bool:
    """True si la página llega por un túnel o desde otro equipo. Los túneles
    (devtunnels de VS Code, ngrok, Cloudflare) presentan la petición como si
    viniera de localhost, pero añaden cabeceras X-Forwarded-*."""
    h = request.headers
    if any(h.get(k) for k in ("X-Forwarded-For", "X-Forwarded-Host", "X-Original-Host", "X-Ms-Forwarded-Host", "Forwarded")):
        return True
    host = (h.get("Host") or request.host or "").split(":")[0]
    return host not in ("127.0.0.1", "localhost", "::1")


@app.callback(Output("remote", "data"), Output("tick-live", "interval"), Input("loc", "pathname"))
def detect_remote(_):
    """Abierto desde otro equipo (túnel o red): menos datos y menos actualizaciones."""
    remote = _is_remote()
    return remote, 1000 if remote else 300


@app.callback(Output("page-vivo", "style"), Output("page-exp", "style"), Output("page-ens", "style"), Input("nav", "value"))
def show_page(v):
    on, off = {"display": "grid"}, {"display": "none"}
    return (on if v == "vivo" else off, on if v == "exp" else off, on if v == "ens" else off)


@app.callback(Output("opts-sim", "style"), Output("opts-wokwi", "style"), Output("opts-usb", "style"), Input("src-kind", "value"))
def show_src(k):
    on, off = {"display": "block"}, {"display": "none"}
    return (on if k == "sim" else off, on if k == "wokwi" else off, on if k == "usb" else off)


def _pills(s):
    st = s["status"]
    tone = {"conectado": "ok" if s["fresh"] else "warn", "conectando": "warn", "reconectando": "warn", "error": "bad"}.get(st, "")
    pills = [html.Span([html.I(className=f"dot {tone}"), st if st != "conectado" else s["label"]], className="pill")]
    if st == "conectado":
        pills += [html.Span(f"{s['hz']:.0f} Hz", className="pill mono"),
                  html.Span(f"{s['gaps']} perdidas", className=f"pill mono {'bad' if s['gaps'] else ''}")]
    if s["recording"]:
        pills.append(html.Span([html.I(className="dot rec"), f"grabando · {s['rec_rows']} muestras"], className="pill rec"))
    return pills


@app.callback(Output("hdr-status", "children"), Output("sys-fig", "figure"), Output("body-fig", "figure"),
              Output("live-fig", "figure"), Output("console", "children"), Output("rec-msg", "children"),
              Input("tick-live", "n_intervals"), State("nav", "value"), State("remote", "data"))
def live(_, page, remote):
    s = LINK.snapshot(8.0)
    pills = _pills(s)
    if page != "vivo":
        return pills, no_update, no_update, no_update, no_update, no_update
    console = "\n".join(s["messages"][-40:]) or "Sin mensajes todavía."
    rec = f"Grabando {s['rec_name']} · {s['rec_rows']} muestras" if s["recording"] else (
        f"Último: {s['rec_name']}" if s["rec_name"] else "")
    return pills, figures.fig_system(s), figures.fig_body(s), figures.fig_live(s, max_points=160 if remote else 400), console, rec


def _connect_kw(kind, esc, r, tr, url, port):
    if kind == "sim":
        return {"escenario": esc, "r": r, "transfer": tr}
    if kind == "wokwi":
        return {"url": url}
    return {"port": port or None}


@app.callback(Output("conn-msg", "children"), Input("btn-connect", "n_clicks"), Input("btn-disconnect", "n_clicks"),
              State("src-kind", "value"), State("sim-esc", "value"), State("sim-r", "value"), State("sim-tr", "value"),
              State("wk-url", "value"), State("usb-port", "value"), prevent_initial_call=True)
def connect(_, __, kind, esc, r, tr, url, port):
    if ctx.triggered_id == "btn-disconnect":
        LINK.disconnect()
        return "Desconectado."
    if kind == "usb" and not (port or find_usb_port()):
        return "No se detecta el ESP32 por USB. Revisa el cable (de datos) o escribe el puerto."
    experiments.JOBS.start("conectar", lambda log: LINK.connect(kind, **_connect_kw(kind, esc, r, tr, url, port)))
    return "Conectando… (la primera vez el simulador compila el gemelo, ~20 s)" if kind == "sim" else "Conectando…"


@app.callback(Output("cmd-msg", "children"),
              Input("cmd-tare-auto", "n_clicks"), Input("cmd-t", "n_clicks"), Input("cmd-i", "n_clicks"),
              Input("cmd-g", "n_clicks"), Input("cmd-a", "n_clicks"), prevent_initial_call=True)
def command(*_):
    if LINK.snapshot(1)["status"] != "conectado":
        return "Primero conecta una fuente."
    t = ctx.triggered_id
    if t == "cmd-tare-auto":
        LINK.request_tare_when_still()
        return "Esperando 1 s de quietud para la tara…"
    letter = {"cmd-t": "t", "cmd-i": "i", "cmd-g": "g", "cmd-a": "a"}[t]
    LINK.send(letter)
    return f"Enviado «{letter}». La respuesta aparece en la consola."


@app.callback(Output("rec-msg", "children", allow_duplicate=True), Input("rec-start", "n_clicks"), Input("rec-stop", "n_clicks"),
              State("rec-part", "value"), State("rec-name", "value"), prevent_initial_call=True)
def record(_, __, part, name):
    if ctx.triggered_id == "rec-stop":
        p = LINK.stop_recording()
        return f"Guardado: {p.name}" if p else "No había grabación en curso."
    if LINK.snapshot(1)["status"] != "conectado":
        return "Primero conecta una fuente."
    p = LINK.start_recording(part, name)
    return f"Grabando {p.name}" if p else "Ya hay una grabación en curso."


@app.callback(Output("proto-job", "data"), Input("proto-btn", "n_clicks"),
              State("src-kind", "value"), State("sim-esc", "value"), State("sim-r", "value"), State("sim-tr", "value"),
              State("wk-url", "value"), State("usb-port", "value"), State("proto-dur", "value"),
              State("rec-part", "value"), State("rec-name", "value"), prevent_initial_call=True)
def protocol(_, kind, esc, r, tr, url, port, dur, part, name):
    info = f"fuente={kind}" + (f", escenario={ESCENARIOS[esc]}, R={r}, fracción={tr}" if kind == "sim" else "")
    return experiments.JOBS.start("protocolo", experiments.run_protocol, LINK, kind,
                                  _connect_kw(kind, esc, r, tr, url, port), part, name, float(dur), info)


@app.callback(Output("exp-job", "data"), Input("exp-btn", "n_clicks"), State("exp-esc", "value"), State("exp-r", "value"),
              State("exp-tr", "value"), State("exp-rate", "value"), State("exp-ma", "value"), prevent_initial_call=True)
def run_exp(_, esc, r, tr, rate, ma):
    return experiments.JOBS.start("simulación", experiments.run_single, int(esc), float(r), float(tr), int(rate), int(ma))


@app.callback(Output("sweep-job", "data"), Input("sweep-btn", "n_clicks"), prevent_initial_call=True)
def run_sweep(_):
    if experiments.JOBS.busy("barrido"):
        return no_update
    return experiments.JOBS.start("barrido", experiments.run_sweep)


@app.callback(Output("wk-msg", "children"), Output("wk-job", "data"), Input("wk-send", "n_clicks"), Input("wk-build", "n_clicks"),
              State("exp-esc", "value"), State("exp-r", "value"), State("exp-tr", "value"), prevent_initial_call=True)
def wokwi(_, __, esc, r, tr):
    if ctx.triggered_id == "wk-send":
        try:
            experiments.set_wokwi_config(int(esc), float(r), float(tr))
        except Exception as e:  # noqa: BLE001
            return f"No se pudo escribir diagram.json: {e}", no_update
        return f"Wokwi: escenario «{ESCENARIOS[esc]}», R = {r} Ω, fracción {tr:.2f}.", no_update
    return "Compilando firmware para Wokwi…", experiments.JOBS.start("firmware Wokwi", experiments.build_firmware_wokwi)


def _job_line(j):
    dur = (j["ended"] or time.time()) - j["started"]
    mark = {"corriendo": "…", "ok": "✓", "error": "✗"}[j["state"]]
    return f"{mark} {j['name']} ({dur:.0f} s)\n" + "\n".join("   " + l for l in j["log"][-6:])


@app.callback(Output("jobs-log", "children"), Output("proto-status", "children"), Output("exp-kpis", "children"),
              Output("exp-fig", "figure"), Output("exp-rendered", "data"), Output("sweep-version", "data"),
              Output("wk-current", "children"),
              Input("tick-slow", "n_intervals"), State("exp-job", "data"), State("sweep-job", "data"),
              State("proto-job", "data"), State("exp-rendered", "data"), State("sweep-version", "data"))
def slow(_, exp_job, sweep_job, proto_job, rendered, sweep_ver):
    jobs = experiments.JOBS.recent(8)
    log = "\n\n".join(_job_line(j) for j in jobs) or "Sin tareas todavía."
    proto = ""
    if proto_job:
        j = experiments.JOBS.get(proto_job)
        if j:
            proto = {"corriendo": "En curso: ", "ok": "Terminado: ", "error": "Error: "}[j["state"]] + (j["log"][-1].split("  ", 1)[-1] if j["log"] else "")
    kpis, fig, new_rendered = no_update, no_update, no_update
    if exp_job and exp_job != rendered:
        j = experiments.JOBS.get(exp_job)
        if j and j["state"] == "ok":
            m = j["result"]["metrics"]
            err = 100 * (m["pico_fuerza_estimada_N"] / m["pico_fuerza_real_N"] - 1)
            tone = "ok" if abs(err) <= 5 else ("warn" if abs(err) <= 15 else "bad")
            kpis = [kpi("FSR saturados", f"{m['pct_saturado']:.1f} %", "del aterrizaje", "bad" if m["pct_saturado"] > 10 else ""),
                    kpi("Error del pico de carga", f"{err:+.1f} %", f"{m['pico_fuerza_estimada_N']:.0f} de {m['pico_fuerza_real_N']:.0f} N", tone),
                    kpi("Error RMS rodilla", f"{m['rmse_rodilla']:.2f}°", f"pico {m['pico_rodilla_medido']:.1f}° / {m['pico_rodilla_real']:.1f}°"),
                    kpi("Error RMS tronco", f"{m['rmse_tronco']:.2f}°", f"pico {m['pico_tronco_medido']:.1f}° / {m['pico_tronco_real']:.1f}°")]
            df = pd.read_csv(j["result"]["csv"])
            fig, new_rendered = figures.fig_experiment(df), exp_job
        elif j and j["state"] == "error":
            new_rendered = exp_job
            fig = figures.empty("La simulación falló: revisa el registro de tareas", 600)
    new_ver = no_update
    if sweep_job:
        j = experiments.JOBS.get(sweep_job)
        if j and j["state"] == "ok" and (sweep_ver or 0) != j["ended"]:
            new_ver = j["ended"]
    try:
        c = experiments.wokwi_config()
        wk = f"Configuración actual en Wokwi: {ESCENARIOS[c['escenario']]}, R = {c['r']:.0f} Ω, fracción {c['transfer']:.2f}."
    except Exception:  # noqa: BLE001
        wk = "No se encontró simulacion/diagram.json."
    return log, proto, kpis, fig, new_rendered, new_ver, wk


@app.callback(Output("hm-err", "figure"), Output("hm-sat", "figure"), Input("sweep-version", "data"), Input("exp-esc", "value"))
def heatmaps(_, esc):
    sw = experiments.load_sweep()
    if sw is None:
        e = figures.empty("Pulsa «Barrido completo»", 360)
        return e, e
    return figures.fig_heatmap(sw, int(esc), "error"), figures.fig_heatmap(sw, int(esc), "pct_saturado")


@app.callback(Output("ens-sel", "options"), Output("ens-cmp", "options"), Output("ens-sel", "value"), Output("ens-sig", "data"),
              Input("tick-slow", "n_intervals"), State("ens-sel", "value"), State("ens-sig", "data"))
def ens_list(_, sel, sig):
    items = analysis.list_ensayos()
    new_sig = "|".join(f"{i['path']}:{i['grabando']}" for i in items)
    if new_sig == sig:
        return no_update, no_update, no_update, no_update
    opts = [{"label": html.Span([html.B(f"{i['participante']} · {i['ensayo']}"),
                                 html.Span(("● grabando" if i["grabando"] else i["fecha"].replace("T", " ")), className="list-sub")]),
             "value": i["path"]} for i in items]
    cmp_opts = [{"label": f"{i['participante']} · {i['ensayo']} · {i['fecha'][11:16]}", "value": i["path"]} for i in items]
    paths_now = [i["path"] for i in items]
    new_sel = no_update
    if sel not in paths_now:
        new_sel = paths_now[0] if paths_now else None
    elif items and not items[0]["grabando"] and sig and items[0]["path"] not in sig:
        new_sel = items[0]["path"]          # un ensayo nuevo terminó: mostrarlo
    return opts, cmp_opts, new_sel, new_sig


_ens_cache: dict = {}


def _load(path):
    import os
    m = os.path.getmtime(path)
    if path not in _ens_cache or _ens_cache[path][0] != m:
        df, meta = analysis.load(path)
        _ens_cache[path] = (m, df, meta, analysis.detect_landings(df))
    return _ens_cache[path][1:]


@app.callback(Output("ens-kpis", "children"), Output("ens-table", "children"), Output("ens-fig", "figure"),
              Input("ens-sel", "value"), Input("ens-r", "value"), Input("ens-sig", "data"))
def ens_view(path, r, _sig):
    if not path:
        return [], html.P("No hay ensayos todavía. Graba uno en «En vivo» o ejecuta el protocolo automático.", className="hint"), \
            figures.empty("Elige un ensayo de la lista", 600)
    try:
        df, meta, lands = _load(path)
    except Exception as e:  # noqa: BLE001
        return [], html.P(f"No se pudo leer el ensayo: {e}", className="hint"), figures.empty("Error de lectura", 600)
    s = analysis.summary(df, meta)
    k = [kpi("Duración", f"{s.get('duracion_s', 0):.1f} s", f"{s['muestras']} muestras"),
         kpi("Frecuencia", f"{s.get('frecuencia_hz', 0):.1f} Hz", f"{s.get('perdidas', 0)} perdidas", "bad" if s.get("perdidas") else ""),
         kpi("Aterrizajes", str(len(lands)), "detectados por fase de vuelo"),
         kpi("FSR saturados", f"{s.get('saturado_pct', 0):.1f} %", "del ensayo", "bad" if s.get("saturado_pct", 0) > 10 else "")]
    if lands:
        avg = lambda key: sum(l[key] for l in lands if l.get(key) is not None) / max(1, sum(1 for l in lands if l.get(key) is not None))
        k += [kpi("Rodilla pico (media)", f"{avg('rodilla_pico'):.1f}°", f"absorción {avg('absorcion_ms'):.0f} ms"),
              kpi("Asimetría (media)", f"{avg('asimetria_pct'):+.1f} %", "+ = más carga izquierda")]
    cols = [("#", None), ("Contacto (s)", "t_contacto_s"), ("Vuelo (ms)", "vuelo_ms"), ("Rodilla contacto (°)", "rodilla_contacto"),
            ("Rodilla pico (°)", "rodilla_pico"), ("Absorción (ms)", "absorcion_ms"), ("Tronco pico (°)", "tronco_pico"),
            ("FSR pico (cuentas)", "fsr_pico_cuentas"), ("Saturado (%)", "saturado_pct"), ("Asimetría (%)", "asimetria_pct")]
    table = html.Table([html.Thead(html.Tr([html.Th(c) for c, _ in cols])),
                        html.Tbody([html.Tr([html.Td(str(i + 1))] + [html.Td("—" if l.get(key) is None else str(l[key])) for _, key in cols[1:]])
                                    for i, l in enumerate(lands)])], className="table") if lands else \
        html.P("No se detectaron aterrizajes (se buscan fases de vuelo con las plantillas descargadas).", className="hint")
    return k, table, figures.fig_ensayo(df, lands, r or None)


@app.callback(Output("ens-cmp-fig", "figure"), Input("ens-cmp", "value"))
def ens_compare(paths_):
    if not paths_:
        return figures.empty("Marca ensayos en «Comparar»", 380)
    items = []
    for p in paths_[:6]:
        df, meta, lands = _load(p)
        items.append((f"{meta.get('participante', '?')}·{meta.get('ensayo', '')}", df, lands))
    return figures.fig_compare(items)


if __name__ == "__main__":
    import webbrowser
    import threading
    threading.Timer(1.5, lambda: webbrowser.open("http://127.0.0.1:8050")).start()
    app.run(debug=False, host="127.0.0.1", port=8050)
