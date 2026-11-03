#include <Wire.h>

// ===================== CONFIGURACIÓN =====================
#define MAG_ADDR 0x2C   // QMC5883P detrás del MPU6050

const int fsrPins[] = {32, 33, 34, 35};
const int NFSR = sizeof(fsrPins) / sizeof(fsrPins[0]);

struct Imu {
  TwoWire *bus;
  uint8_t addr;
  const char *name;
  float ax, ay, az;   // g
  float gx, gy, gz;   // °/s
  float mx, my, mz;   // gauss
  bool magOk;
};

// Cada IMU en su propio bus I2C
Imu imus[] = {
  {&Wire,  0x68, "IMU1"},   // SDA 21 / SCL 22
  {&Wire1, 0x68, "IMU2"},   // SDA 18 / SCL 19
};
const int NIMU = sizeof(imus) / sizeof(imus[0]);

// ===================== I2C =====================
void writeReg(TwoWire *w, uint8_t dev, uint8_t reg, uint8_t val) {
  w->beginTransmission(dev);
  w->write(reg);
  w->write(val);
  w->endTransmission();
}

bool readRegs(TwoWire *w, uint8_t dev, uint8_t reg, uint8_t *buf, uint8_t n) {
  w->beginTransmission(dev);
  w->write(reg);
  if (w->endTransmission(false) != 0) return false;
  if (w->requestFrom((int)dev, (int)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = w->read();
  return true;
}

// ===================== IMU =====================
void bypass(Imu &m, bool on) {
  writeReg(m.bus, m.addr, 0x37, on ? 0x02 : 0x00);  // INT_PIN_CFG
}

bool initIMU(Imu &m) {
  uint8_t id;
  if (!readRegs(m.bus, m.addr, 0x75, &id, 1) || id != 0x68) return false;
  writeReg(m.bus, m.addr, 0x6B, 0x01);  // Despertar, reloj PLL gyro X
  delay(10);
  writeReg(m.bus, m.addr, 0x1A, 0x03);  // Filtro DLPF ~44 Hz
  writeReg(m.bus, m.addr, 0x1B, 0x08);  // Gyro ±500 °/s  -> 65.5 LSB/(°/s)
  writeReg(m.bus, m.addr, 0x1C, 0x08);  // Accel ±4 g     -> 8192 LSB/g
  writeReg(m.bus, m.addr, 0x6A, 0x00);  // I2C master off
  bypass(m, false);
  return true;
}

void initMag(Imu &m) {
  bypass(m, true);
  uint8_t id = 0;
  m.magOk = readRegs(m.bus, MAG_ADDR, 0x00, &id, 1) && id == 0x80;
  if (m.magOk) {
    writeReg(m.bus, MAG_ADDR, 0x29, 0x06);  // Signo de ejes
    writeReg(m.bus, MAG_ADDR, 0x0B, 0x08);  // Set/reset on, ±8 G -> 3750 LSB/G
    writeReg(m.bus, MAG_ADDR, 0x0A, 0xCD);  // Modo normal, 200 Hz
  }
  bypass(m, false);
  Serial.printf("%s mag ID: 0x%02X %s\n", m.name, id, m.magOk ? "OK" : "FALLO");
}

void readIMU(Imu &m) {
  uint8_t b[14];
  if (readRegs(m.bus, m.addr, 0x3B, b, 14)) {
    m.ax = (int16_t)(b[0] << 8 | b[1]) / 8192.0;
    m.ay = (int16_t)(b[2] << 8 | b[3]) / 8192.0;
    m.az = (int16_t)(b[4] << 8 | b[5]) / 8192.0;
    m.gx = (int16_t)(b[8] << 8 | b[9]) / 65.5;
    m.gy = (int16_t)(b[10] << 8 | b[11]) / 65.5;
    m.gz = (int16_t)(b[12] << 8 | b[13]) / 65.5;
  }
  if (m.magOk) {
    bypass(m, true);
    if (readRegs(m.bus, MAG_ADDR, 0x01, b, 6)) {  // Little endian
      m.mx = (int16_t)(b[1] << 8 | b[0]) / 3750.0;
      m.my = (int16_t)(b[3] << 8 | b[2]) / 3750.0;
      m.mz = (int16_t)(b[5] << 8 | b[4]) / 3750.0;
    }
    bypass(m, false);
  }
}

// ===================== SETUP =====================
void setup() {
  Serial.begin(115200);

  // ADC para los FSR
  analogReadResolution(12);        // 0 - 4095
  analogSetAttenuation(ADC_11db);  // Rango hasta ~3.3 V

  // I2C para los IMU
  Wire.begin(21, 22, 400000);    // IMU1: SDA 21, SCL 22
  Wire1.begin(18, 19, 400000);   // IMU2: SDA 18, SCL 19
  delay(100);

  for (int i = 0; i < NIMU; i++) {
    bool ok = initIMU(imus[i]);
    Serial.printf("%s (0x%02X): %s\n", imus[i].name, imus[i].addr, ok ? "OK" : "NO ENCONTRADO");
  }
  for (int i = 0; i < NIMU; i++) initMag(imus[i]);
}

// ===================== LOOP =====================
void loop() {
  // IMUs
  for (int i = 0; i < NIMU; i++) {
    Imu &m = imus[i];
    readIMU(m);
    Serial.printf("%-6s A[g]: %6.2f %6.2f %6.2f | G[dps]: %7.1f %7.1f %7.1f | M[G]: %6.2f %6.2f %6.2f\n",
                  m.name, m.ax, m.ay, m.az, m.gx, m.gy, m.gz, m.mx, m.my, m.mz);
  }

  // FSRs
  for (int i = 0; i < NFSR; i++) {
    int raw = analogRead(fsrPins[i]);
    int mv  = analogReadMilliVolts(fsrPins[i]);
    Serial.printf("FSR%d (GPIO%d): %4d  %4d mV   ", i + 1, fsrPins[i], raw, mv);
  }
  Serial.println();
  Serial.println("--------------------------------------------------");

  delay(2500);
}