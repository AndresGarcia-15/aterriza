#include "GY85.h"
#include "config.h"

// ----------------------------- ADXL345 -------------------------------
namespace adxl {
constexpr uint8_t ADDR = 0x53;
constexpr uint8_t DEVID = 0x00;       // debe leer 0xE5
constexpr uint8_t BW_RATE = 0x2C;
constexpr uint8_t POWER_CTL = 0x2D;
constexpr uint8_t DATA_FORMAT = 0x31;
constexpr uint8_t DATAX0 = 0x32;
constexpr float SCALE_G = 0.0039f;    // 3,9 mg/LSB en resolución completa
}  // namespace adxl

// ----------------------------- ITG3200 -------------------------------
namespace itg {
constexpr uint8_t ADDR = 0x68;
constexpr uint8_t WHO_AM_I = 0x00;    // bits[6:1] = 0x34
constexpr uint8_t SMPLRT_DIV = 0x15;
constexpr uint8_t DLPF_FS = 0x16;
constexpr uint8_t GYRO_XOUT_H = 0x1D;
constexpr uint8_t PWR_MGM = 0x3E;
constexpr float LSB_PER_DPS = 14.375f;
}  // namespace itg

// ----------------------------- HMC5883L ------------------------------
namespace hmc {
constexpr uint8_t ADDR = 0x1E;
constexpr uint8_t CRA = 0x00, CRB = 0x01, MODE = 0x02, DATA = 0x03, ID_A = 0x0A;
constexpr float LSB_PER_GAUSS = 1090.0f;  // ganancia ±1,3 Ga
}  // namespace hmc

// ----------------------------- QMC5883L ------------------------------
namespace qmc {
constexpr uint8_t ADDR = 0x0D;
constexpr uint8_t DATA = 0x00, CTRL1 = 0x09, SETRESET = 0x0B, CHIP_ID = 0x0D;
constexpr float LSB_PER_GAUSS = 3000.0f;  // rango ±8 G
}  // namespace qmc

static inline int16_t le16(const uint8_t* b) { return (int16_t)((b[1] << 8) | b[0]); }
static inline int16_t be16(const uint8_t* b) { return (int16_t)((b[0] << 8) | b[1]); }

bool GY85::begin(uint32_t sampleRateHz) {
  sampleRateHz_ = sampleRateHz;
  accelOk_ = initAccel();
  gyroOk_ = initGyro();
  initMag();
  consecutiveErrors_ = 0;
  return accelOk_ && gyroOk_;
}

bool GY85::initAccel() {
  uint8_t id = 0;
  if (!bus_.readRegs(adxl::ADDR, adxl::DEVID, &id, 1) || id != 0xE5) return false;
  // ODR >= frecuencia de muestreo. El ancho de banda del ADXL345 es ODR/2,
  // lo que actúa como filtro anti-aliasing.
  uint8_t rate = 0x0A;                         // 100 Hz
  if (sampleRateHz_ > 100) rate = 0x0B;        // 200 Hz
  if (sampleRateHz_ > 200) rate = 0x0C;        // 400 Hz
  if (sampleRateHz_ > 400) rate = 0x0D;        // 800 Hz
  return bus_.writeReg(adxl::ADDR, adxl::POWER_CTL, 0x00) &&
         bus_.writeReg(adxl::ADDR, adxl::BW_RATE, rate) &&
         bus_.writeReg(adxl::ADDR, adxl::DATA_FORMAT, 0x0B) &&  // FULL_RES, ±16 g
         bus_.writeReg(adxl::ADDR, adxl::POWER_CTL, 0x08);      // modo medición
}

