"""Figuras Plotly del laboratorio (tema oscuro de instrumento)."""
from __future__ import annotations

import math

import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots

BG, PANEL, LINE, GRID = "#0e1317", "#151c21", "#26333c", "#1d272e"
TEXT, MUTED = "#e4ebef", "#8796a1"
AMBER, TEAL, BLUE, VIOLET, RED, GREEN = "#f0a03c", "#39b3a5", "#5aa1f2", "#b28cf2", "#e5484d", "#4cc38a"
FSR_COLORS = {"P1_H": TEAL, "P1_F": BLUE, "P2_H": AMBER, "P2_F": VIOLET}
FSR_LABEL = {"P1_H": "Talón izq.", "P1_F": "Antepié izq.", "P2_H": "Talón der.", "P2_F": "Antepié der."}
IMU = [("T", "Muslo"), ("P", "Pierna"), ("L", "Lumbar")]
FONT = "IBM Plex Sans, -apple-system, Segoe UI, sans-serif"
MONO = "IBM Plex Mono, ui-monospace, Menlo, monospace"


def subplot_style(fig):
    fig.update_annotations(font=dict(size=12, color=MUTED, family=FONT))
    fig.update_layout(margin=dict(l=52, r=16, t=64, b=40),
                      legend=dict(orientation="h", y=1.07, yanchor="bottom", x=0, bgcolor="rgba(0,0,0,0)"))
    return fig


def theme(fig, height=None, legend=True):
    fig.update_layout(
        paper_bgcolor=PANEL, plot_bgcolor=PANEL, font=dict(family=FONT, color=TEXT, size=12),
        margin=dict(l=48, r=16, t=28, b=36), height=height, showlegend=legend,
        legend=dict(orientation="h", y=1.02, yanchor="bottom", x=0, bgcolor="rgba(0,0,0,0)", font=dict(size=11)),
        hoverlabel=dict(bgcolor="#1f2a31", bordercolor=LINE, font=dict(family=MONO, size=11, color=TEXT)),
        uirevision="keep")
    fig.update_xaxes(gridcolor=GRID, zerolinecolor=LINE, linecolor=LINE, tickfont=dict(color=MUTED, size=11))
    fig.update_yaxes(gridcolor=GRID, zerolinecolor=LINE, linecolor=LINE, tickfont=dict(color=MUTED, size=11))
    for a in fig.layout.annotations or []:
        if a.font is None or a.font.size is None:
            a.font = dict(size=12, color=MUTED, family=FONT)
    return fig


def empty(msg, height=260):
    fig = go.Figure()
    fig.add_annotation(text=msg, x=0.5, y=0.5, xref="paper", yref="paper", showarrow=False,
                       font=dict(color=MUTED, size=13))
    fig.update_xaxes(visible=False)
    fig.update_yaxes(visible=False)
    return theme(fig, height, legend=False)


def _rows_to_cols(snap):
    cols, rows = snap["columns"], snap["rows"]
    if not cols or not rows:
        return None
    arr = np.asarray(rows, dtype=float)
    return {c: arr[:, i] for i, c in enumerate(cols)}


def _heat(v):
    """0-4095 → color (frío → ámbar → rojo saturado)."""
    if v >= 4000:
        return RED
    x = max(0.0, min(1.0, v / 4000.0))
    stops = [(0, (38, 51, 60)), (0.35, (57, 179, 165)), (0.75, (240, 160, 60)), (1.0, (229, 110, 60))]
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if x <= b:
            k = (x - a) / (b - a)
            c = [int(ca[i] + (cb[i] - ca[i]) * k) for i in range(3)]
            return f"rgb({c[0]},{c[1]},{c[2]})"
    return AMBER


def _foot_path(cx, mirror=False):
    """Huella plantar estilizada (talón estrecho, antepié ancho)."""
    m = -1 if mirror else 1
    X = lambda dx: f"{cx + m * dx:.2f}"
    return (f"M {X(0)},5 C {X(3.8)},5 {X(4.4)},13 {X(3.9)},21 C {X(3.4)},29 {X(5.6)},38 {X(5.6)},46 "
            f"C {X(5.6)},54 {X(3.2)},58 {X(0.2)},58 C {X(-3)},58 {X(-5)},54 {X(-5)},47 "
            f"C {X(-5)},39 {X(-3.2)},30 {X(-3.6)},21 C {X(-4)},13 {X(-3.8)},5 {X(0)},5 Z")


