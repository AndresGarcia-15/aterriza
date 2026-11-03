/* =====================================================================
 *  landing_model.h — Modelo sintético de un aterrizaje de caída (drop landing)
 *  C99 "header-only". Lo usan:
 *    - los chips virtuales de Wokwi (compilados a WebAssembly)
 *    - el gemelo digital en el PC (verdad simulada)
 *  Una sola fuente de verdad: si se cambia aquí, cambia en todas partes.
 *
 *  Ciclo de 10 s que se repite:
 *    de pie (sobre el cajón) → caída libre → contacto → absorción → de pie
 *  El primer aterrizaje ocurre en t = 8 s (deja tiempo al arranque, la
 *  calibración del giroscopio y la tara); luego cada 10 s.
 *
 *  Marco mundial: X anterior, Y izquierda, Z arriba. Unidades SI.
 *  Las IMU van en la pierna DERECHA (muslo y pierna) y en la región lumbar.
 *
 *  Modelo cinemático simplificado: plausible en forma y magnitud según la
 *  literatura de drop landing (no es una simulación musculoesquelética).
 * ===================================================================== */
#ifndef LANDING_MODEL_H
#define LANDING_MODEL_H

#include <math.h>
#include <stdint.h>

#ifndef LM_PI
#define LM_PI 3.14159265358979323846
#endif

#define LM_G 9.81
#define LM_MASS_KG 70.0
#define LM_DROP_M 0.40
#define LM_CYCLE_S 10.0
#define LM_FIRST_STEP_S 7.7136  /* contacto en 8,000 s */
#define LM_KNEE_STAND 5.0       /* flexión de rodilla de pie (°) */
#define LM_TRUNK_STAND 5.0      /* flexión de tronco de pie (°) */
#define LM_SHANK_LEN 0.43
#define LM_THIGH_LEN 0.43
#define LM_SENSOR_R 0.20        /* sensor a 20 cm del pivote de cada segmento */
#define LM_LUMBAR_R 0.15

enum { LM_THIGH = 0, LM_SHANK = 1, LM_LUMBAR = 2 };
enum { LM_P1_H = 0, LM_P1_F = 1, LM_P2_H = 2, LM_P2_F = 3 };

typedef struct { double x, y, z; } lm_vec3;

typedef struct {
  const char* name;
  double knee_contact, knee_peak, t_peak, t_recover;   /* °, °, s, s (desde contacto) */
  double trunk_peak, trunk_lateral_peak;               /* ° */
  double valgus_peak;                                  /* ° inclinación frontal de la pierna */
  double left_share;                                   /* fracción de la carga en el pie izq. */
  double ff_amp, ff_t, ff_sigma;                       /* pulso antepié (×peso corporal) */
  double heel_amp, heel_t, heel_sigma;                 /* pulso talón */
  double abs_t, abs_sigma;                             /* pulso de absorción (amplitud calculada) */
  double shock_g[3];                                   /* transitorio de impacto (muslo, pierna, lumbar) */
} lm_scenario;

static const lm_scenario LM_SCENARIOS[3] = {
  /* 0: aterrizaje controlado (técnica adecuada) */
  {"controlado", 20, 85, 0.20, 1.20, 35, 0, 0, 0.50,
   1.2, 0.015, 0.006, 2.4, 0.045, 0.012, 0.11, 0.060, {1.5, 4.0, 0.8}},
  /* 1: aterrizaje rígido (poca flexión, picos altos) */
  {"rigido", 10, 45, 0.12, 0.80, 12, 0, 0, 0.50,
   1.0, 0.012, 0.005, 4.5, 0.032, 0.008, 0.07, 0.035, {2.5, 7.0, 1.5}},
  /* 2: asimétrico con valgo dinámico en la pierna derecha */
  {"asimetrico_valgo", 18, 70, 0.18, 1.10, 30, 10, 12, 0.65,
   1.2, 0.015, 0.006, 2.8, 0.045, 0.012, 0.10, 0.055, {1.5, 4.5, 1.0}},
};

static inline double lm_gauss(double u, double mu, double s) {
  double z = (u - mu) / s;
  return exp(-0.5 * z * z);
}

static inline double lm_smooth(double x) {      /* 0→1 con derivada nula en extremos */
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return 0.5 * (1 - cos(LM_PI * x));
}

/* Fase dentro del ciclo. Devuelve: 0 de pie, 1 vuelo, 2 contacto.
 * *u = tiempo desde el inicio de esa fase (s). */
