#include "I2CBus.h"
#include "driver/gpio.h"

void i2cBusClear(uint8_t sdaPin, uint8_t sclPin) {
  const gpio_num_t sda = (gpio_num_t)sdaPin;
  const gpio_num_t scl = (gpio_num_t)sclPin;
  gpio_reset_pin(sda);
  gpio_reset_pin(scl);
  gpio_set_direction(sda, GPIO_MODE_INPUT_OUTPUT_OD);
  gpio_set_direction(scl, GPIO_MODE_INPUT_OUTPUT_OD);
  gpio_pullup_en(sda);
  gpio_pullup_en(scl);
  gpio_set_level(sda, 1);
  gpio_set_level(scl, 1);
  delayMicroseconds(10);

  // Mientras un esclavo retenga SDA en bajo, se le da reloj para que
  // termine de enviar el byte pendiente.
  for (int i = 0; i < 9 && gpio_get_level(sda) == 0; i++) {
    gpio_set_level(scl, 0);
    delayMicroseconds(5);
    gpio_set_level(scl, 1);
    delayMicroseconds(5);
  }
  // Condición STOP: SDA sube mientras SCL está en alto.
  gpio_set_level(sda, 0);
  delayMicroseconds(5);
  gpio_set_level(scl, 1);
  delayMicroseconds(5);
  gpio_set_level(sda, 1);
  delayMicroseconds(5);
}

bool HardwareI2CBus::begin() {
  bool ok = wire_.begin(sda_, scl_, freq_);
  wire_.setTimeOut(timeoutMs_);
  return ok;
}

bool HardwareI2CBus::probe(uint8_t addr) {
  wire_.beginTransmission(addr);
  return wire_.endTransmission() == 0;
}

bool HardwareI2CBus::writeReg(uint8_t addr, uint8_t reg, uint8_t value) {
  wire_.beginTransmission(addr);
  wire_.write(reg);
  wire_.write(value);
  return wire_.endTransmission() == 0;
}

bool HardwareI2CBus::readRegs(uint8_t addr, uint8_t reg, uint8_t* buf, uint8_t len) {
  wire_.beginTransmission(addr);
  wire_.write(reg);
  if (wire_.endTransmission(false) != 0) return false;  // repeated start
  size_t got = wire_.requestFrom((uint16_t)addr, (size_t)len, true);
  if (got != len) {
    while (wire_.available()) wire_.read();
    return false;
  }
  for (uint8_t i = 0; i < len; i++) buf[i] = (uint8_t)wire_.read();
  return true;
}

void HardwareI2CBus::recover() {
  wire_.end();
  i2cBusClear(sda_, scl_);
  begin();
}