# ------------------------------------------------------- diagrama del sistema
def fig_system(snap):
    d = _rows_to_cols(snap)
    connected = snap["status"] == "conectado"
    fresh = connected and snap["fresh"]
    last = {c: v[-1] for c, v in d.items()} if d is not None else {}
    flags = int(last.get("flags", 0))
    fig = go.Figure()
    sh, an = [], []

    def text(x, y, t, size=11, color=TEXT, anchor="center", family=FONT):
        an.append(dict(x=x, y=y, text=t, showarrow=False, xanchor=anchor, yanchor="middle",
                       font=dict(size=size, color=color, family=family)))

    # ESP32
    sh.append(dict(type="rect", x0=40, x1=58, y0=12, y1=48, line=dict(color="#3d5a4c", width=1.5), fillcolor="#142219"))
    sh.append(dict(type="rect", x0=44, x1=54, y0=35, y1=45, line=dict(color="#55606a", width=1), fillcolor="#1f2830"))
    text(49, 40, "<b>ESP32</b>", 12)
    text(49, 30, "WROOM-32D", 10, MUTED)
    st_col = GREEN if fresh else (AMBER if connected else MUTED)
    text(49, 23, f"{snap['hz']:.0f} Hz" if fresh else ("esperando" if connected else "sin conexión"), 13, st_col, family=MONO)
    text(49, 16, "USB-C → PC", 9, MUTED)

    # IMU (cada una en su bus I2C)
    boxes = {"T": 51, "P": 30, "L": 9}
    pins = {"T": "I2C0 · SDA21 SCL22", "P": "I2C1 · SDA16 SCL17", "L": "soft · SDA18 SCL19"}
    for k, (key, name) in enumerate(IMU):
        y = boxes[key]
        err = bool(flags & (1 << (4 + k)))
        col = RED if err else (GREEN if fresh else LINE)
        sh.append(dict(type="rect", x0=1, x1=28, y0=y - 5.5, y1=y + 5.5, line=dict(color=col, width=1.5), fillcolor="#18222a"))
        text(2.5, y + 3, f"<b>IMU {name}</b>", 11, TEXT, "left")
        if d is not None:
            a = [last.get(f"{key}_a{c}", 0.0) for c in "xyz"]
            g = [last.get(f"{key}_g{c}", 0.0) for c in "xyz"]
            amag, gmag = math.sqrt(sum(v * v for v in a)), math.sqrt(sum(v * v for v in g))
            text(2.5, y - 0.3, f"|a| {amag:.2f} g  ω {gmag:.0f}°/s", 10,
                 AMBER if (amag > 1.3 or amag < 0.5) else TEXT, "left", MONO)
        else:
            text(2.5, y - 0.3, "GY-85 (9 ejes)", 10, MUTED, "left")
        text(2.5, y - 3.4, pins[key], 9, MUTED, "left", MONO)
        wy = {"T": 42, "P": 30, "L": 18}[key]
        sh.append(dict(type="path", path=f"M 28,{y} C 34,{y} 34,{wy} 40,{wy}", line=dict(color=col, width=2)))

    # Plantillas
    L, R = 73.0, 90.0
    sh.append(dict(type="path", path=_foot_path(L, mirror=True), line=dict(color=LINE, width=1.5), fillcolor="#172027"))
    sh.append(dict(type="path", path=_foot_path(R), line=dict(color=LINE, width=1.5), fillcolor="#172027"))
    text(L, 61, "Pie izquierdo", 10, MUTED)
    text(R, 61, "Pie derecho", 10, MUTED)
    sensors = {"P1_H": (L, 13, "GPIO32", f"M 58,22 C 65,22 66,13 {L - 4},13"),
               "P1_F": (L - 0.3, 44, "GPIO33", f"M 58,40 C 65,40 66,44 {L - 4.5},44"),
               "P2_H": (R, 13, "GPIO34", f"M 58,18 C 64,18 64,1.5 72,1.5 L 85,1.5 C 89,1.5 {R},6 {R},9"),
               "P2_F": (R + 0.3, 44, "GPIO35", f"M 58,45 C 63,45 63,63 72,63 L 85,63 C 89,63 {R + 0.3},54 {R + 0.3},48.5")}
    for ch, (x, y, gp, wire) in sensors.items():
        v = float(last.get(ch, 0.0))
        col = _heat(v) if d is not None else "#26333c"
        r = 2.2 + 1.5 * min(v, 4095) / 4095
        sat = v >= 4000
        sh.append(dict(type="path", path=wire, line=dict(color=RED if sat else (GREEN if fresh else LINE), width=1.4)))
        sh.append(dict(type="circle", x0=x - r, x1=x + r, y0=y - r, y1=y + r, line=dict(color=col, width=1.5), fillcolor=col))
        text(x, y - r - 2.4, f"{v:.0f}" if d is not None else "—", 10, RED if sat else TEXT, family=MONO)
        text(x, y + r + 2.2, gp, 8, MUTED, family=MONO)
    fig.update_layout(shapes=sh, annotations=an)
    fig.update_xaxes(range=[0, 100], visible=False, fixedrange=True)
    fig.update_yaxes(range=[-1, 65], visible=False, fixedrange=True, scaleanchor="x", scaleratio=1)
    theme(fig, 340, legend=False)
    fig.update_layout(margin=dict(l=6, r=6, t=6, b=6))
    return fig