static inline int lm_phase(double t, double* u) {
  const double flight = sqrt(2 * LM_DROP_M / LM_G);
  double tau = t - LM_FIRST_STEP_S;
  if (tau < 0) { *u = t; return 0; }
  tau = fmod(tau, LM_CYCLE_S);
  if (tau < flight) { *u = tau; return 1; }
  *u = tau - flight;
  if (*u < 3.0) return 2;          /* tras 3 s ya está de pie de nuevo */
  return 0;
}

/* Curva 0→1→0: sube hasta t_peak, vuelve a 0 en t_recover. */
static inline double lm_bump(double u, double tp, double tr) {
  if (u <= 0) return 0;
  if (u < tp) return 0.5 * (1 - cos(LM_PI * u / tp));
  if (u < tr) return 0.5 * (1 + cos(LM_PI * (u - tp) / (tr - tp)));
  return 0;
}

/* ---------------------------- Cinemática ---------------------------- */
typedef struct {
  double knee;          /* flexión de rodilla (°) */
  double trunk;         /* flexión de tronco, plano sagital (°) */
  double trunk_lat;     /* inclinación lateral del tronco (°) */
  double valgus;        /* inclinación frontal de la pierna (°) */
} lm_angles;

static inline lm_angles lm_get_angles(int scen, double t) {
  const lm_scenario* s = &LM_SCENARIOS[scen];
  const double flight = sqrt(2 * LM_DROP_M / LM_G);
  lm_angles a = {LM_KNEE_STAND, LM_TRUNK_STAND, 0, 0};
  double u;
  int ph = lm_phase(t, &u);
  if (ph == 1) {
    double k = lm_smooth(u / flight);
    a.knee = LM_KNEE_STAND + (s->knee_contact - LM_KNEE_STAND) * k;
    a.trunk = LM_TRUNK_STAND + 5 * k;
  } else if (ph == 2) {
    if (u < s->t_peak) {
      a.knee = s->knee_contact + (s->knee_peak - s->knee_contact) * lm_smooth(u / s->t_peak);
    } else if (u < s->t_recover) {
      a.knee = LM_KNEE_STAND + (s->knee_peak - LM_KNEE_STAND) *
               0.5 * (1 + cos(LM_PI * (u - s->t_peak) / (s->t_recover - s->t_peak)));
    }
    double b = lm_bump(u, 1.2 * s->t_peak, s->t_recover + 0.1);
    /* el tronco parte de +5° (final del vuelo), llega al pico y vuelve */
    a.trunk = LM_TRUNK_STAND + 5 * (1 - lm_smooth(u / (1.2 * s->t_peak))) +
              (s->trunk_peak - LM_TRUNK_STAND) * b;
    a.trunk_lat = s->trunk_lateral_peak * b;
    a.valgus = s->valgus_peak * lm_bump(u, s->t_peak, s->t_recover);
  }
  return a;
}

/* Inclinación sagital de cada segmento: positivo = extremo superior hacia adelante.
 * Rodilla = pierna − muslo. El muslo se inclina más que la pierna. */
static inline void lm_segment_tilts(const lm_angles* a, double* thigh, double* shank, double* lumbar) {
  *shank = 0.45 * a->knee * LM_PI / 180;
  *thigh = -0.55 * a->knee * LM_PI / 180;
  *lumbar = a->trunk * LM_PI / 180;
}

/* Ejes del sensor (columnas de R: sensor → mundo) para un segmento.
 * Convención de montaje del firmware: X a lo largo del segmento (arriba),
 * Z saliendo de la piel (muslo/pierna: anterior; lumbar: posterior). */
static inline void lm_sensor_axes(int seg, double tilt, double frontal, lm_vec3 ax[3]) {
  double sp = sin(tilt), cp = cos(tilt);
  lm_vec3 x = {sp, 0, cp};
  lm_vec3 z = (seg == LM_LUMBAR) ? (lm_vec3){-cp, 0, sp} : (lm_vec3){cp, 0, -sp};
  /* y = z × x */
  lm_vec3 y = {z.y * x.z - z.z * x.y, z.z * x.x - z.x * x.z, z.x * x.y - z.y * x.x};
  lm_vec3 v[3] = {x, y, z};
  double sf = sin(frontal), cf = cos(frontal);
  for (int i = 0; i < 3; i++) {          /* rotación frontal (alrededor de X mundial) */
    ax[i].x = v[i].x;
    ax[i].y = v[i].y * cf - v[i].z * sf;
    ax[i].z = v[i].y * sf + v[i].z * cf;
  }
}

