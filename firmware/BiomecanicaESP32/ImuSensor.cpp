#include "ImuSensor.h"
#include "config.h"

// ----------------------------- MPU6050 -------------------------------
namespace mpu {
constexpr uint8_t ADDR_LO = 0x68, ADDR_HI = 0x69;   // AD0 a GND / a VCC
constexpr uint8_t SMPLRT_DIV = 0x19;
constexpr uint8_t CONFIG = 0x1A;
constexpr uint8_t GYRO_CONFIG = 0x1B;
constexpr uint8_t ACCEL_CONFIG = 0x1C;
constexpr uint8_t ACCEL_CONFIG2 = 0x1D;              // solo familia MPU6500/9250
constexpr uint8_t INT_PIN_CFG = 0x37;
constexpr uint8_t ACCEL_XOUT_H = 0x3B;               // ax ay az temp gx gy gz (14 bytes)
constexpr uint8_t USER_CTRL = 0x6A;
constexpr uint8_t PWR_MGMT_1 = 0x6B;
constexpr uint8_t WHO_AM_I = 0x75;
// ±16 g y ±2000 °/s: los mismos rangos que el GY-85. En el impacto del
// aterrizaje la pierna supera con facilidad 8 g y 500 °/s.
constexpr float LSB_PER_G = 2048.0f;
constexpr float LSB_PER_DPS = 16.4f;
inline bool knownId(uint8_t id) {
  // 0x68 MPU6050 · 0x98/0x72 clones de MPU6050 · 0x70 MPU6500 · 0x71/0x73 MPU9250/9255
  return id == 0x68 || id == 0x98 || id == 0x72 || id == 0x70 || id == 0x71 || id == 0x73;
}
}  // namespace mpu

// ----------------------------- ADXL345 (GY-85) -----------------------
namespace adxl {
constexpr uint8_t ADDR = 0x53;
constexpr uint8_t DEVID = 0x00;       // debe leer 0xE5
constexpr uint8_t BW_RATE = 0x2C;
constexpr uint8_t POWER_CTL = 0x2D;
constexpr uint8_t DATA_FORMAT = 0x31;
constexpr uint8_t DATAX0 = 0x32;
constexpr float SCALE_G = 0.0039f;    // 3,9 mg/LSB en resolución completa
}  // namespace adxl

// ----------------------------- ITG3200 (GY-85) -----------------------
namespace itg {
constexpr uint8_t ADDR = 0x68;
constexpr uint8_t WHO_AM_I = 0x00;    // bits[6:1] = 0x34
constexpr uint8_t SMPLRT_DIV = 0x15;
constexpr uint8_t DLPF_FS = 0x16;
constexpr uint8_t GYRO_XOUT_H = 0x1D;
constexpr uint8_t PWR_MGM = 0x3E;
constexpr float LSB_PER_DPS = 14.375f;
}  // namespace itg

// ----------------------------- Magnetómetros -------------------------
namespace qmcp {  // QMC5883P (el de las placas MPU6050 + QMC5883P)
constexpr uint8_t ADDR = 0x2C;
constexpr uint8_t CHIP_ID = 0x00;     // debe leer 0x80
constexpr uint8_t DATA = 0x01;        // X, Y, Z little endian
constexpr uint8_t CTRL1 = 0x0A, CTRL2 = 0x0B, AXIS_SIGN = 0x29;
constexpr float LSB_PER_GAUSS = 3750.0f;  // rango ±8 G
}  // namespace qmcp
namespace hmc {
constexpr uint8_t ADDR = 0x1E;
constexpr uint8_t CRA = 0x00, CRB = 0x01, MODE = 0x02, DATA = 0x03;
constexpr float LSB_PER_GAUSS = 1090.0f;  // ganancia ±1,3 Ga
}  // namespace hmc
namespace qmc {
constexpr uint8_t ADDR = 0x0D;
constexpr uint8_t DATA = 0x00, CTRL1 = 0x09, SETRESET = 0x0B, CHIP_ID = 0x0D;
constexpr float LSB_PER_GAUSS = 3000.0f;  // rango ±8 G
}  // namespace qmc

