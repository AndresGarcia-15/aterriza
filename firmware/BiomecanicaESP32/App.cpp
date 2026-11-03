// Lógica principal del firmware (ver BiomecanicaESP32.ino para la descripción).
#include <Arduino.h>
#include <Wire.h>
#include <esp_timer.h>
#include <stdarg.h>

#include "config.h"
#include "I2CBus.h"
#include "SoftI2C.h"
#include "ImuSensor.h"
#include "FsrArray.h"
#include "Orientation.h"
#include "Calibration.h"
#include "App.h"

// ------------------------------- Hardware ----------------------------
static HardwareI2CBus busThigh(Wire, IMU_PINS[IMU_THIGH].sda, IMU_PINS[IMU_THIGH].scl,
                               I2C_HW_FREQ, I2C_TIMEOUT_MS, "Wire  SDA21/SCL22");
static HardwareI2CBus busShank(Wire1, IMU_PINS[IMU_SHANK].sda, IMU_PINS[IMU_SHANK].scl,
                               I2C_HW_FREQ, I2C_TIMEOUT_MS, "Wire1 SDA18/SCL19");
static SoftI2CBus busLumbar(IMU_PINS[IMU_LUMBAR].sda, IMU_PINS[IMU_LUMBAR].scl,
                            SOFT_I2C_HALF_PERIOD_US, "Soft  SDA16/SCL17");
static ImuSensor imus[NUM_IMU] = {ImuSensor(busThigh), ImuSensor(busShank), ImuSensor(busLumbar)};
static FsrArray fsr;
static MahonyFilter filters[NUM_IMU];

// -------------------------------- Datos ------------------------------
enum SampleFlags : uint16_t {
  FLAG_FSR_SAT0 = 1 << 0,   // bits 0-3: FSR saturado (P1_H, P1_F, P2_H, P2_F)
  FLAG_IMU_ERR0 = 1 << 4,   // bits 4-6: error de lectura IMU (T, P, L)
  FLAG_GYRO_ONLY = 1 << 7,  // alguna IMU integró solo giroscopio (impacto)
  FLAG_OVERRUN = 1 << 8,    // se perdió al menos un periodo de muestreo
  FLAG_CALIBRATING = 1 << 9,
  FLAG_NOT_TARED = 1 << 10,
};

struct Sample {
  uint32_t seq;
  uint64_t t_us;
  uint16_t fsr[NUM_FSR];
  Vec3 acc[NUM_IMU];   // g
  Vec3 gyr[NUM_IMU];   // °/s
  Vec3 mag[NUM_IMU];   // µT
  float knee;          // flexión de rodilla (°), relativa a la tara
  float trunk;         // flexión de tronco (°), relativa a la tara
  uint16_t flags;
};

struct Msg {
  char text[256];
};

// --------------------------- Estado compartido -----------------------
static QueueHandle_t gDataQ, gMsgQ, gCmdQ;
static TaskHandle_t gSamplerTask = nullptr;
static esp_timer_handle_t gTimer = nullptr;

static CalibrationData gCal;
static portMUX_TYPE gCalMux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool gCalDirty = false;

static volatile bool gStreaming = STREAM_AT_BOOT;
static volatile bool gPlotMode = false;
static volatile bool gTared = false;
static float gTareAngle[NUM_IMU] = {0, 0, 0};

// Cada contador tiene un solo escritor y las escrituras de 32 bits son
// atómicas en el ESP32; los lectores (comando 'i') solo informan.
static struct {
  uint32_t samples = 0, overruns = 0, queueDrops = 0, msgDrops = 0;
  uint32_t lastSampleUs = 0, maxSampleUs = 0;
  // Tiempo por etapa (us): FSR, IMU muslo, IMU pierna, IMU lumbar, resto
  uint32_t stageLastUs[5] = {0, 0, 0, 0, 0}, stageMaxUs[5] = {0, 0, 0, 0, 0};
} gStats;
static const char* const STAGE_NAMES[5] = {"FSR", "IMU-T", "IMU-P", "IMU-L", "resto"};

// ------------------------------ Utilidades ---------------------------
static void postMsg(const char* fmt, ...) {
  Msg m;
  va_list args;
  va_start(args, fmt);
  vsnprintf(m.text, sizeof(m.text), fmt, args);
  va_end(args);
  if (xQueueSend(gMsgQ, &m, 0) != pdTRUE) gStats.msgDrops++;
}

