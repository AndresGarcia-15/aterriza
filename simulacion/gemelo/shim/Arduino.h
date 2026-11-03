// Arduino.h mínimo para compilar módulos del firmware en el PC (gemelo digital).
#pragma once
#include <cstdint>
#include <cstddef>
#include <cmath>
#include <algorithm>
using std::min; using std::max;
#define INPUT 0x01
enum { ADC_0db, ADC_2_5db, ADC_6db, ADC_11db };
extern double g_sim_t;                 // tiempo simulado (s)
inline uint32_t millis() { return (uint32_t)(g_sim_t * 1000.0); }
inline uint32_t micros() { return (uint32_t)(g_sim_t * 1e6); }
inline void delay(uint32_t) {}
inline void delayMicroseconds(uint32_t) {}
inline void pinMode(uint8_t, uint8_t) {}
inline void analogReadResolution(uint8_t) {}
inline void analogSetPinAttenuation(uint8_t, int) {}
uint16_t analogRead(uint8_t pin);     // implementado en sim_host.cpp
