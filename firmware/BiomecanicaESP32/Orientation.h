// =====================================================================
//  Orientation.h — Fusión de orientación por segmento (filtro Mahony)
//  C++ puro (sin dependencias de Arduino) para poder probarlo en el PC.
//
//  Por qué así:
//  - Solo acelerómetro: durante el aterrizaje mide picos de impacto, no
//    gravedad → ángulos falsos.
//  - Solo giroscopio: deriva con el tiempo.
//  - Mahony combina ambos: el giroscopio sigue el movimiento rápido y el
//    acelerómetro corrige la deriva cuando el segmento está cuasi-estático.
//    Si |a| se aleja de 1 g (impacto), se ignora el acelerómetro.
//  - El magnetómetro no se usa: dentro de laboratorios y cerca del ESP32
//    el campo magnético está distorsionado. Se transmite crudo para el PC.
// =====================================================================
#pragma once
#include <math.h>

class MahonyFilter {
 public:
  float kp = 1.0f, ki = 0.0f, gateG = 0.15f;

  void reset();
  // Inicializa la orientación alineada con la gravedad medida (converge
  // de inmediato en lugar de tardar varios segundos).
  void initFromAccel(float ax, float ay, float az);
  // g: rad/s · a: en g (cualquier escala, se normaliza) · dt: segundos.
  // Devuelve true si el acelerómetro se usó en la corrección.
  bool update(float gx, float gy, float gz, float ax, float ay, float az, float dt);
  // Dirección "arriba" (opuesta a la gravedad) expresada en ejes del sensor.
  void upVector(float& vx, float& vy, float& vz) const;
  void quaternion(float& w, float& x, float& y, float& z) const { w = q0_; x = q1_; y = q2_; z = q3_; }

 private:
  float q0_ = 1, q1_ = 0, q2_ = 0, q3_ = 0;
  float ix_ = 0, iy_ = 0, iz_ = 0;
};

// Inclinación del segmento en el plano sagital (rotación alrededor del
// eje Y medio-lateral), en grados. 0° cuando el eje X apunta hacia arriba.
inline float sagittalAngleDeg(float vx, float /*vy*/, float vz) {
  return atan2f(vz, vx) * 57.29577951f;
}

inline float wrap180(float deg) {
  while (deg > 180.0f) deg -= 360.0f;
  while (deg < -180.0f) deg += 360.0f;
  return deg;
}