static void postHeader() {
  char h[256];
  int n = snprintf(h, sizeof(h), "#COLS,seq,t_us,P1_H,P1_F,P2_H,P2_F");
  for (uint8_t i = 0; i < NUM_IMU; i++) {
    const char* s = IMU_NAMES[i];
    n += snprintf(h + n, sizeof(h) - n, ",%s_ax,%s_ay,%s_az,%s_gx,%s_gy,%s_gz,%s_mx,%s_my,%s_mz",
                  s, s, s, s, s, s, s, s, s);
  }
  snprintf(h + n, sizeof(h) - n, ",knee_flex,trunk_flex,flags");
  postMsg("%s", h);
}

static inline void calSet(void (*fn)(CalibrationData&)) {
  portENTER_CRITICAL(&gCalMux);
  fn(gCal);
  portEXIT_CRITICAL(&gCalMux);
  gCalDirty = true;
}

// ================== Calibraciones (se ejecutan en la tarea de muestreo)
enum class CalMode : uint8_t { NONE, GYRO, ACCEL, TARE, MAG };

static struct {
  CalMode mode = CalMode::NONE;
  uint32_t count = 0, target = 0;
  double sum[NUM_IMU][3];
  double sumSq[NUM_IMU][3];
  float minv[NUM_IMU][3], maxv[NUM_IMU][3];
  uint32_t n[NUM_IMU];
  float maxGyroDps;
} cs;

static const char* calName(CalMode m) {
  switch (m) {
    case CalMode::GYRO: return "giroscopio";
    case CalMode::ACCEL: return "acelerometro";
    case CalMode::TARE: return "tara";
    case CalMode::MAG: return "magnetometro";
    default: return "-";
  }
}

static void calStart(CalMode mode) {
  if (cs.mode != CalMode::NONE) {
    postMsg("#ERROR ya hay una calibracion en curso (%s)", calName(cs.mode));
    return;
  }
  memset(cs.sum, 0, sizeof(cs.sum));
  memset(cs.sumSq, 0, sizeof(cs.sumSq));
  memset(cs.n, 0, sizeof(cs.n));
  for (uint8_t i = 0; i < NUM_IMU; i++)
    for (uint8_t k = 0; k < 3; k++) { cs.minv[i][k] = 1e9f; cs.maxv[i][k] = -1e9f; }
  cs.maxGyroDps = 0;
  cs.count = 0;
  switch (mode) {
    case CalMode::GYRO:
      cs.target = GYRO_CAL_SAMPLES;
      postMsg("#CAL giroscopio: mantenga las IMU QUIETAS %.1f s", GYRO_CAL_SAMPLES / (float)SAMPLE_RATE_HZ);
      break;
    case CalMode::ACCEL:
      cs.target = ACCEL_CAL_SAMPLES;
      postMsg("#CAL acelerometro: IMU planas sobre superficie nivelada, Z hacia arriba, quietas");
      break;
    case CalMode::TARE:
      cs.target = TARE_SAMPLES;
      postMsg("#CAL tara: atleta erguido e inmovil durante %.1f s", TARE_SAMPLES / (float)SAMPLE_RATE_HZ);
      break;
    case CalMode::MAG:
      cs.target = MAG_CAL_SECONDS * SAMPLE_RATE_HZ;
      postMsg("#CAL magnetometro: rote cada IMU en forma de \"8\" durante %lu s", (unsigned long)MAG_CAL_SECONDS);
      break;
    default: return;
  }
  cs.mode = mode;
}

static void calFeed(uint8_t i, const Vec3& v) {
  const float a[3] = {v.x, v.y, v.z};
  for (uint8_t k = 0; k < 3; k++) {
    cs.sum[i][k] += a[k];
    cs.sumSq[i][k] += (double)a[k] * a[k];
    if (a[k] < cs.minv[i][k]) cs.minv[i][k] = a[k];
    if (a[k] > cs.maxv[i][k]) cs.maxv[i][k] = a[k];
  }
  cs.n[i]++;
}