# ---------------------------------------------------------- figura humana
def fig_body(snap):
    d = _rows_to_cols(snap)
    knee = float(d["knee_flex"][-1]) if d is not None and "knee_flex" in d else 0.0
    trunk = float(d["trunk_flex"][-1]) if d is not None and "trunk_flex" in d else 0.0
    kd, td = math.radians(0.45 * (knee + 5)), math.radians(-0.55 * (knee + 5))
    ld = math.radians(trunk + 5)
    ankle = np.array([0.0, 0.06])
    kn = ankle + 0.43 * np.array([math.sin(kd), math.cos(kd)])
    hip = kn + 0.43 * np.array([math.sin(td), math.cos(td)])
    sho = hip + 0.52 * np.array([math.sin(ld), math.cos(ld)])
    head = hip + 0.66 * np.array([math.sin(ld), math.cos(ld)])
    fig = go.Figure()
    fig.add_shape(type="line", x0=-0.55, x1=0.55, y0=0.0, y1=0.0, line=dict(color=LINE, width=2))
    seg = lambda a, b, c, w=7: fig.add_trace(go.Scatter(x=[a[0], b[0]], y=[a[1], b[1]], mode="lines",
                                                         line=dict(color=c, width=w), hoverinfo="skip"))
    seg(np.array([-0.06, 0.03]), np.array([0.17, 0.03]), "#4a5a66", 6)
    seg(ankle, kn, "#6f8291")
    seg(kn, hip, "#6f8291")
    seg(hip, sho, "#6f8291", 9)
    fig.add_shape(type="circle", x0=head[0] - 0.09, x1=head[0] + 0.09, y0=head[1] - 0.09, y1=head[1] + 0.09,
                  line=dict(color="#6f8291", width=3), fillcolor=PANEL)
    for p in (ankle, kn, hip):
        fig.add_shape(type="circle", x0=p[0] - 0.025, x1=p[0] + 0.025, y0=p[1] - 0.025, y1=p[1] + 0.025,
                      line=dict(color=TEXT, width=1), fillcolor=BG)
    for a, b, f in ((ankle, kn, 0.47), (kn, hip, 0.47), (hip, sho, 0.22)):
        m = a + f * (b - a)
        fig.add_shape(type="rect", x0=m[0] - 0.03, x1=m[0] + 0.03, y0=m[1] - 0.03, y1=m[1] + 0.03,
                      line=dict(color=AMBER, width=1), fillcolor=AMBER)
    fig.add_annotation(x=kn[0] + 0.07, y=kn[1], text=f"<b>{knee:5.1f}°</b><br><span style='font-size:10px'>rodilla</span>",
                       showarrow=False, xanchor="left", font=dict(color=AMBER, size=14, family=MONO))
    fig.add_annotation(x=sho[0] + 0.07, y=sho[1] - 0.05, text=f"<b>{trunk:5.1f}°</b><br><span style='font-size:10px'>tronco</span>",
                       showarrow=False, xanchor="left", font=dict(color=TEAL, size=14, family=MONO))
    fig.update_xaxes(range=[-0.62, 0.72], visible=False, fixedrange=True)
    fig.update_yaxes(range=[-0.05, 1.82], visible=False, fixedrange=True, scaleanchor="x", scaleratio=1)
    theme(fig, 340, legend=False)
    fig.update_layout(margin=dict(l=4, r=4, t=8, b=4))
    return fig


# --------------------------------------------------------- series en vivo
def _thin(t, ys, max_points):
    """Reduce puntos para la vista en vivo (conserva picos con min/max por bloque)."""
    n = len(t)
    if n <= max_points:
        return t, ys
    step = int(np.ceil(n / (max_points / 2)))
    idx = []
    for i in range(0, n, step):
        j = min(i + step, n)
        block = ys[0][i:j]
        a, b = i + int(np.argmin(block)), i + int(np.argmax(block))
        idx.extend(sorted({a, b}))
    idx = np.asarray(idx)
    return t[idx], [y[idx] for y in ys]