static inline void lm_axes_at(int scen, int seg, double t, lm_vec3 ax[3]) {
  lm_angles a = lm_get_angles(scen, t);
  double th, sh, lu;
  lm_segment_tilts(&a, &th, &sh, &lu);
  double tilt = seg == LM_THIGH ? th : seg == LM_SHANK ? sh : lu;
  double frontal = seg == LM_SHANK ? a.valgus * LM_PI / 180
                 : seg == LM_LUMBAR ? a.trunk_lat * LM_PI / 180 : 0;
  lm_sensor_axes(seg, tilt, frontal, ax);
}

/* Posición del sensor relativa al tobillo (solo rotaciones de la cadena). */
static inline lm_vec3 lm_chain_pos(int scen, int seg, double t) {
  lm_vec3 s[3], th[3], lu[3];
  lm_axes_at(scen, LM_SHANK, t, s);
  if (seg == LM_SHANK) return (lm_vec3){LM_SENSOR_R * s[0].x, LM_SENSOR_R * s[0].y, LM_SENSOR_R * s[0].z};
  lm_axes_at(scen, LM_THIGH, t, th);
  lm_vec3 knee = {LM_SHANK_LEN * s[0].x, LM_SHANK_LEN * s[0].y, LM_SHANK_LEN * s[0].z};
  if (seg == LM_THIGH)
    return (lm_vec3){knee.x + LM_SENSOR_R * th[0].x, knee.y + LM_SENSOR_R * th[0].y, knee.z + LM_SENSOR_R * th[0].z};
  lm_axes_at(scen, LM_LUMBAR, t, lu);
  return (lm_vec3){knee.x + LM_THIGH_LEN * th[0].x + LM_LUMBAR_R * lu[0].x,
                   knee.y + LM_THIGH_LEN * th[0].y + LM_LUMBAR_R * lu[0].y,
                   knee.z + LM_THIGH_LEN * th[0].z + LM_LUMBAR_R * lu[0].z};
}

/* ------------------------------ Fuerzas ------------------------------ */
/* Fuerza vertical por región, en múltiplos del peso corporal (BW). */
typedef struct { double region[4]; double total; } lm_forces;

static inline double lm_abs_amp(const lm_scenario* s) {
  /* El impulso del aterrizaje debe frenar la velocidad de caída:
   * ∫(F − 1 BW) dt = v/g. La rampa inicial de 40 ms deja un déficit de 0,02. */
  const double k = sqrt(2 * LM_PI);
  double needed = sqrt(2 * LM_G * LM_DROP_M) / LM_G + 0.02;
  double area = needed - s->ff_amp * s->ff_sigma * k - s->heel_amp * s->heel_sigma * k;
  return area / (s->abs_sigma * k);
}

static inline lm_forces lm_get_forces(int scen, double t) {
  const lm_scenario* s = &LM_SCENARIOS[scen];
  lm_forces f = {{0, 0, 0, 0}, 0};
  double u, heel, fore, share = 0.5;
  int ph = lm_phase(t, &u);
  if (ph == 1) return f;                       /* en el aire */
  if (ph == 0) {                               /* de pie: 60 % talón / 40 % antepié */
    heel = 0.6; fore = 0.4;
  } else {
    double base = u < 0.04 ? lm_smooth(u / 0.04) : 1.0;
    double ab = lm_abs_amp(s) * lm_gauss(u, s->abs_t, s->abs_sigma);
    heel = 0.6 * base + s->heel_amp * lm_gauss(u, s->heel_t, s->heel_sigma) + 0.5 * ab;
    fore = 0.4 * base + s->ff_amp * lm_gauss(u, s->ff_t, s->ff_sigma) + 0.5 * ab;
    /* la asimetría se instala durante el aterrizaje y desaparece al recuperarse */
    share = 0.5 + (s->left_share - 0.5) * lm_bump(u, 0.05, 1.2);
  }
  f.region[LM_P1_H] = heel * share;
  f.region[LM_P1_F] = fore * share;
  f.region[LM_P2_H] = heel * (1 - share);
  f.region[LM_P2_F] = fore * (1 - share);
  f.total = heel + fore;
  return f;
}

/* -------------------------- Señales de la IMU ------------------------ */
typedef struct {
  lm_vec3 acc_g;        /* fuerza específica en ejes del sensor (g) */
  lm_vec3 gyr_dps;      /* velocidad angular en ejes del sensor (°/s) */
  lm_vec3 mag_uT;       /* campo magnético en ejes del sensor (µT) */
} lm_imu;