static inline int16_t le16(const uint8_t* b) { return (int16_t)((b[1] << 8) | b[0]); }
static inline int16_t be16(const uint8_t* b) { return (int16_t)((b[0] << 8) | b[1]); }

// ======================================================================
bool ImuSensor::begin(uint32_t sampleRateHz) {
  sampleRateHz_ = sampleRateHz;
  model_ = IMU_NONE;
  magType_ = MAG_NONE;
  // Primero el GY-85 (su acelerómetro está en 0x53, dirección que el MPU
  // no usa); luego el MPU en sus dos direcciones posibles.
  if (initGy85()) model_ = IMU_GY85;
  else if (initMpu(mpu::ADDR_LO) || initMpu(mpu::ADDR_HI)) model_ = IMU_MPU6050;
  if (model_ != IMU_NONE) {
    initMag();
    everOk_ = true;
  }
  consecutiveErrors_ = 0;
  return model_ != IMU_NONE;
}

bool ImuSensor::initMpu(uint8_t addr) {
  uint8_t id = 0;
  if (!bus_.readRegs(addr, mpu::WHO_AM_I, &id, 1) || !mpu::knownId(id)) return false;
  addr_ = addr;
  whoAmI_ = id;
  uint8_t dlpf = 3;                          // 44 Hz (anti-aliasing para 100 Hz)
  if (sampleRateHz_ > 150) dlpf = 2;         // 94 Hz
  if (sampleRateHz_ > 300) dlpf = 1;         // 184 Hz
  uint32_t div = 1000 / sampleRateHz_;       // con DLPF activo el muestreo interno es 1 kHz
  if (div < 1) div = 1;
  if (div > 256) div = 256;
  bool ok = bus_.writeReg(addr, mpu::PWR_MGMT_1, 0x01) &&   // despertar, reloj PLL del giro X
            bus_.writeReg(addr, mpu::SMPLRT_DIV, (uint8_t)(div - 1)) &&
            bus_.writeReg(addr, mpu::CONFIG, dlpf) &&
            bus_.writeReg(addr, mpu::GYRO_CONFIG, 0x18) &&  // ±2000 °/s
            bus_.writeReg(addr, mpu::ACCEL_CONFIG, 0x18) && // ±16 g
            bus_.writeReg(addr, mpu::USER_CTRL, 0x00) &&    // maestro I2C auxiliar apagado
            bus_.writeReg(addr, mpu::INT_PIN_CFG, 0x02);    // bypass: el magnetómetro queda en este bus
  if (ok && id != 0x68 && id != 0x98 && id != 0x72) bus_.writeReg(addr, mpu::ACCEL_CONFIG2, 0x03);
  // Comprobar que despertó (bit SLEEP en 0)
  uint8_t pwr = 0xFF;
  return ok && bus_.readRegs(addr, mpu::PWR_MGMT_1, &pwr, 1) && !(pwr & 0x40);
}

