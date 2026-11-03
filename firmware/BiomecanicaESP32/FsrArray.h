// =====================================================================
//  FsrArray.h — Lectura de los 4 sensores de carga (FSR 402)
//  Circuito: 3,3 V — FSR — nodo ADC — R 10 kΩ — GND
//  Vout = Vcc · R / (R + R_FSR)   →  la lectura SUBE con la carga.
//  Se transmiten cuentas crudas del ADC (0-4095). La conversión a fuerza
//  se hace con la curva de calibración individual de cada sensor.
// =====================================================================
#pragma once
#include <Arduino.h>
#include "config.h"

class FsrArray {
 public:
  void begin();
  // Llena out[] con la lectura filtrada y devuelve una máscara de bits
  // con los canales saturados (bit i = sensor i).
  uint8_t sample(uint16_t out[NUM_FSR]);

 private:
  uint16_t history_[NUM_FSR][FSR_MOVING_AVG] = {};
  uint32_t sum_[NUM_FSR] = {};
  uint8_t index_ = 0;
  uint8_t filled_ = 0;
};