static void calFinish() {
  const CalMode mode = cs.mode;
  cs.mode = CalMode::NONE;
  CalibrationData next = gCal;  // solo esta tarea escribe gCal: leer sin bloqueo es seguro
  bool changed = false;

  // El magnetómetro se lee cada MAG_READ_DIVIDER muestras.
  const uint32_t expected = (mode == CalMode::MAG) ? cs.target / MAG_READ_DIVIDER : cs.target;
  for (uint8_t i = 0; i < NUM_IMU; i++) {
    const char* name = IMU_NAMES[i];
    if (!imus[i].ok() && cs.n[i] == 0) {
      postMsg("#INFO IMU %s no conectada: se omite", name);
      continue;
    }
    if (cs.n[i] < expected / 2) {
      postMsg("#WARN IMU %s: datos insuficientes (%lu), calibracion omitida", name, (unsigned long)cs.n[i]);
      continue;
    }
    float mean[3], sd[3];
    for (uint8_t k = 0; k < 3; k++) {
      mean[k] = cs.sum[i][k] / cs.n[i];
      double var = cs.sumSq[i][k] / cs.n[i] - (double)mean[k] * mean[k];
      sd[k] = var > 0 ? sqrt(var) : 0;
    }
    ImuCalibration& c = next.imu[i];

    if (mode == CalMode::GYRO) {
      float worst = fmaxf(sd[0], fmaxf(sd[1], sd[2]));
      if (worst > GYRO_CAL_MAX_STD_DPS) {
        postMsg("#WARN IMU %s: movimiento detectado (std %.2f dps), se conserva el bias anterior", name, worst);
        continue;
      }
      for (uint8_t k = 0; k < 3; k++) c.gyroBias[k] = mean[k];
      next.gyroDone |= (1 << i);
      changed = true;
      postMsg("#OK IMU %s bias giro = [%.3f, %.3f, %.3f] dps", name, mean[0], mean[1], mean[2]);

    } else if (mode == CalMode::ACCEL) {
      float norm = sqrtf(mean[0] * mean[0] + mean[1] * mean[1] + mean[2] * mean[2]);
      if (mean[2] < 0.8f || fabsf(norm - 1.0f) > 0.2f) {
        postMsg("#WARN IMU %s: no esta plana con Z arriba (z=%.2f g, |a|=%.2f g)", name, mean[2], norm);
        continue;
      }
      c.accelOffset[0] = mean[0];
      c.accelOffset[1] = mean[1];
      c.accelOffset[2] = mean[2] - 1.0f;
      next.accelDone |= (1 << i);
      changed = true;
      postMsg("#OK IMU %s offset accel = [%.4f, %.4f, %.4f] g", name, c.accelOffset[0], c.accelOffset[1], c.accelOffset[2]);

    } else if (mode == CalMode::MAG) {
      float range[3];
      bool ok = true;
      for (uint8_t k = 0; k < 3; k++) {
        range[k] = cs.maxv[i][k] - cs.minv[i][k];
        if (range[k] < 10.0f) ok = false;  // no se cubrieron suficientes orientaciones
      }
      if (!ok) {
        postMsg("#WARN IMU %s: rotacion insuficiente (rangos %.1f %.1f %.1f uT)", name, range[0], range[1], range[2]);
        continue;
      }
      float avg = (range[0] + range[1] + range[2]) / 3.0f;
      for (uint8_t k = 0; k < 3; k++) {
        c.magOffset[k] = (cs.maxv[i][k] + cs.minv[i][k]) / 2.0f;
        c.magScale[k] = avg / range[k];
      }
      next.magDone |= (1 << i);
      changed = true;
      postMsg("#OK IMU %s mag offset = [%.1f, %.1f, %.1f] uT", name, c.magOffset[0], c.magOffset[1], c.magOffset[2]);

    } else if (mode == CalMode::TARE) {
      // mean = vector "arriba" promedio durante la postura erguida
      gTareAngle[i] = sagittalAngleDeg(mean[0], mean[1], mean[2]);
      postMsg("#OK IMU %s inclinacion de referencia = %.2f deg", name, gTareAngle[i]);
    }
  }

  if (mode == CalMode::TARE) {
    if (cs.maxGyroDps > 20.0f) {
      postMsg("#WARN hubo movimiento durante la tara (%.1f dps). Repita con 't'", cs.maxGyroDps);
    }
    gTared = true;
    postMsg("#OK tara aplicada: rodilla y tronco = 0 deg en esta postura");
  }
  if (changed) {
    portENTER_CRITICAL(&gCalMux);
    gCal = next;
    portEXIT_CRITICAL(&gCalMux);
    gCalDirty = true;
  }
}