static inline lm_vec3 lm_rt(const lm_vec3 ax[3], lm_vec3 w) {   /* Rᵀ·w */
  return (lm_vec3){ax[0].x * w.x + ax[0].y * w.y + ax[0].z * w.z,
                   ax[1].x * w.x + ax[1].y * w.y + ax[1].z * w.z,
                   ax[2].x * w.x + ax[2].y * w.y + ax[2].z * w.z};
}

static inline lm_imu lm_get_imu(int scen, int seg, double t) {
  const lm_scenario* s = &LM_SCENARIOS[scen];
  const double h = 1e-3;
  lm_imu out;
  lm_vec3 R[3], Rp[3], Rm[3];
  lm_axes_at(scen, seg, t, R);
  lm_axes_at(scen, seg, t + h, Rp);
  lm_axes_at(scen, seg, t - h, Rm);

  /* Velocidad angular: Ω = Rᵀ·Ṙ (matriz antisimétrica). */
  double Rd[3][3], Rm_[3][3], W[3][3];
  for (int c = 0; c < 3; c++) {
    const double* p = &Rp[c].x; const double* m = &Rm[c].x; const double* r = &R[c].x;
    for (int i = 0; i < 3; i++) { Rd[i][c] = (p[i] - m[i]) / (2 * h); Rm_[i][c] = r[i]; }
  }
  for (int i = 0; i < 3; i++)
    for (int j = 0; j < 3; j++) {
      W[i][j] = 0;
      for (int k = 0; k < 3; k++) W[i][j] += Rm_[k][i] * Rd[k][j];
    }
  const double r2d = 180 / LM_PI;
  out.gyr_dps = (lm_vec3){W[2][1] * r2d, W[0][2] * r2d, W[1][0] * r2d};

  /* Aceleración lineal (mundo): rotaciones de la cadena + traslación vertical. */
  lm_vec3 p0 = lm_chain_pos(scen, seg, t), pp = lm_chain_pos(scen, seg, t + h),
          pm = lm_chain_pos(scen, seg, t - h);
  lm_vec3 a = {(pp.x - 2 * p0.x + pm.x) / (h * h), (pp.y - 2 * p0.y + pm.y) / (h * h),
               (pp.z - 2 * p0.z + pm.z) / (h * h)};
  double u;
  int ph = lm_phase(t, &u);
  if (ph == 1) {
    a.z += -LM_G;                                          /* caída libre */
  } else if (ph == 2) {
    lm_forces f = lm_get_forces(scen, t);
    a.z += LM_G * (f.total - 1.0);                          /* frenado del cuerpo */
    a.z += s->shock_g[seg] * LM_G * exp(-u / 0.025) * sin(2 * LM_PI * 30 * u);  /* vibración */
  }
  lm_vec3 sf = {a.x, a.y, a.z + LM_G};                      /* fuerza específica */
  lm_vec3 acc = lm_rt(R, sf);
  out.acc_g = (lm_vec3){acc.x / LM_G, acc.y / LM_G, acc.z / LM_G};

  /* Campo magnético terrestre aproximado (Caribe colombiano). */
  lm_vec3 B = {28.0, 0.0, 15.0};
  out.mag_uT = lm_rt(R, B);
  return out;
}

/* ------------------------- Sensor de fuerza FSR ---------------------- */
/* Curva aproximada del FSR 402 (datasheet Interlink): ~10 kΩ a 1 N,
 * ~1 kΩ a 10 N y saturación suave por encima. Por debajo de 0,15 N
 * prácticamente es un circuito abierto. FUERA DE 100 N el sensor no
 * está especificado: el modelo extrapola. */
static inline double lm_fsr_resistance(double force_n) {
  if (force_n < 0.15) return 1e7;
  double r;
  if (force_n < 10.0) r = 10000.0 / force_n;
  else r = 1000.0 * pow(force_n / 10.0, -0.6);
  return r < 150.0 ? 150.0 : r;
}

/* Voltaje en el nodo del ADC: 3,3 V — FSR — nodo — R — GND */
static inline double lm_fsr_voltage(double force_n, double r_divider) {
  double rf = lm_fsr_resistance(force_n);
  return 3.3 * r_divider / (r_divider + rf);
}

/* Fuerza que llega al FSR: el disco de 18 mm solo recibe una fracción de
 * la carga de su región (por defecto 10 %; parámetro clave a medir). */
static inline double lm_fsr_force(int scen, int ch, double t, double transfer) {
  lm_forces f = lm_get_forces(scen, t);
  return f.region[ch] * LM_MASS_KG * LM_G * transfer;
}

#endif