def fig_live(snap, window=8.0, max_points=300):
    d = _rows_to_cols(snap)
    if d is None:
        return empty("Conecta una fuente para ver las señales en vivo", 520)
    t = (d["t_us"] - d["t_us"][-1]) / 1e6
    fig = make_subplots(rows=3, cols=1, shared_xaxes=True, vertical_spacing=0.07,
                        subplot_titles=("Carga plantar (cuentas ADC)", "Ángulos (°)", "Aceleración |a| (g)"))

    def add(y, name, col, row, width=1.6):
        tt, (yy,) = _thin(t, [np.asarray(y, dtype=float)], max_points)
        fig.add_trace(go.Scatter(x=np.round(tt, 3), y=np.round(yy, 2), name=name,
                                 line=dict(color=col, width=width)), row, 1)

    for ch, col in FSR_COLORS.items():
        if ch in d:
            add(d[ch], FSR_LABEL[ch], col, 1)
    fig.add_hline(y=4000, line=dict(color=RED, width=1, dash="dot"), row=1, col=1)
    if "knee_flex" in d:
        add(d["knee_flex"], "Rodilla", AMBER, 2, 2)
    if "trunk_flex" in d:
        add(d["trunk_flex"], "Tronco", TEAL, 2, 2)
    for (key, name), col in zip(IMU, (BLUE, VIOLET, "#c0cbd2")):
        if f"{key}_ax" in d:
            add(np.sqrt(d[f"{key}_ax"] ** 2 + d[f"{key}_ay"] ** 2 + d[f"{key}_az"] ** 2), f"IMU {name}", col, 3, 1.4)
    fig.update_xaxes(range=[-window, 0], title_text="segundos", row=3, col=1)
    fig.update_yaxes(range=[0, 4200], row=1, col=1)
    return subplot_style(theme(fig, 560))


# ------------------------------------------------------------ experimentos
def fig_experiment(df):
    fig = make_subplots(rows=3, cols=1, shared_xaxes=True, vertical_spacing=0.08,
                        subplot_titles=("Carga total sobre los FSR (N)", "Flexión de rodilla (°)", "Flexión de tronco (°)"))
    t = df["t"] - 8.0
    ft = df[[c for c in df if c.startswith("F_true")]].sum(axis=1)
    fe = df[[c for c in df if c.startswith("F_est")]].sum(axis=1)
    pairs = [(ft, fe, 1), (df["knee_true"], df["knee_meas"], 2), (df["trunk_true"], df["trunk_meas"], 3)]
    for k, (a, b, r) in enumerate(pairs):
        fig.add_trace(go.Scatter(x=t, y=a, name="Real (simulada)", legendgroup="r", showlegend=k == 0,
                                 line=dict(color=TEAL, width=2, dash="dash")), r, 1)
        fig.add_trace(go.Scatter(x=t, y=b, name="Medida por el firmware", legendgroup="m", showlegend=k == 0,
                                 line=dict(color=AMBER, width=2)), r, 1)
    fig.update_xaxes(title_text="segundos desde el contacto", row=3, col=1)
    return subplot_style(theme(fig, 600))


def fig_heatmap(sw, escenario, campo="error"):
    s = sw[sw.escenario == escenario].copy()
    s["error"] = 100 * (s.pico_fuerza_estimada_N / s.pico_fuerza_real_N - 1)
    s["cfg"] = s.rate.astype(str) + " Hz · prom. " + s.ma.astype(str)
    s["fila"] = (s.r.astype(int).map(lambda r: f"{r/1000:g} kΩ")) + " · fr. " + s.transfer.map(lambda x: f"{x:.2f}")
    order_cfg = ["100 Hz · prom. 3", "100 Hz · prom. 1", "200 Hz · prom. 3", "200 Hz · prom. 1"]
    s = s.sort_values(["r", "transfer"], ascending=[False, True])
    filas = list(dict.fromkeys(s.fila))
    z = s.pivot(index="fila", columns="cfg", values=campo).reindex(index=filas, columns=order_cfg)
    if campo == "error":
        zmin, zmax, cs = -100, 0, [[0, RED], [0.7, AMBER], [0.95, TEAL], [1, GREEN]]
        fmt = lambda v: f"{v:.1f}%"
        title = "Error del pico de carga estimado"
    else:
        zmin, zmax, cs = 0, 100, [[0, GREEN], [0.15, AMBER], [1, RED]]
        fmt = lambda v: f"{v:.0f}%"
        title = "Muestras saturadas durante el aterrizaje"
    fig = go.Figure(go.Heatmap(z=z.values, x=order_cfg, y=filas, zmin=zmin, zmax=zmax, colorscale=cs,
                               text=[[fmt(v) for v in row] for row in z.values], texttemplate="%{text}",
                               textfont=dict(family=MONO, size=11), showscale=False,
                               hovertemplate="%{y}<br>%{x}<br>%{text}<extra></extra>"))
    fig.update_layout(title=dict(text=title, font=dict(size=13, color=MUTED), x=0, xanchor="left"))
    fig.update_yaxes(autorange="reversed")
    theme(fig, 360, legend=False)
    fig.update_layout(margin=dict(l=110, r=12, t=40, b=40))
    return fig


