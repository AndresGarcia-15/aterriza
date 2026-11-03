#include "FsrArray.h"

static_assert(FSR_MOVING_AVG >= 1, "FSR_MOVING_AVG debe ser >= 1");
static_assert(FSR_OVERSAMPLE >= 1, "FSR_OVERSAMPLE debe ser >= 1");

void FsrArray::begin() {
  analogReadResolution(12);
  for (uint8_t i = 0; i < NUM_FSR; i++) {
    pinMode(PIN_FSR[i], INPUT);                   // GPIO 34/35 no tienen pull-up interna
    analogSetPinAttenuation(PIN_FSR[i], ADC_11db); // rango ~0-3,1 V
  }
}

uint8_t FsrArray::sample(uint16_t out[NUM_FSR]) {
  uint8_t satMask = 0;
  for (uint8_t i = 0; i < NUM_FSR; i++) {
    uint32_t acc = 0;
    for (uint8_t k = 0; k < FSR_OVERSAMPLE; k++) acc += analogRead(PIN_FSR[i]);
    const uint16_t raw = (uint16_t)(acc / FSR_OVERSAMPLE);
    if (raw >= FSR_SATURATION_RAW) satMask |= (1 << i);

    // Promedio móvil (suma corrida, O(1) por muestra).
    sum_[i] -= history_[i][index_];
    history_[i][index_] = raw;
    sum_[i] += raw;
  }
  index_ = (index_ + 1) % FSR_MOVING_AVG;
  if (filled_ < FSR_MOVING_AVG) filled_++;
  for (uint8_t i = 0; i < NUM_FSR; i++) out[i] = (uint16_t)(sum_[i] / filled_);
  return satMask;
}
