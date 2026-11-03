// =====================================================================
//  Calibration.h — Parámetros de calibración de las IMU guardados en la
//  memoria no volátil (NVS) del ESP32: sobreviven a reinicios.
//  La calibración de los FSR (curva señal → fuerza por sensor) se aplica
//  en el software del computador, a partir de los datos crudos.
// =====================================================================
#pragma once
#include <Arduino.h>
#include "config.h"

struct ImuCalibration {
  float gyroBias[3] = {0, 0, 0};     // °/s   (se resta)
  float accelOffset[3] = {0, 0, 0};  // g     (se resta)
  float magOffset[3] = {0, 0, 0};    // µT    (hierro duro, se resta)
  float magScale[3] = {1, 1, 1};     // adimensional (hierro blando, diagonal)
};

struct CalibrationData {
  uint32_t magic = 0;
  ImuCalibration imu[NUM_IMU];
  // Bit i = la calibración del tipo correspondiente ya se realizó.
  uint8_t gyroDone = 0, accelDone = 0, magDone = 0;
};

namespace calstore {
bool load(CalibrationData& out);   // false si no hay datos válidos guardados
bool save(const CalibrationData& in);
}