static void handleSamplerCommand(char c) {
  switch (c) {
    case 'g': calStart(CalMode::GYRO); break;
    case 'a': calStart(CalMode::ACCEL); break;
    case 't': calStart(CalMode::TARE); break;
    case 'm': {
      bool any = false;
      for (auto& imu : imus) any |= imu.magType() != MAG_NONE;
      if (any) calStart(CalMode::MAG);
      else postMsg("#ERROR ninguna IMU tiene magnetometro detectado");
      break;
    }
    case 'r':
      calSet([](CalibrationData& d) { d = CalibrationData(); });
      gTared = false;
      for (auto& v : gTareAngle) v = 0;
      postMsg("#OK calibraciones IMU y tara restablecidas");
      break;
  }
}

// ===================== Tarea de muestreo (tiempo real) ================
static void onSampleTimer(void*) {
  if (gSamplerTask) xTaskNotifyGive(gSamplerTask);
}

static void samplerTask(void*) {
  uint32_t seq = 0;
  uint8_t magCounter = 0;
  bool filterReady[NUM_IMU] = {false, false, false};
  Vec3 lastAcc[NUM_IMU] = {}, lastGyr[NUM_IMU] = {}, lastMag[NUM_IMU] = {};
  float segAngle[NUM_IMU] = {0, 0, 0};
  int64_t prevT = 0;
  constexpr float DEG2RAD = 0.01745329252f;
  const float nominalDt = 1.0f / SAMPLE_RATE_HZ;

  for (;;) {
    const uint32_t pending = ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    const int64_t t0 = esp_timer_get_time();

    Sample s;
    s.seq = seq++;
    s.t_us = (uint64_t)t0;
    s.flags = 0;
    if (pending > 1) {
      s.flags |= FLAG_OVERRUN;
      gStats.overruns += pending - 1;
    }

    float dt = prevT ? (t0 - prevT) * 1e-6f : nominalDt;
    if (dt < 0.5f * nominalDt || dt > 3.0f * nominalDt) dt = nominalDt;
    prevT = t0;

    int64_t tStage = t0;
    auto markStage = [&tStage](uint8_t k) {
      const int64_t now = esp_timer_get_time();
      const uint32_t d = (uint32_t)(now - tStage);
      tStage = now;
      gStats.stageLastUs[k] = d;
      if (d > gStats.stageMaxUs[k]) gStats.stageMaxUs[k] = d;
    };

    // ---- Carga plantar
    const uint8_t sat = fsr.sample(s.fsr);
    s.flags |= sat * FLAG_FSR_SAT0;
    markStage(0);

    // ---- IMU
    const bool readMagNow = (magCounter++ % MAG_READ_DIVIDER) == 0;
    for (uint8_t i = 0; i < NUM_IMU; i++) {
      ImuSensor& imu = imus[i];
      const ImuCalibration& c = gCal.imu[i];
      Vec3 a, g;
      if (!imu.read(a, g)) {
        const bool wasOk = imu.ok();
        if (imu.handleError()) {
          if (!wasOk && imu.ok())
            postMsg("#OK IMU %s conectada: %s en 0x%02X, magnetometro %s", IMU_NAMES[i], imu.modelName(),
                    imu.address(), imu.magName());
          else if (wasOk && !imu.ok())
            postMsg("#WARN IMU %s sin respuesta: se buscara cada %lu s", IMU_NAMES[i],
                    (unsigned long)(IMU_RETRY_MS / 1000));
        }
        s.flags |= (FLAG_IMU_ERR0 << i);
        if (!imu.ok()) {
          // IMU ausente: sus columnas quedan en 0 y su ángulo no aporta
          filterReady[i] = false;
          lastAcc[i] = lastGyr[i] = lastMag[i] = Vec3{0, 0, 0};
          segAngle[i] = 0;
        }
        markStage(1 + i);
        continue;  // si solo falló una lectura se conservan los últimos valores válidos
      }
      imu.clearErrors();

      if (cs.mode == CalMode::GYRO) calFeed(i, g);
      if (cs.mode == CalMode::ACCEL) calFeed(i, a);

      a = {a.x - c.accelOffset[0], a.y - c.accelOffset[1], a.z - c.accelOffset[2]};
      g = {g.x - c.gyroBias[0], g.y - c.gyroBias[1], g.z - c.gyroBias[2]};
      lastAcc[i] = a;
      lastGyr[i] = g;

      if (readMagNow && imu.magType() != MAG_NONE) {
        Vec3 m;
        if (imu.readMag(m)) {
          if (cs.mode == CalMode::MAG) calFeed(i, m);
          lastMag[i] = {(m.x - c.magOffset[0]) * c.magScale[0],
                        (m.y - c.magOffset[1]) * c.magScale[1],
                        (m.z - c.magOffset[2]) * c.magScale[2]};
        }
      }

      if (!filterReady[i]) {
        filters[i].initFromAccel(a.x, a.y, a.z);
        filterReady[i] = true;
      } else if (!filters[i].update(g.x * DEG2RAD, g.y * DEG2RAD, g.z * DEG2RAD, a.x, a.y, a.z, dt)) {
        s.flags |= FLAG_GYRO_ONLY;
      }

      float vx, vy, vz;
      filters[i].upVector(vx, vy, vz);
      if (cs.mode == CalMode::TARE) {
        calFeed(i, Vec3{vx, vy, vz});
        float gm = sqrtf(g.x * g.x + g.y * g.y + g.z * g.z);
        if (gm > cs.maxGyroDps) cs.maxGyroDps = gm;
      }
      segAngle[i] = wrap180(sagittalAngleDeg(vx, vy, vz) - gTareAngle[i]);
      markStage(1 + i);
    }

    for (uint8_t i = 0; i < NUM_IMU; i++) {
      s.acc[i] = lastAcc[i];
      s.gyr[i] = lastGyr[i];
      s.mag[i] = lastMag[i];
    }
    // Rodilla = orientación relativa pierna–muslo en el plano sagital.
    s.knee = KNEE_SIGN * wrap180(segAngle[IMU_SHANK] - segAngle[IMU_THIGH]);
    s.trunk = TRUNK_SIGN * segAngle[IMU_LUMBAR];

    // ---- Calibraciones y comandos
    if (cs.mode != CalMode::NONE) {
      s.flags |= FLAG_CALIBRATING;
      if (++cs.count >= cs.target) calFinish();
    }
    if (!gTared) s.flags |= FLAG_NOT_TARED;
    char cmd;
    while (xQueueReceive(gCmdQ, &cmd, 0) == pdTRUE) handleSamplerCommand(cmd);

    // ---- Envío
    gStats.samples++;
    if (gStreaming && xQueueSend(gDataQ, &s, 0) != pdTRUE) gStats.queueDrops++;

    markStage(4);
    const uint32_t dur = (uint32_t)(esp_timer_get_time() - t0);
    gStats.lastSampleUs = dur;
    if (dur > gStats.maxSampleUs) gStats.maxSampleUs = dur;
  }
}

