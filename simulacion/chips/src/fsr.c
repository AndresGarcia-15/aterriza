/* =====================================================================
 *  Chip virtual "plantillas FSR" para Wokwi
 *  Cuatro salidas analógicas = voltaje en el nodo ADC de cada divisor
 *  (3,3 V — FSR 402 — nodo — R — GND) durante el aterrizaje simulado.
 *  El divisor está modelado DENTRO del chip (Wokwi no resuelve circuitos
 *  analógicos), con la resistencia y la fracción de carga configurables
 *  en vivo desde los controles del chip.
 * ===================================================================== */
#include "wokwi-api.h"
#include <stdio.h>
#include <stdlib.h>
#include "../../modelo/landing_model.h"

typedef struct {
  pin_t out[4];
  uint32_t a_scen, a_rdiv, a_transfer, a_adcref;
  timer_config_t tcfg;
} chip_state_t;

static void update(void* ud) {
  chip_state_t* c = ud;
  double t = get_sim_nanos_d() * 1e-9;
  int scen = (int)attr_read(c->a_scen);
  if (scen < 0 || scen > 2) scen = 0;
  double r = attr_read_float(c->a_rdiv);
  double tr = attr_read_float(c->a_transfer);
  /* El ADC virtual de Wokwi usa 5 V como fondo de escala para cualquier
   * placa; el ESP32 real a 11 dB satura cerca de 3,1 V. Se reescala para
   * que el firmware lea las mismas cuentas que leería en el hardware. */
  double scale = attr_read_float(c->a_adcref) / 3.1;
  for (int ch = 0; ch < 4; ch++) {
    double v = lm_fsr_voltage(lm_fsr_force(scen, ch, t, tr), r);
    if (v > 3.1) v = 3.1;
    pin_dac_write(c->out[ch], (float)(v * scale));
  }
}

void chip_init(void) {
  chip_state_t* c = calloc(1, sizeof(chip_state_t));
  static const char* pins[4] = {"P1H", "P1F", "P2H", "P2F"};
  for (int i = 0; i < 4; i++) c->out[i] = pin_init(pins[i], ANALOG);
  c->a_scen = attr_init("scenario", 0);
  c->a_rdiv = attr_init_float("r_divider", 10000.0f);
  c->a_transfer = attr_init_float("transfer", 0.10f);
  c->a_adcref = attr_init_float("adc_ref", 5.0f);   /* fondo de escala del ADC de Wokwi */
  c->tcfg.callback = update;
  c->tcfg.user_data = c;
  timer_t tm = timer_init(&c->tcfg);
  timer_start(tm, 1000, true);  /* 1 kHz */
  update(c);
  printf("Plantillas FSR virtuales listas: R = %.0f ohm, fraccion de carga = %.2f\n",
         attr_read_float(c->a_rdiv), attr_read_float(c->a_transfer));
}
