// =====================================================================
//  I2CScanner — Prueba de cableado de las 3 IMU GY-85 (primer paso)
//  Cargue este sketch ANTES del firmware principal. Para cada bus debe
//  aparecer: 0x53 (ADXL345), 0x68 (ITG3200) y 0x1E (HMC5883L) o
//  0x0D (QMC5883L, clon frecuente). Monitor serie a 115200 baudios.
// =====================================================================
#include <Wire.h>

struct Bus { const char* name; uint8_t sda, scl; };
const Bus BUSES[] = {
  {"IMU-T Muslo  (SDA 21 / SCL 22)", 21, 22},
  {"IMU-P Pierna (SDA 16 / SCL 17)", 16, 17},
  {"IMU-L Lumbar (SDA 18 / SCL 19)", 18, 19},
};

const char* chipName(uint8_t addr) {
  switch (addr) {
    case 0x53: return "ADXL345 acelerometro";
    case 0x68: return "ITG3200 giroscopio";
    case 0x1E: return "HMC5883L magnetometro";
    case 0x0D: return "QMC5883L magnetometro (clon)";
    default:   return "desconocido";
  }
}

uint8_t readReg(uint8_t addr, uint8_t reg) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return 0;
  if (Wire.requestFrom((uint16_t)addr, (size_t)1, true) != 1) return 0;
  return Wire.read();
}

void scanBus(const Bus& b) {
  // Se usa el mismo controlador para los tres buses, cambiando los pines.
  Wire.end();
  Wire.begin(b.sda, b.scl, 100000);
  Serial.printf("\n%s\n", b.name);
  int found = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.printf("   0x%02X  %s\n", a, chipName(a));
      found++;
    }
  }
  if (found == 0) {
    Serial.println("   (nada) -> revisar VCC/GND, SDA/SCL invertidos, soldaduras");
    return;
  }
  // Verificación de identidad de los chips
  if (readReg(0x53, 0x00) == 0xE5) Serial.println("   ADXL345 DEVID = 0xE5  OK");
  uint8_t who = readReg(0x68, 0x00);
  if (((who >> 1) & 0x3F) == 0x34) Serial.printf("   ITG3200 WHO_AM_I = 0x%02X  OK\n", who);
  if (readReg(0x1E, 0x0A) == 'H') Serial.println("   HMC5883L ID = 'H43'  OK");
  if (readReg(0x0D, 0x0D) == 0xFF) Serial.println("   QMC5883L CHIP_ID = 0xFF  OK");
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Escaner I2C - Sistema Biomecanico ===");
}

void loop() {
  for (const Bus& b : BUSES) scanBus(b);
  Serial.println("\n(repite en 5 s)");
  delay(5000);
}