bool ImuSensor::initGy85() {
  uint8_t id = 0;
  if (!bus_.readRegs(adxl::ADDR, adxl::DEVID, &id, 1) || id != 0xE5) return false;
  uint8_t rate = 0x0A;                         // 100 Hz
  if (sampleRateHz_ > 100) rate = 0x0B;        // 200 Hz
  if (sampleRateHz_ > 200) rate = 0x0C;        // 400 Hz
  if (sampleRateHz_ > 400) rate = 0x0D;        // 800 Hz
  bool accel = bus_.writeReg(adxl::ADDR, adxl::POWER_CTL, 0x00) &&
               bus_.writeReg(adxl::ADDR, adxl::BW_RATE, rate) &&
               bus_.writeReg(adxl::ADDR, adxl::DATA_FORMAT, 0x0B) &&  // FULL_RES, ±16 g
               bus_.writeReg(adxl::ADDR, adxl::POWER_CTL, 0x08);      // modo medición
  if (!accel) return false;
  if (!bus_.readRegs(itg::ADDR, itg::WHO_AM_I, &id, 1) || ((id >> 1) & 0x3F) != 0x34) return false;
  if (!bus_.writeReg(itg::ADDR, itg::PWR_MGM, 0x80)) return false;  // reset
  delay(5);
  uint8_t dlpf = 3;                          // 42 Hz
  if (sampleRateHz_ > 150) dlpf = 2;         // 98 Hz
  if (sampleRateHz_ > 300) dlpf = 1;         // 188 Hz
  uint32_t div = 1000 / sampleRateHz_;
  if (div < 1) div = 1;
  if (div > 256) div = 256;
  addr_ = itg::ADDR;
  return bus_.writeReg(itg::ADDR, itg::PWR_MGM, 0x01) &&
         bus_.writeReg(itg::ADDR, itg::SMPLRT_DIV, (uint8_t)(div - 1)) &&
         bus_.writeReg(itg::ADDR, itg::DLPF_FS, (uint8_t)(0x18 | dlpf));
}

void ImuSensor::initMag() {
  magType_ = MAG_NONE;
  uint8_t id = 0;
  if (bus_.readRegs(qmcp::ADDR, qmcp::CHIP_ID, &id, 1) && id == 0x80) {
    bool ok = bus_.writeReg(qmcp::ADDR, qmcp::AXIS_SIGN, 0x06) &&
              bus_.writeReg(qmcp::ADDR, qmcp::CTRL2, 0x08) &&   // set/reset, ±8 G
              bus_.writeReg(qmcp::ADDR, qmcp::CTRL1, 0xCD);     // modo normal, 200 Hz
    if (ok) magType_ = MAG_QMC5883P;
    return;
  }
  if (bus_.probe(hmc::ADDR)) {
    bool ok = bus_.writeReg(hmc::ADDR, hmc::CRA, 0x18) &&  // 1 muestra, 75 Hz
              bus_.writeReg(hmc::ADDR, hmc::CRB, 0x20) &&  // ±1,3 Ga
              bus_.writeReg(hmc::ADDR, hmc::MODE, 0x00);   // continuo
    if (ok) magType_ = MAG_HMC5883L;
    return;
  }
  if (bus_.probe(qmc::ADDR) && bus_.readRegs(qmc::ADDR, qmc::CHIP_ID, &id, 1) && id == 0xFF) {
    bool ok = bus_.writeReg(qmc::ADDR, qmc::SETRESET, 0x01) &&
              bus_.writeReg(qmc::ADDR, qmc::CTRL1, 0x19);  // OSR512, ±8 G, 100 Hz, continuo
    if (ok) magType_ = MAG_QMC5883L;
  }
}

const char* ImuSensor::modelName() const {
  switch (model_) {
    case IMU_MPU6050:
      return whoAmI_ == 0x70 ? "MPU6500" : (whoAmI_ == 0x71 || whoAmI_ == 0x73) ? "MPU9250" : "MPU6050";
    case IMU_GY85: return "GY-85";
    default: return "no conectada";
  }
}

const char* ImuSensor::magName() const {
  switch (magType_) {
    case MAG_HMC5883L: return "HMC5883L";
    case MAG_QMC5883L: return "QMC5883L";
    case MAG_QMC5883P: return "QMC5883P";
    default: return "ninguno";
  }
}

// ======================================================================
bool ImuSensor::read(Vec3& a, Vec3& g) {
  switch (model_) {
    case IMU_MPU6050: return readMpu(a, g);
    case IMU_GY85: return readGy85(a, g);
    default: return false;  // sin IMU: no se ocupa el bus
  }
}

