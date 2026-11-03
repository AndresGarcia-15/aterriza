// =====================================================================
//  Gemelo digital — ejecuta en el PC los módulos REALES del firmware
//  (ImuSensor.cpp, Orientation.cpp, FsrArray.cpp) contra los sensores
//  virtuales (gy85_device.h + landing_model.h) y compara lo medido con
//  la verdad simulada. Reproduce la lógica de muestreo de App.cpp:
//  calibración de giroscopio al arrancar, tara de pie, fusión y ángulos.
//
//  Uso: sim_host <escenario 0-2> <R_divisor_ohm> <fraccion_carga> <salida.csv>
//               [firmware.csv [duracion_s]]
//  Imprime una línea JSON con las métricas del ensayo. Si se da firmware.csv,
//  escribe además las líneas EXACTAMENTE en el formato CSV que transmite el
//  ESP32 (lo usa el simulador integrado del laboratorio Dash).
// =====================================================================
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include "landing_model.h"
#include "gy85_device.h"
#include "config.h"
#include "I2CBus.h"
#include "ImuSensor.h"
#include "FsrArray.h"
#include "Orientation.h"

double g_sim_t = 0;
static double g_fsr_v[4];
static uint32_t g_adc_rng = 12345;

// ADC del ESP32 a 11 dB: ~0-3,1 V → 0-4095, satura arriba; ruido ~2 LSB.
uint16_t analogRead(uint8_t pin) {
  int ch = pin == PIN_FSR[0] ? 0 : pin == PIN_FSR[1] ? 1 : pin == PIN_FSR[2] ? 2 : 3;
  g_adc_rng ^= g_adc_rng << 13; g_adc_rng ^= g_adc_rng >> 17; g_adc_rng ^= g_adc_rng << 5;
  double noise = ((g_adc_rng & 0xFFFF) / 65535.0 - 0.5) * 4.0;
  double raw = g_fsr_v[ch] / 3.1 * 4095.0 + noise;
  if (raw < 0) raw = 0;
  if (raw > 4095) raw = 4095;
  return (uint16_t)lround(raw);
}

class SimI2CBus : public I2CBus {
 public:
  gy85_dev dev;
  SimI2CBus(int seg, int scen) { gy85_dev_init(&dev, seg, scen, 0x1234567u + seg * 7919u); }
  bool begin() override { return true; }
  bool probe(uint8_t a) override {
    bool ok = gy85_dev_connect(&dev, a, false, g_sim_t);
    gy85_dev_disconnect(&dev);
    return ok;
  }
  bool writeReg(uint8_t a, uint8_t reg, uint8_t v) override {
    if (!gy85_dev_connect(&dev, a, false, g_sim_t)) return false;
    gy85_dev_write(&dev, reg); gy85_dev_write(&dev, v); gy85_dev_disconnect(&dev);
    return true;
  }
  bool readRegs(uint8_t a, uint8_t reg, uint8_t* buf, uint8_t n) override {
    if (!gy85_dev_connect(&dev, a, false, g_sim_t)) return false;
    gy85_dev_write(&dev, reg); gy85_dev_disconnect(&dev);
    gy85_dev_connect(&dev, a, true, g_sim_t);
    for (uint8_t i = 0; i < n; i++) buf[i] = gy85_dev_read(&dev);
    gy85_dev_disconnect(&dev);
    return true;
  }
  void recover() override {}
  const char* name() const override { return "sim"; }
};

// Calibración "ideal" inversa del FSR (mejor caso: curva perfecta conocida).
static double force_from_raw(double raw, double rdiv) {
  double v = raw / 4095.0 * 3.1;
  if (v < 0.005) return 0;
  double r = rdiv * (3.3 / v - 1.0);
  if (r >= 1000.0) return 10000.0 / r;
  if (r <= 150.0) r = 150.0;
  return 10.0 * pow(r / 1000.0, -1.0 / 0.6);
}

