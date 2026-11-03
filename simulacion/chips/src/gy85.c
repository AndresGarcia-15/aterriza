/* =====================================================================
 *  Chip virtual GY-85 para Wokwi (ADXL345 + ITG3200 + HMC5883L)
 *  Responde por I2C exactamente como el módulo real y entrega los datos
 *  del aterrizaje simulado (modelo/landing_model.h).
 *  Atributos (diagram.json): segment 0=muslo 1=pierna 2=lumbar,
 *                            scenario 0=controlado 1=rígido 2=asimétrico
 * ===================================================================== */
#include "wokwi-api.h"
#include <stdio.h>
#include <stdlib.h>
#include "../../modelo/gy85_device.h"

typedef struct {
  gy85_dev dev;
  i2c_config_t i2c;
} chip_state_t;

static double now_s(void) { return get_sim_nanos_d() * 1e-9; }

static bool on_connect(void* ud, uint32_t address, bool read) {
  return gy85_dev_connect(&((chip_state_t*)ud)->dev, address, read, now_s());
}
static uint8_t on_read(void* ud) { return gy85_dev_read(&((chip_state_t*)ud)->dev); }
static bool on_write(void* ud, uint8_t data) { return gy85_dev_write(&((chip_state_t*)ud)->dev, data); }
static void on_disconnect(void* ud) { gy85_dev_disconnect(&((chip_state_t*)ud)->dev); }

void chip_init(void) {
  chip_state_t* chip = calloc(1, sizeof(chip_state_t));
  uint32_t seg = attr_read(attr_init("segment", 0));
  uint32_t scen = attr_read(attr_init("scenario", 0));
  if (seg > 2) seg = 0;
  if (scen > 2) scen = 0;
  gy85_dev_init(&chip->dev, (int)seg, (int)scen, 0x1234567u + seg * 7919u);

  chip->i2c.address = 0;  /* recibir todas las direcciones; filtramos 0x53/0x68/0x1E */
  chip->i2c.scl = pin_init("SCL", INPUT_PULLUP);
  chip->i2c.sda = pin_init("SDA", INPUT_PULLUP);
  chip->i2c.connect = on_connect;
  chip->i2c.read = on_read;
  chip->i2c.write = on_write;
  chip->i2c.disconnect = on_disconnect;
  chip->i2c.user_data = chip;
  i2c_init(&chip->i2c);

  static const char* names[3] = {"muslo", "pierna", "lumbar"};
  printf("GY-85 virtual listo: %s, escenario %s\n", names[seg], LM_SCENARIOS[scen].name);
}