bool ImuSensor::readMpu(Vec3& a, Vec3& g) {
  uint8_t b[14];
  if (!bus_.readRegs(addr_, mpu::ACCEL_XOUT_H, b, 14)) return false;
  a.x = be16(b + 0) / mpu::LSB_PER_G;
  a.y = be16(b + 2) / mpu::LSB_PER_G;
  a.z = be16(b + 4) / mpu::LSB_PER_G;
  // b[6..7] = temperatura (no se usa)
  g.x = be16(b + 8) / mpu::LSB_PER_DPS;
  g.y = be16(b + 10) / mpu::LSB_PER_DPS;
  g.z = be16(b + 12) / mpu::LSB_PER_DPS;
  return true;
}

bool ImuSensor::readGy85(Vec3& a, Vec3& g) {
  uint8_t b[6];
  if (!bus_.readRegs(adxl::ADDR, adxl::DATAX0, b, 6)) return false;
  a.x = le16(b + 0) * adxl::SCALE_G;
  a.y = le16(b + 2) * adxl::SCALE_G;
  a.z = le16(b + 4) * adxl::SCALE_G;
  if (!bus_.readRegs(itg::ADDR, itg::GYRO_XOUT_H, b, 6)) return false;
  const float raw[3] = {be16(b + 0) / itg::LSB_PER_DPS, be16(b + 2) / itg::LSB_PER_DPS,
                        be16(b + 4) / itg::LSB_PER_DPS};
  // Alineación del ITG3200 con los ejes del ADXL345 (ver config.h).
  g.x = GYRO_AXIS_SIGN[0] * raw[GYRO_AXIS_MAP[0]];
  g.y = GYRO_AXIS_SIGN[1] * raw[GYRO_AXIS_MAP[1]];
  g.z = GYRO_AXIS_SIGN[2] * raw[GYRO_AXIS_MAP[2]];
  return true;
}

bool ImuSensor::readMag(Vec3& m) {
  uint8_t b[6];
  if (magType_ == MAG_QMC5883P) {
    if (!bus_.readRegs(qmcp::ADDR, qmcp::DATA, b, 6)) return false;
    const float k = 100.0f / qmcp::LSB_PER_GAUSS;  // 1 G = 100 µT
    m = {le16(b + 0) * k, le16(b + 2) * k, le16(b + 4) * k};
    return true;
  }
  if (magType_ == MAG_HMC5883L) {
    if (!bus_.readRegs(hmc::ADDR, hmc::DATA, b, 6)) return false;
    int16_t x = be16(b + 0), z = be16(b + 2), y = be16(b + 4);  // orden X, Z, Y
    if (x == -4096 || y == -4096 || z == -4096) return false;   // desbordamiento
    const float k = 100.0f / hmc::LSB_PER_GAUSS;
    m = {x * k, y * k, z * k};
    return true;
  }
  if (magType_ == MAG_QMC5883L) {
    if (!bus_.readRegs(qmc::ADDR, qmc::DATA, b, 6)) return false;
    const float k = 100.0f / qmc::LSB_PER_GAUSS;
    m = {le16(b + 0) * k, le16(b + 2) * k, le16(b + 4) * k};
    return true;
  }
  return false;
}

bool ImuSensor::handleError() {
  if (model_ != IMU_NONE) errorCount_++;   // una IMU ausente no cuenta como error de bus
  consecutiveErrors_++;
  const uint32_t now = millis();
  if (everOk_ && model_ != IMU_NONE) {
    // Estaba funcionando: un cable suelto o un bus colgado → recuperar rápido.
    if (consecutiveErrors_ >= 10 && now - lastRecoverMs_ > 500) {
      lastRecoverMs_ = now;
      bus_.recover();
      begin(sampleRateHz_);
      return true;
    }
    return false;
  }
  // Nunca se detectó (o se perdió del todo): buscarla cada IMU_RETRY_MS.
  if (now - lastRecoverMs_ >= IMU_RETRY_MS) {
    lastRecoverMs_ = now;
    if (everOk_) bus_.recover();
    begin(sampleRateHz_);
    return true;
  }
  return false;
}
