#include "Orientation.h"

void MahonyFilter::reset() {
  q0_ = 1; q1_ = q2_ = q3_ = 0;
  ix_ = iy_ = iz_ = 0;
}

void MahonyFilter::initFromAccel(float ax, float ay, float az) {
  float n = sqrtf(ax * ax + ay * ay + az * az);
  if (n < 1e-6f) { reset(); return; }
  ax /= n; ay /= n; az /= n;
  // Cuaternión de rotación mínima que lleva el vector medido a al eje Z
  // terrestre: q = normalizar(1 + a·ez, a × ez).
  if (az < -0.9999f) {          // sensor boca abajo: 180° alrededor de X
    q0_ = 0; q1_ = 1; q2_ = 0; q3_ = 0;
  } else {
    q0_ = 1.0f + az; q1_ = ay; q2_ = -ax; q3_ = 0;
    float qn = sqrtf(q0_ * q0_ + q1_ * q1_ + q2_ * q2_);
    q0_ /= qn; q1_ /= qn; q2_ /= qn;
  }
  ix_ = iy_ = iz_ = 0;
}

bool MahonyFilter::update(float gx, float gy, float gz, float ax, float ay, float az, float dt) {
  bool accelUsed = false;
  const float n = sqrtf(ax * ax + ay * ay + az * az);
  if (n > 1e-6f && fabsf(n - 1.0f) <= gateG) {
    ax /= n; ay /= n; az /= n;
    // Dirección de la gravedad estimada por el cuaternión actual.
    float vx, vy, vz;
    upVector(vx, vy, vz);
    // Error = producto cruz entre lo medido y lo estimado.
    const float ex = ay * vz - az * vy;
    const float ey = az * vx - ax * vz;
    const float ez = ax * vy - ay * vx;
    if (ki > 0.0f) {
      ix_ += ki * ex * dt; iy_ += ki * ey * dt; iz_ += ki * ez * dt;
      gx += ix_; gy += iy_; gz += iz_;
    }
    gx += kp * ex; gy += kp * ey; gz += kp * ez;
    accelUsed = true;
  }

  // Integración del cuaternión: q̇ = ½ q ⊗ ω
  gx *= 0.5f * dt; gy *= 0.5f * dt; gz *= 0.5f * dt;
  const float a = q0_, b = q1_, c = q2_;
  q0_ += (-b * gx - c * gy - q3_ * gz);
  q1_ += (a * gx + c * gz - q3_ * gy);
  q2_ += (a * gy - b * gz + q3_ * gx);
  q3_ += (a * gz + b * gy - c * gx);
  const float qn = sqrtf(q0_ * q0_ + q1_ * q1_ + q2_ * q2_ + q3_ * q3_);
  q0_ /= qn; q1_ /= qn; q2_ /= qn; q3_ /= qn;
  return accelUsed;
}

void MahonyFilter::upVector(float& vx, float& vy, float& vz) const {
  vx = 2.0f * (q1_ * q3_ - q0_ * q2_);
  vy = 2.0f * (q0_ * q1_ + q2_ * q3_);
  vz = q0_ * q0_ - q1_ * q1_ - q2_ * q2_ + q3_ * q3_;
}