// ======================= Tarea de transmisión serial ==================
static int formatSample(const Sample& s, char* buf, size_t size) {
  int n;
  if (gPlotMode) {  // formato "etiqueta:valor" para el Serial Plotter del IDE
    return snprintf(buf, size, "P1_H:%u,P1_F:%u,P2_H:%u,P2_F:%u,Rodilla:%.1f,Tronco:%.1f\n",
                    s.fsr[0], s.fsr[1], s.fsr[2], s.fsr[3], s.knee, s.trunk);
  }
  n = snprintf(buf, size, "%lu,%llu,%u,%u,%u,%u", (unsigned long)s.seq,
               (unsigned long long)s.t_us, s.fsr[0], s.fsr[1], s.fsr[2], s.fsr[3]);
  for (uint8_t i = 0; i < NUM_IMU; i++) {
    n += snprintf(buf + n, size - n, ",%.3f,%.3f,%.3f,%.2f,%.2f,%.2f,%.1f,%.1f,%.1f",
                  s.acc[i].x, s.acc[i].y, s.acc[i].z, s.gyr[i].x, s.gyr[i].y, s.gyr[i].z,
                  s.mag[i].x, s.mag[i].y, s.mag[i].z);
  }
  n += snprintf(buf + n, size - n, ",%.2f,%.2f,%u\n", s.knee, s.trunk, s.flags);
  return n;
}

