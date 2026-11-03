#include "SoftI2C.h"

bool SoftI2CBus::begin() {
  i2cBusClear((uint8_t)sda_, (uint8_t)scl_);  // deja ambos pines en open-drain
  sdaRelease();
  gpio_set_level(scl_, 1);
  return sdaRead() && gpio_get_level(scl_);
}

bool SoftI2CBus::sclRelease() const {
  gpio_set_level(scl_, 1);
  uint32_t t0 = micros();
  while (!gpio_get_level(scl_)) {
    if (micros() - t0 > 500) return false;  // esclavo colgado o sin pull-up
  }
  return true;
}

// Precondición: bus libre (SDA y SCL en alto).
bool SoftI2CBus::start() {
  sdaRelease();
  if (!sclRelease()) return false;
  wait();
  if (!sdaRead()) return false;  // alguien retiene SDA
  sdaLow();
  wait();
  sclLow();
  wait();
  return true;
}

// Precondición: SCL en bajo (después de un byte).
bool SoftI2CBus::repeatedStart() {
  sdaRelease();
  wait();
  if (!sclRelease()) return false;
  wait();
  sdaLow();
  wait();
  sclLow();
  wait();
  return true;
}

// Precondición: SCL en bajo.
void SoftI2CBus::stop() {
  sdaLow();
  wait();
  sclRelease();
  wait();
  sdaRelease();
  wait();
}

bool SoftI2CBus::writeByte(uint8_t b) {
  for (int8_t i = 7; i >= 0; i--) {
    if (b & (1 << i)) sdaRelease(); else sdaLow();  // SDA cambia con SCL en bajo
    wait();
    if (!sclRelease()) return false;
    wait();
    sclLow();
  }
  sdaRelease();  // el esclavo pone el ACK
  wait();
  if (!sclRelease()) return false;
  wait();
  bool ack = !sdaRead();
  sclLow();
  wait();
  return ack;
}

uint8_t SoftI2CBus::readByte(bool ack) {
  uint8_t b = 0;
  sdaRelease();
  for (int8_t i = 7; i >= 0; i--) {
    wait();
    sclRelease();
    wait();
    if (sdaRead()) b |= (1 << i);
    sclLow();
  }
  if (ack) sdaLow(); else sdaRelease();  // ACK = seguir leyendo, NACK = último byte
  wait();
  sclRelease();
  wait();
  sclLow();
  sdaRelease();
  wait();
  return b;
}

bool SoftI2CBus::probe(uint8_t addr) {
  if (!start()) return false;
  bool ack = writeByte(addr << 1);
  stop();
  return ack;
}

bool SoftI2CBus::writeReg(uint8_t addr, uint8_t reg, uint8_t value) {
  if (!start()) return false;
  bool ok = writeByte(addr << 1) && writeByte(reg) && writeByte(value);
  stop();
  return ok;
}

bool SoftI2CBus::readRegs(uint8_t addr, uint8_t reg, uint8_t* buf, uint8_t len) {
  if (len == 0) return true;
  if (!start()) return false;
  bool ok = writeByte(addr << 1) && writeByte(reg) &&
            repeatedStart() && writeByte((addr << 1) | 1);
  if (ok) {
    for (uint8_t i = 0; i < len; i++) buf[i] = readByte(i < len - 1);
  }
  stop();
  return ok;
}

void SoftI2CBus::recover() {
  begin();
}