bool GY85::initGyro() {
  uint8_t id = 0;
  if (!bus_.readRegs(itg::ADDR, itg::WHO_AM_I, &id, 1) || ((id >> 1) & 0x3F) != 0x34) return false;
  if (!bus_.writeReg(itg::ADDR, itg::PWR_MGM, 0x80)) return false;  // reset
  delay(5);
  // Filtro pasa-bajas interno (~0,4 x frecuencia de muestreo) y fondo de
  // escala ±2000 °/s (FS_SEL = 3, obligatorio en el ITG3200).
  uint8_t dlpf = 3;                          // 42 Hz
  if (sampleRateHz_ > 150) dlpf = 2;         // 98 Hz
  if (sampleRateHz_ > 300) dlpf = 1;         // 188 Hz
  uint32_t div = 1000 / sampleRateHz_;       // muestreo interno de 1 kHz
  if (div < 1) div = 1;
  if (div > 256) div = 256;
  return bus_.writeReg(itg::ADDR, itg::PWR_MGM, 0x01) &&             // reloj PLL eje X
         bus_.writeReg(itg::ADDR, itg::SMPLRT_DIV, (uint8_t)(div - 1)) &&
         bus_.writeReg(itg::ADDR, itg::DLPF_FS, (uint8_t)(0x18 | dlpf));
}

void GY85::initMag() {
  magType_ = MAG_NONE;
  if (bus_.probe(hmc::ADDR)) {
    bool ok = bus_.writeReg(hmc::ADDR, hmc::CRA, 0x18) &&  // 1 muestra, 75 Hz
              bus_.writeReg(hmc::ADDR, hmc::CRB, 0x20) &&  // ±1,3 Ga
              bus_.writeReg(hmc::ADDR, hmc::MODE, 0x00);   // continuo
    if (ok) magType_ = MAG_HMC5883L;
    return;
  }
  uint8_t id = 0;
  if (bus_.probe(qmc::ADDR) && bus_.readRegs(qmc::ADDR, qmc::CHIP_ID, &id, 1) && id == 0xFF) {
    bool ok = bus_.writeReg(qmc::ADDR, qmc::SETRESET, 0x01) &&
              bus_.writeReg(qmc::ADDR, qmc::CTRL1, 0x19);  // OSR512, ±8 G, 100 Hz, continuo
    if (ok) magType_ = MAG_QMC5883L;
  }
}

const char* GY85::magName() const {
  switch (magType_) {
    case MAG_HMC5883L: return "HMC5883L";
    case MAG_QMC5883L: return "QMC5883L";
    default: return "ninguno";
  }
}

bool GY85::readAccel(Vec3& a) {
  if (!accelOk_) return false;
  uint8_t b[6];
  if (!bus_.readRegs(adxl::ADDR, adxl::DATAX0, b, 6)) return false;
  a.x = le16(b + 0) * adxl::SCALE_G;
  a.y = le16(b + 2) * adxl::SCALE_G;
  a.z = le16(b + 4) * adxl::SCALE_G;
  return true;
}

bool GY85::readGyro(Vec3& g) {
  if (!gyroOk_) return false;
  uint8_t b[6];
  if (!bus_.readRegs(itg::ADDR, itg::GYRO_XOUT_H, b, 6)) return false;
  const float raw[3] = {be16(b + 0) / itg::LSB_PER_DPS,
                        be16(b + 2) / itg::LSB_PER_DPS,
                        be16(b + 4) / itg::LSB_PER_DPS};
  // Alineación con los ejes del acelerómetro (ver config.h).
  g.x = GYRO_AXIS_SIGN[0] * raw[GYRO_AXIS_MAP[0]];
  g.y = GYRO_AXIS_SIGN[1] * raw[GYRO_AXIS_MAP[1]];
  g.z = GYRO_AXIS_SIGN[2] * raw[GYRO_AXIS_MAP[2]];
  return true;
}

bool GY85::readMag(Vec3& m) {
  uint8_t b[6];
  if (magType_ == MAG_HMC5883L) {
    if (!bus_.readRegs(hmc::ADDR, hmc::DATA, b, 6)) return false;
    int16_t x = be16(b + 0), z = be16(b + 2), y = be16(b + 4);  // orden X, Z, Y
    if (x == -4096 || y == -4096 || z == -4096) return false;   // desbordamiento
    const float k = 100.0f / hmc::LSB_PER_GAUSS;                  // 1 G = 100 µT
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

void GY85::handleError() {
  errorCount_++;
  consecutiveErrors_++;
  const uint32_t now = millis();
  if (consecutiveErrors_ >= 10 && now - lastRecoverMs_ > 500) {
    lastRecoverMs_ = now;
    bus_.recover();
    begin(sampleRateHz_);
  }
}