static void writerTask(void*) {
  static char line[512];
  Sample s;
  Msg m;
  for (;;) {
    while (xQueueReceive(gMsgQ, &m, 0) == pdTRUE) {
      Serial.print(m.text);
      Serial.print('\n');
    }
    if (xQueueReceive(gDataQ, &s, pdMS_TO_TICKS(5)) == pdTRUE) {
      int n = formatSample(s, line, sizeof(line));
      if (n > 0) Serial.write((const uint8_t*)line, min((size_t)n, sizeof(line) - 1));
    }
  }
}

// ============================ Comandos (loop) =========================
static void printHelp() {
  postMsg("#HELP h ayuda | i estado | c calibraciones | s iniciar | x detener | p plotter");
  postMsg("#HELP t tara (1 s erguido) | g giroscopio (2 s quieto) | a acelerometro (plano Z arriba)");
  postMsg("#HELP m magnetometro (20 s en 8) | r borrar calibraciones IMU");
}

static void printTiming() {
  const float uptime = millis() / 1000.0f;
  postMsg("#STAT %.1f Hz prom. | overruns:%lu | muestra max %lu us de %lu | "
          "etapas ultimo/max us: %s %lu/%lu, %s %lu/%lu, %s %lu/%lu, %s %lu/%lu, %s %lu/%lu",
          uptime > 0 ? gStats.samples / uptime : 0.0f, (unsigned long)gStats.overruns,
          (unsigned long)gStats.maxSampleUs, (unsigned long)SAMPLE_PERIOD_US,
          STAGE_NAMES[0], (unsigned long)gStats.stageLastUs[0], (unsigned long)gStats.stageMaxUs[0],
          STAGE_NAMES[1], (unsigned long)gStats.stageLastUs[1], (unsigned long)gStats.stageMaxUs[1],
          STAGE_NAMES[2], (unsigned long)gStats.stageLastUs[2], (unsigned long)gStats.stageMaxUs[2],
          STAGE_NAMES[3], (unsigned long)gStats.stageLastUs[3], (unsigned long)gStats.stageMaxUs[3],
          STAGE_NAMES[4], (unsigned long)gStats.stageLastUs[4], (unsigned long)gStats.stageMaxUs[4]);
}

static void printInfo() {
  const float uptime = millis() / 1000.0f;
  postMsg("#INFO firmware %s | %lu Hz | %lu baud", FW_VERSION, (unsigned long)SAMPLE_RATE_HZ, (unsigned long)SERIAL_BAUD);
  for (uint8_t i = 0; i < NUM_IMU; i++) {
    ImuSensor& imu = imus[i];
    if (imu.ok())
      postMsg("#INFO IMU %s [%s] %s en 0x%02X | magnetometro: %s | errores_i2c:%lu", IMU_NAMES[i],
              imu.bus().name(), imu.modelName(), imu.address(), imu.magName(), (unsigned long)imu.errorCount());
    else
      postMsg("#INFO IMU %s [%s] NO CONECTADA (se busca cada %lu s)", IMU_NAMES[i], imu.bus().name(),
              (unsigned long)(IMU_RETRY_MS / 1000));
  }
  postMsg("#INFO muestras:%lu (%.1f Hz prom.) overruns:%lu perdidas_cola:%lu msgs_perdidos:%lu",
          (unsigned long)gStats.samples, uptime > 0 ? gStats.samples / uptime : 0.0f,
          (unsigned long)gStats.overruns, (unsigned long)gStats.queueDrops, (unsigned long)gStats.msgDrops);
  postMsg("#INFO tiempo de muestra: ultimo %lu us, maximo %lu us (presupuesto %lu us)",
          (unsigned long)gStats.lastSampleUs, (unsigned long)gStats.maxSampleUs, (unsigned long)SAMPLE_PERIOD_US);
  printTiming();
  postMsg("#INFO tara:%s transmision:%s modo:%s", gTared ? "SI" : "NO", gStreaming ? "ON" : "OFF",
          gPlotMode ? "plotter" : "csv");
}