int main(int argc, char** argv) {
  if (argc < 5) { fprintf(stderr, "uso: %s escenario R fraccion salida.csv\n", argv[0]); return 1; }
  const int scen = atoi(argv[1]);
  const double rdiv = atof(argv[2]), transfer = atof(argv[3]);
  FILE* out = fopen(argv[4], "w");
  FILE* fw = argc >= 6 ? fopen(argv[5], "w") : nullptr;
  const double fw_dur = argc >= 7 ? atof(argv[6]) : 30.0;
  if (fw) {
    fprintf(fw, "seq,t_us,P1_H,P1_F,P2_H,P2_F");
    for (const char* n : {"T", "P", "L"})
      fprintf(fw, ",%s_ax,%s_ay,%s_az,%s_gx,%s_gy,%s_gz,%s_mx,%s_my,%s_mz", n, n, n, n, n, n, n, n, n);
    fprintf(fw, ",knee_flex,trunk_flex,flags\n");
  }
  const double dt = 1.0 / SAMPLE_RATE_HZ;

  SimI2CBus buses[3] = {SimI2CBus(0, scen), SimI2CBus(1, scen), SimI2CBus(2, scen)};
  ImuSensor imus[3] = {ImuSensor(buses[0]), ImuSensor(buses[1]), ImuSensor(buses[2])};
  MahonyFilter filt[3];
  FsrArray fsr;
  fsr.begin();
  for (int i = 0; i < 3; i++) {
    if (!imus[i].begin(SAMPLE_RATE_HZ)) { fprintf(stderr, "IMU %d no detectada\n", i); return 2; }
    filt[i].kp = MAHONY_KP; filt[i].ki = MAHONY_KI; filt[i].gateG = ACCEL_GATE_G;
  }

  double bias[3][3] = {}, biasSum[3][3] = {}, upSum[3][3] = {}, tare[3] = {};
  int biasN = 0, tareN = 0;
  bool ready[3] = {};
  // Métricas
  double sse_k = 0, sse_t = 0, pk_true_k = 0, pk_meas_k = 0, pk_true_t = 0, pk_meas_t = 0;
  int n_land = 0, sat_samples = 0, gyro_only = 0;
  double pk_true_F = 0, pk_est_F = 0, pk_true_Fcont = 0;

  fprintf(out, "t,knee_true,knee_meas,trunk_true,trunk_meas,valgus_true,"
               "F_true_P1H,F_true_P1F,F_true_P2H,F_true_P2F,F_est_P1H,F_est_P1F,F_est_P2H,F_est_P2F,"
               "raw_P1H,raw_P1F,raw_P2H,raw_P2F,sat\n");

  const int N = (int)(fmax(11.0, fw ? fw_dur : 0.0) * SAMPLE_RATE_HZ);
  Vec3 lastA[3], lastG[3], lastM[3] = {};
  for (int k = 0; k < N; k++) {
    const double t = k * dt;
    g_sim_t = t;
    double Ftrue[4];
    for (int ch = 0; ch < 4; ch++) {
      Ftrue[ch] = lm_fsr_force(scen, ch, t, transfer);
      g_fsr_v[ch] = lm_fsr_voltage(Ftrue[ch], rdiv);
    }
    uint16_t raw[4];
    uint8_t sat = fsr.sample(raw);

    double seg[3];
    bool accelUsedAll = true;
    for (int i = 0; i < 3; i++) {
      Vec3 a, g;
      imus[i].read(a, g);
      if (k % MAG_READ_DIVIDER == 0) imus[i].readMag(lastM[i]);
      if (t >= 0.3 && t < 2.3) { biasSum[i][0] += g.x; biasSum[i][1] += g.y; biasSum[i][2] += g.z; }
      g = {(float)(g.x - bias[i][0]), (float)(g.y - bias[i][1]), (float)(g.z - bias[i][2])};
      if (!ready[i]) { filt[i].initFromAccel(a.x, a.y, a.z); ready[i] = true; }
      else accelUsedAll &= filt[i].update(g.x * 0.01745329f, g.y * 0.01745329f, g.z * 0.01745329f, a.x, a.y, a.z, dt);
      lastA[i] = a; lastG[i] = g;
      float vx, vy, vz;
      filt[i].upVector(vx, vy, vz);
      if (t >= 5.0 && t < 6.0) { upSum[i][0] += vx; upSum[i][1] += vy; upSum[i][2] += vz; }
      seg[i] = wrap180(sagittalAngleDeg(vx, vy, vz) - tare[i]);
    }
    if (t >= 0.3 && t < 2.3) biasN++;
    if (t + dt >= 2.3 && t < 2.3) for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) bias[i][j] = biasSum[i][j] / biasN;
    if (t >= 5.0 && t < 6.0) tareN++;
    if (t + dt >= 6.0 && t < 6.0) for (int i = 0; i < 3; i++) tare[i] = sagittalAngleDeg(upSum[i][0], upSum[i][1], upSum[i][2]);

    const double knee = KNEE_SIGN * wrap180(seg[1] - seg[0]);
    const double trunk = TRUNK_SIGN * seg[2];
    lm_angles A = lm_get_angles(scen, t);
    const double kt = A.knee - LM_KNEE_STAND, tt = A.trunk - LM_TRUNK_STAND;

    if (fw) {
      unsigned flags = sat | (accelUsedAll ? 0 : (1u << 7));
      if ((t >= 0.3 && t < 2.3) || (t >= 5.0 && t < 6.0)) flags |= 1u << 9;
      if (t < 6.0) flags |= 1u << 10;
      fprintf(fw, "%d,%llu,%u,%u,%u,%u", k, (unsigned long long)llround(t * 1e6), raw[0], raw[1], raw[2], raw[3]);
      for (int i = 0; i < 3; i++)
        fprintf(fw, ",%.3f,%.3f,%.3f,%.2f,%.2f,%.2f,%.1f,%.1f,%.1f", lastA[i].x, lastA[i].y, lastA[i].z,
                lastG[i].x, lastG[i].y, lastG[i].z, lastM[i].x, lastM[i].y, lastM[i].z);
      fprintf(fw, ",%.2f,%.2f,%u\n", knee, trunk, flags);
    }
    if (t > 11.0) continue;   // las métricas solo usan el primer aterrizaje
    double Fest[4], Ftot = 0, Fest_tot = 0;
    for (int ch = 0; ch < 4; ch++) { Fest[ch] = force_from_raw(raw[ch], rdiv); Ftot += Ftrue[ch]; Fest_tot += Fest[ch]; }

    if (t >= 7.9 && t <= 9.6) {           // ventana del aterrizaje
      n_land++;
      sse_k += (knee - kt) * (knee - kt);
      sse_t += (trunk - tt) * (trunk - tt);
      pk_true_k = fmax(pk_true_k, kt); pk_meas_k = fmax(pk_meas_k, knee);
      pk_true_t = fmax(pk_true_t, tt); pk_meas_t = fmax(pk_meas_t, trunk);
      if (sat) sat_samples++;
      if (!accelUsedAll) gyro_only++;
      pk_true_F = fmax(pk_true_F, Ftot); pk_est_F = fmax(pk_est_F, Fest_tot);
      fprintf(out, "%.3f,%.2f,%.2f,%.2f,%.2f,%.2f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%u,%u,%u,%u,%u\n",
              t, kt, knee, tt, trunk, A.valgus, Ftrue[0], Ftrue[1], Ftrue[2], Ftrue[3],
              Fest[0], Fest[1], Fest[2], Fest[3], raw[0], raw[1], raw[2], raw[3], sat);
    }
  }
  // Pico real en tiempo continuo (1 kHz) para medir la pérdida por muestreo
  for (double t = 7.9; t <= 9.6; t += 1e-4) {
    double s = 0;
    for (int ch = 0; ch < 4; ch++) s += lm_fsr_force(scen, ch, t, transfer);
    pk_true_Fcont = fmax(pk_true_Fcont, s);
  }
  fclose(out);
  if (fw) fclose(fw);
  printf("{\"escenario\":%d,\"rate\":%u,\"ma\":%u,\"r\":%.0f,\"transfer\":%.2f,"
         "\"rmse_rodilla\":%.2f,\"pico_rodilla_real\":%.1f,\"pico_rodilla_medido\":%.1f,"
         "\"rmse_tronco\":%.2f,\"pico_tronco_real\":%.1f,\"pico_tronco_medido\":%.1f,"
         "\"pct_saturado\":%.1f,\"pct_solo_giro\":%.1f,"
         "\"pico_fuerza_real_N\":%.1f,\"pico_fuerza_muestreada_N\":%.1f,\"pico_fuerza_estimada_N\":%.1f}\n",
         scen, (unsigned)SAMPLE_RATE_HZ, (unsigned)FSR_MOVING_AVG, rdiv, transfer,
         sqrt(sse_k / n_land), pk_true_k, pk_meas_k, sqrt(sse_t / n_land), pk_true_t, pk_meas_t,
         100.0 * sat_samples / n_land, 100.0 * gyro_only / n_land, pk_true_Fcont, pk_true_F, pk_est_F);
  return 0;
}
