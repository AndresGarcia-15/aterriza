// =====================================================================
//  GY85.h — Driver del módulo GY-85 (9 DOF) a nivel de registros
//    ADXL345  acelerómetro   0x53   (±16 g, resolución completa)
//    ITG3200  giroscopio     0x68   (±2000 °/s)
//    HMC5883L magnetómetro   0x1E   — muchos clones traen QMC5883L en
//    QMC5883L magnetómetro   0x0D     0x0D; se detecta automáticamente.
//  Sin librerías externas: control total de rangos y filtros.
// =====================================================================
#pragma once
#include "I2CBus.h"

struct Vec3 {
  float x, y, z;
};

enum MagType : uint8_t { MAG_NONE = 0, MAG_HMC5883L, MAG_QMC5883L };

class GY85 {
 public:
  explicit GY85(I2CBus& bus) : bus_(bus) {}

  // Detecta y configura los tres chips. Devuelve true si acelerómetro y
  // giroscopio responden (el magnetómetro es opcional).
  bool begin(uint32_t sampleRateHz);

  // Unidades: aceleración en g, velocidad angular en °/s, campo en µT.
  bool readAccel(Vec3& acc_g);
  bool readGyro(Vec3& gyr_dps);
  bool readMag(Vec3& mag_uT);

  // Llamar cuando falla una lectura: tras varios fallos seguidos intenta
  // recuperar el bus y reconfigurar los chips (reconexión en caliente).
  void handleError();
  void clearErrors() { consecutiveErrors_ = 0; }

  bool accelOk() const { return accelOk_; }
  bool gyroOk() const { return gyroOk_; }
  MagType magType() const { return magType_; }
  const char* magName() const;
  uint32_t errorCount() const { return errorCount_; }
  I2CBus& bus() { return bus_; }

 private:
  I2CBus& bus_;
  uint32_t sampleRateHz_ = 100;
  bool accelOk_ = false, gyroOk_ = false;
  MagType magType_ = MAG_NONE;
  uint32_t errorCount_ = 0;
  uint16_t consecutiveErrors_ = 0;
  uint32_t lastRecoverMs_ = 0;

  bool initAccel();
  bool initGyro();
  void initMag();
};