# ---------------------------------------------------------------- ensayos
def fig_ensayo(df, landings, r_div=None):
    fig = make_subplots(rows=3, cols=1, shared_xaxes=True, vertical_spacing=0.07,
                        subplot_titles=("Carga plantar " + ("estimada (N, curva nominal)" if r_div else "(cuentas ADC)"),
                                        "Ángulos (°)", "Aceleración |a| (g)"))
    from .analysis import fsr_force_estimate
    for ch, col in FSR_COLORS.items():
        if ch in df:
            y = fsr_force_estimate(df[ch], r_div) if r_div else df[ch]
            fig.add_trace(go.Scatter(x=df["t"], y=y, name=FSR_LABEL[ch], line=dict(color=col, width=1.4)), 1, 1)
    if "knee_flex" in df:
        fig.add_trace(go.Scatter(x=df["t"], y=df["knee_flex"], name="Rodilla", line=dict(color=AMBER, width=2)), 2, 1)
    if "trunk_flex" in df:
        fig.add_trace(go.Scatter(x=df["t"], y=df["trunk_flex"], name="Tronco", line=dict(color=TEAL, width=2)), 2, 1)
    for (key, name), col in zip(IMU, (BLUE, VIOLET, "#c0cbd2")):
        if f"{key}_ax" in df:
            mag = np.sqrt(df[f"{key}_ax"] ** 2 + df[f"{key}_ay"] ** 2 + df[f"{key}_az"] ** 2)
            fig.add_trace(go.Scatter(x=df["t"], y=mag, name=f"IMU {name}", line=dict(color=col, width=1.2)), 3, 1)
    for k, l in enumerate(landings):
        for r in (1, 2, 3):
            fig.add_vline(x=l["t_contacto_s"], line=dict(color=MUTED, width=1, dash="dot"), row=r, col=1)
        fig.add_annotation(x=l["t_contacto_s"], y=1.0, yref="y domain", text=f"#{k+1}", showarrow=False,
                           font=dict(color=MUTED, size=10), xanchor="left", row=1, col=1)
    fig.update_xaxes(title_text="segundos", row=3, col=1)
    return subplot_style(theme(fig, 600))


def fig_compare(items):
    """items: [(nombre, df, landings)] → rodilla alineada al contacto."""
    palette = [AMBER, TEAL, BLUE, VIOLET, GREEN, "#e58fb5", "#c0cbd2"]
    fig = make_subplots(rows=1, cols=2, subplot_titles=("Rodilla alineada al contacto (°)", "Tronco alineado al contacto (°)"))
    n = 0
    for name, df, lands in items:
        for k, l in enumerate(lands):
            w = (df["t"] >= l["t_contacto_s"] - 0.2) & (df["t"] <= l["t_contacto_s"] + 1.0)
            x = df["t"][w] - l["t_contacto_s"]
            col = palette[n % len(palette)]
            dash = ("solid", "dot", "dash", "dashdot")[k % 4]
            lab = f"{name} #{k+1}"
            fig.add_trace(go.Scatter(x=x, y=df["knee_flex"][w], name=lab, legendgroup=lab,
                                     line=dict(color=col, width=1.8, dash=dash)), 1, 1)
            fig.add_trace(go.Scatter(x=x, y=df["trunk_flex"][w], name=lab, legendgroup=lab, showlegend=False,
                                     line=dict(color=col, width=1.8, dash=dash)), 1, 2)
        n += 1
    fig.update_xaxes(title_text="s desde el contacto")
    return subplot_style(theme(fig, 380))
