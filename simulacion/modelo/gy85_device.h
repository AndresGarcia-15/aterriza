/* =====================================================================
 *  gy85_device.h — Emulación a nivel de registros de un módulo GY-85
 *    ADXL345 (0x53) · ITG3200 (0x68) · HMC5883L (0x1E)
 *  Responde a las mismas lecturas/escrituras I2C que los chips reales y
 *  entrega los datos del modelo de aterrizaje (landing_model.h) con:
 *    - cuantización (LSB) y saturación de cada chip según su configuración
 *    - ruido blanco gaussiano
 *    - sesgo fijo del giroscopio y offset de hierro duro del magnetómetro
 *      (para que las calibraciones del firmware tengan algo que corregir)
 *    - promedio de 10 ms, que imita el filtro interno de los chips
 *  Lo usan el chip virtual de Wokwi y el gemelo digital del PC.
 * ===================================================================== */
#ifndef GY85_DEVICE_H
#define GY85_DEVICE_H

#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include "landing_model.h"

#define GY85_ADXL 0x53
#define GY85_ITG 0x68
#define GY85_HMC 0x1E

typedef struct {
  uint8_t adxl[64], itg[128], hmc[16];
  uint8_t active;          /* dirección en la transacción actual */
  uint8_t* regs;           /* banco de registros activo */
  uint8_t mask;            /* tamaño del banco - 1 */
  uint8_t ptr;             /* puntero de registro */
  bool expect_ptr;         /* el primer byte escrito es el puntero */
  int segment, scenario;
  uint32_t rng;
  double gyro_bias[3], mag_offset[3];
  double noise_scale;      /* 1 = ruido nominal */
} gy85_dev;

static inline double gy85_randn(gy85_dev* d) {   /* xorshift32 + Box-Muller */
  double u1, u2;
  do {
    d->rng ^= d->rng << 13; d->rng ^= d->rng >> 17; d->rng ^= d->rng << 5;
    u1 = (d->rng & 0xFFFFFF) / 16777216.0;
  } while (u1 < 1e-9);
  d->rng ^= d->rng << 13; d->rng ^= d->rng >> 17; d->rng ^= d->rng << 5;
  u2 = (d->rng & 0xFFFFFF) / 16777216.0;
  return sqrt(-2 * log(u1)) * cos(2 * LM_PI * u2);
}

static inline void gy85_reset_regs(gy85_dev* d) {
  memset(d->adxl, 0, sizeof(d->adxl));
  memset(d->itg, 0, sizeof(d->itg));
  memset(d->hmc, 0, sizeof(d->hmc));
  d->adxl[0x00] = 0xE5;                  /* DEVID */
  d->adxl[0x2C] = 0x0A;                  /* BW_RATE por defecto */
  d->itg[0x00] = 0x68;                   /* WHO_AM_I */
  d->hmc[0x00] = 0x10; d->hmc[0x01] = 0x20; d->hmc[0x02] = 0x01;
  d->hmc[0x0A] = 'H'; d->hmc[0x0B] = '4'; d->hmc[0x0C] = '3';
}

static inline void gy85_dev_init(gy85_dev* d, int segment, int scenario, uint32_t seed) {
  memset(d, 0, sizeof(*d));
  d->segment = segment;
  d->scenario = scenario;
  d->rng = seed ? seed : 0x9E3779B9u;
  d->noise_scale = 1.0;
  /* Sesgos distintos por segmento (valores típicos de un ITG3200 sin calibrar) */
  const double gb[3][3] = {{1.2, -0.8, 0.5}, {-1.5, 0.9, -0.4}, {0.7, 1.1, -1.3}};
  const double mo[3][3] = {{8, -5, 12}, {-6, 10, -4}, {3, 7, -9}};
  for (int i = 0; i < 3; i++) { d->gyro_bias[i] = gb[segment][i]; d->mag_offset[i] = mo[segment][i]; }
  gy85_reset_regs(d);
}

static inline void gy85_put_le(uint8_t* r, double v) {
  long x = lround(v);
  if (x > 32767) x = 32767;
  if (x < -32768) x = -32768;
  r[0] = (uint8_t)(x & 0xFF); r[1] = (uint8_t)((x >> 8) & 0xFF);
}
static inline void gy85_put_be(uint8_t* r, double v) {
  long x = lround(v);
  if (x > 32767) x = 32767;
  if (x < -32768) x = -32768;
  r[0] = (uint8_t)((x >> 8) & 0xFF); r[1] = (uint8_t)(x & 0xFF);
}

/* Muestra del modelo promediada en los últimos 10 ms (filtro del chip). */
static inline lm_imu gy85_sample(gy85_dev* d, double t) {
  lm_imu acc = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}};
  const int n = 5;
  for (int k = 0; k < n; k++) {
    lm_imu s = lm_get_imu(d->scenario, d->segment, t - k * 0.002);
    acc.acc_g.x += s.acc_g.x / n; acc.acc_g.y += s.acc_g.y / n; acc.acc_g.z += s.acc_g.z / n;
    acc.gyr_dps.x += s.gyr_dps.x / n; acc.gyr_dps.y += s.gyr_dps.y / n; acc.gyr_dps.z += s.gyr_dps.z / n;
    acc.mag_uT = s.mag_uT;
  }
  return acc;
}

