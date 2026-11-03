// =====================================================================
//  ImuSensor.h — Driver de IMU de 9 ejes a nivel de registros, con
//  detección automática del modelo en cada bus:
//
//    MPU6050 (GY-521 / GY-87 y clones MPU6500/9250)   0x68 o 0x69
//        acelerómetro + giroscopio en una sola lectura de 14 bytes.
//        El magnetómetro va "detrás" del MPU: se activa el modo bypass
//        (INT_PIN_CFG.I2C_BYPASS_EN) y aparece en el mismo bus.
//    GY-85  ADXL345 0x53 + ITG3200 0x68  (lo usa la simulación de Wokwi
//        y el gemelo digital; se conserva para no romperlos)
//
//    Magnetómetros reconocidos: QMC5883P (0x2C), HMC5883L (0x1E),
//    QMC5883L (0x0D). Es opcional: la fusión no lo usa.
//
//  Si no hay ninguna IMU conectada (p. ej. la lumbar todavía no se ha
//  instalado) begin() devuelve false, las lecturas fallan sin ocupar el
//  bus y el programa reintenta cada pocos segundos (conexión en caliente).
// =====================================================================
#pragma once
#include "I2CBus.h"

struct Vec3 {
  float x, y, z;
};

enum ImuModel : uint8_t { IMU_NONE = 0, IMU_MPU6050, IMU_GY85 };
enum MagType : uint8_t { MAG_NONE = 0, MAG_HMC5883L, MAG_QMC5883L, MAG_QMC5883P };

class ImuSensor {
 public:
  explicit ImuSensor(I2CBus& bus) : bus_(bus) {}

  // Detecta y configura la IMU. true si acelerómetro y giroscopio responden.
  bool begin(uint32_t sampleRateHz);

  // Lectura conjunta. Unidades: aceleración en g, velocidad angular en °/s.
  bool read(Vec3& acc_g, Vec3& gyr_dps);
  bool readMag(Vec3& mag_uT);  // µT

  // Llamar cuando falla una lectura: tras varios fallos seguidos intenta
  // recuperar el bus y volver a detectar la IMU (reconexión en caliente).
  // Devuelve true si en este llamado se intentó la reconexión.
  bool handleError();
  void clearErrors() { consecutiveErrors_ = 0; }

  bool ok() const { return model_ != IMU_NONE; }
  ImuModel model() const { return model_; }
  const char* modelName() const;
  uint8_t address() const { return addr_; }
  MagType magType() const { return magType_; }
  const char* magName() const;
  uint32_t errorCount() const { return errorCount_; }
  I2CBus& bus() { return bus_; }

 private:
  I2CBus& bus_;
  uint32_t sampleRateHz_ = 100;
  ImuModel model_ = IMU_NONE;
  uint8_t addr_ = 0;       // dirección del MPU (0x68/0x69)
  uint8_t whoAmI_ = 0;
  MagType magType_ = MAG_NONE;
  uint32_t errorCount_ = 0;
  uint16_t consecutiveErrors_ = 0;
  uint32_t lastRecoverMs_ = 0;
  bool everOk_ = false;

  bool initMpu(uint8_t addr);
  bool initGy85();
  void initMag();
  bool readMpu(Vec3& a, Vec3& g);
  bool readGy85(Vec3& a, Vec3& g);
};
