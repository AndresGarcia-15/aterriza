// =====================================================================
//  I2CBus.h — Interfaz común para buses I2C (hardware y software)
//  Los drivers de los sensores solo conocen esta interfaz, así da igual
//  si la IMU está en Wire, Wire1 o en el bus por software.
// =====================================================================
#pragma once
#include <Arduino.h>
#include <Wire.h>

class I2CBus {
 public:
  virtual ~I2CBus() {}
  virtual bool begin() = 0;
  virtual bool probe(uint8_t addr) = 0;
  virtual bool writeReg(uint8_t addr, uint8_t reg, uint8_t value) = 0;
  virtual bool readRegs(uint8_t addr, uint8_t reg, uint8_t* buf, uint8_t len) = 0;
  // Libera el bus si un esclavo quedó reteniendo SDA (p. ej. un cable
  // que se soltó durante un salto) y lo reinicializa.
  virtual void recover() = 0;
  virtual const char* name() const = 0;
};

// Genera hasta 9 pulsos de reloj y una condición STOP para liberar SDA.
void i2cBusClear(uint8_t sdaPin, uint8_t sclPin);

// ---------------------------------------------------------------------
//  Bus I2C por hardware (Wire / Wire1)
// ---------------------------------------------------------------------
class HardwareI2CBus : public I2CBus {
 public:
  HardwareI2CBus(TwoWire& wire, uint8_t sda, uint8_t scl, uint32_t freq,
                 uint16_t timeoutMs, const char* label)
      : wire_(wire), sda_(sda), scl_(scl), freq_(freq),
        timeoutMs_(timeoutMs), label_(label) {}

  bool begin() override;
  bool probe(uint8_t addr) override;
  bool writeReg(uint8_t addr, uint8_t reg, uint8_t value) override;
  bool readRegs(uint8_t addr, uint8_t reg, uint8_t* buf, uint8_t len) override;
  void recover() override;
  const char* name() const override { return label_; }

 private:
  TwoWire& wire_;
  uint8_t sda_, scl_;
  uint32_t freq_;
  uint16_t timeoutMs_;
  const char* label_;
};