/* Rellena los registros de datos del chip direccionado (lectura atómica). */
static inline void gy85_latch(gy85_dev* d, uint8_t addr, double t) {
  lm_imu s = gy85_sample(d, t);
  const double ns = d->noise_scale;
  if (addr == GY85_ADXL) {
    if (!(d->adxl[0x2D] & 0x08)) { memset(&d->adxl[0x32], 0, 6); return; }  /* sin MEASURE */
    uint8_t fmt = d->adxl[0x31];
    int range = 2 << (fmt & 0x03);                       /* ±2/4/8/16 g */
    double lsb = (fmt & 0x08) ? 0.0039 : (2.0 * range) / 1024.0;
    double a[3] = {s.acc_g.x, s.acc_g.y, s.acc_g.z};
    for (int i = 0; i < 3; i++) {
      double v = a[i] + 0.004 * ns * gy85_randn(d);       /* ~4 mg rms */
      if (v > range) v = range;
      if (v < -range) v = -range;
      gy85_put_le(&d->adxl[0x32 + 2 * i], v / lsb);
    }
  } else if (addr == GY85_ITG) {
    double g[3] = {s.gyr_dps.x, s.gyr_dps.y, s.gyr_dps.z};
    gy85_put_be(&d->itg[0x1B], -13200 + (30 - 35) * 280);  /* temperatura ~30 °C */
    for (int i = 0; i < 3; i++) {
      double v = g[i] + d->gyro_bias[i] + 0.08 * ns * gy85_randn(d);
      if (v > 2000) v = 2000;
      if (v < -2000) v = -2000;
      gy85_put_be(&d->itg[0x1D + 2 * i], v * 14.375);
    }
  } else if (addr == GY85_HMC) {
    static const double gains[8] = {1370, 1090, 820, 660, 440, 390, 330, 230};
    double gain = gains[(d->hmc[0x01] >> 5) & 7];
    double m[3] = {s.mag_uT.x, s.mag_uT.y, s.mag_uT.z};
    long raw[3];
    for (int i = 0; i < 3; i++) {
      double v = (m[i] + d->mag_offset[i] + 0.3 * ns * gy85_randn(d)) / 100.0 * gain;
      raw[i] = lround(v);
      if (raw[i] < -2048 || raw[i] > 2047) raw[i] = -4096;  /* desbordamiento */
    }
    gy85_put_be(&d->hmc[0x03], (double)raw[0]);   /* orden X, Z, Y */
    gy85_put_be(&d->hmc[0x05], (double)raw[2]);
    gy85_put_be(&d->hmc[0x07], (double)raw[1]);
  }
}

/* ---- Interfaz I2C (misma forma que los callbacks de Wokwi) ---------- */
static inline bool gy85_dev_connect(gy85_dev* d, uint32_t addr, bool read, double t) {
  if (addr == GY85_ADXL) { d->regs = d->adxl; d->mask = 63; }
  else if (addr == GY85_ITG) { d->regs = d->itg; d->mask = 127; }
  else if (addr == GY85_HMC) { d->regs = d->hmc; d->mask = 15; }
  else return false;                                        /* NACK: no es nuestro */
  d->active = (uint8_t)addr;
  d->expect_ptr = !read;
  if (read) gy85_latch(d, (uint8_t)addr, t);
  return true;
}

static inline bool gy85_dev_write(gy85_dev* d, uint8_t data) {
  if (!d->active) return false;
  if (d->expect_ptr) { d->ptr = data & d->mask; d->expect_ptr = false; return true; }
  if (d->active == GY85_ITG && d->ptr == 0x3E && (data & 0x80)) {  /* H_RESET */
    uint8_t keep_adxl[64], keep_hmc[16];
    memcpy(keep_adxl, d->adxl, 64); memcpy(keep_hmc, d->hmc, 16);
    gy85_reset_regs(d);
    memcpy(d->adxl, keep_adxl, 64); memcpy(d->hmc, keep_hmc, 16);
  } else if (!(d->active == GY85_ADXL && d->ptr == 0x00) &&
             !(d->active == GY85_ITG && d->ptr == 0x00) &&
             !(d->active == GY85_HMC && d->ptr >= 0x0A)) {  /* registros de solo lectura */
    d->regs[d->ptr] = data;
  }
  d->ptr = (d->ptr + 1) & d->mask;
  return true;
}

static inline uint8_t gy85_dev_read(gy85_dev* d) {
  if (!d->active) return 0xFF;
  uint8_t v = d->regs[d->ptr];
  d->ptr = (d->ptr + 1) & d->mask;
  return v;
}

static inline void gy85_dev_disconnect(gy85_dev* d) { d->active = 0; }

#endif
