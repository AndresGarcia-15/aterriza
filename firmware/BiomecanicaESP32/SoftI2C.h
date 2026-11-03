// =====================================================================
//  SoftI2C.h — Maestro I2C por software (bit-banging) para el ESP32
//  El ESP32 solo tiene dos controladores I2C por hardware; la tercera
//  IMU (lumbar) usa este bus. Pines en modo open-drain: el "1" lógico lo
//  ponen las resistencias pull-up de la placa GY-85.
// =====================================================================
#pragma once
#include "I2CBus.h"
#include "driver/gpio.h"

class SoftI2CBus : public I2CBus {
 public:
  SoftI2CBus(uint8_t sda, uint8_t scl, uint8_t halfPeriodUs, const char* label)
      : sda_((gpio_num_t)sda), scl_((gpio_num_t)scl), hp_(halfPeriodUs), label_(label) {}

  bool begin() override;
  bool probe(uint8_t addr) override;
  bool writeReg(uint8_t addr, uint8_t reg, uint8_t value) override;
  bool readRegs(uint8_t addr, uint8_t reg, uint8_t* buf, uint8_t len) override;
  void recover() override;
  const char* name() const override { return label_; }

 private:
  gpio_num_t sda_, scl_;
  uint8_t hp_;
  const char* label_;

  inline void wait() const { delayMicroseconds(hp_); }
  inline void sdaLow() const { gpio_set_level(sda_, 0); }
  inline void sdaRelease() const { gpio_set_level(sda_, 1); }
  inline bool sdaRead() const { return gpio_get_level(sda_) != 0; }
  inline void sclLow() const { gpio_set_level(scl_, 0); }
  bool sclRelease() const;  // espera "clock stretching" con timeout

  bool start();
  bool repeatedStart();
  void stop();
  bool writeByte(uint8_t b);   // devuelve true si hubo ACK
  uint8_t readByte(bool ack);
};