static void printCalibration() {
  CalibrationData c;
  portENTER_CRITICAL(&gCalMux);
  c = gCal;
  portEXIT_CRITICAL(&gCalMux);
  for (uint8_t i = 0; i < NUM_IMU; i++) {
    const ImuCalibration& k = c.imu[i];
    postMsg("#CALDATA %s gyro_bias=[%.3f,%.3f,%.3f]%s accel_off=[%.4f,%.4f,%.4f]%s mag_off=[%.1f,%.1f,%.1f]%s tara=%.2f",
            IMU_NAMES[i], k.gyroBias[0], k.gyroBias[1], k.gyroBias[2], (c.gyroDone >> i) & 1 ? "" : "(sin cal)",
            k.accelOffset[0], k.accelOffset[1], k.accelOffset[2], (c.accelDone >> i) & 1 ? "" : "(sin cal)",
            k.magOffset[0], k.magOffset[1], k.magOffset[2], (c.magDone >> i) & 1 ? "" : "(sin cal)",
            gTareAngle[i]);
  }
}

static void handleCommand(char c) {
  switch (c) {
    case '\r': case '\n': case ' ': break;
    case 'h': case '?': printHelp(); break;
    case 'i': printInfo(); break;
    case 'c': printCalibration(); break;
    case 's': gStreaming = true; postHeader(); break;
    case 'x': gStreaming = false; postMsg("#OK transmision detenida"); break;
    case 'p':
      gPlotMode = !gPlotMode;
      postMsg("#OK modo %s", gPlotMode ? "Serial Plotter" : "CSV");
      if (!gPlotMode) postHeader();
      break;
    case 'g': case 'a': case 't': case 'm': case 'r':
      if (xQueueSend(gCmdQ, &c, 0) != pdTRUE) postMsg("#ERROR cola de comandos llena");
      break;
    default: postMsg("#ERROR comando desconocido '%c' (h = ayuda)", c); break;
  }
}

// ================================ Arranque ============================
void appSetup() {
  Serial.setTxBufferSize(SERIAL_TX_BUFFER);
  Serial.begin(SERIAL_BAUD);
  delay(300);

  gDataQ = xQueueCreate(SAMPLE_QUEUE_LEN, sizeof(Sample));
  gMsgQ = xQueueCreate(32, sizeof(Msg));
  gCmdQ = xQueueCreate(8, sizeof(char));

  xTaskCreatePinnedToCore(writerTask, "tx", 4096, nullptr, 3, nullptr, 0);

  postMsg("#BOOT Sistema de evaluacion biomecanica del aterrizaje - firmware %s", FW_VERSION);
  if (calstore::load(gCal)) postMsg("#BOOT calibraciones IMU cargadas desde NVS");
  else postMsg("#BOOT sin calibraciones guardadas (use 'a' y 'm'; el giroscopio se calibra ahora)");

  fsr.begin();
  busThigh.begin();
  busShank.begin();
  busLumbar.begin();
  for (uint8_t i = 0; i < NUM_IMU; i++) {
    imus[i].begin(SAMPLE_RATE_HZ);
    filters[i].kp = MAHONY_KP;
    filters[i].ki = MAHONY_KI;
    filters[i].gateG = ACCEL_GATE_G;
  }
  printInfo();

  xTaskCreatePinnedToCore(samplerTask, "sampler", 6144, nullptr, 10, &gSamplerTask, 1);

  const esp_timer_create_args_t args = {
      .callback = &onSampleTimer, .arg = nullptr, .dispatch_method = ESP_TIMER_TASK,
      .name = "sample", .skip_unhandled_events = false};
  esp_timer_create(&args, &gTimer);
  esp_timer_start_periodic(gTimer, SAMPLE_PERIOD_US);

  // Documento: bias del giroscopio con 2 s en reposo al encender.
  char cmd = 'g';
  xQueueSend(gCmdQ, &cmd, 0);
  printHelp();
  postHeader();
}

void appLoop() {
  while (Serial.available()) handleCommand((char)Serial.read());

  if (gCalDirty) {
    CalibrationData copy;
    portENTER_CRITICAL(&gCalMux);
    copy = gCal;
    gCalDirty = false;
    portEXIT_CRITICAL(&gCalMux);
    postMsg(calstore::save(copy) ? "#OK calibracion guardada en NVS" : "#ERROR no se pudo guardar en NVS");
  }
  // Reporte periódico de tiempos (desactivado por defecto; útil en simulación)
  static uint32_t lastStats = 0;
  if (AUTO_STATS_S > 0 && millis() - lastStats >= AUTO_STATS_S * 1000UL) {
    lastStats = millis();
    printTiming();
  }
  vTaskDelay(pdMS_TO_TICKS(10));
}
