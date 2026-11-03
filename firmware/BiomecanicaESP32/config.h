// =====================================================================
//  config.h — Parámetros del sistema de evaluación biomecánica
//  Todo lo que se ajusta durante pruebas está aquí. No hay "números
//  mágicos" en el resto del código.
// =====================================================================
#pragma once
#include <stdint.h>

#define FW_VERSION "0.2.0"

// ---------------------------------------------------------------------
//  Muestreo
// ---------------------------------------------------------------------
// Documento: 100 Hz (10 ms). Se deja configurable porque la frecuencia
// definitiva está abierta (Doc. Maestra, sección 24).
// (CFG_SAMPLE_RATE_HZ permite cambiarlo desde la compilación, p. ej. en el gemelo digital)
#ifndef CFG_SAMPLE_RATE_HZ
#define CFG_SAMPLE_RATE_HZ 100
#endif
constexpr uint32_t SAMPLE_RATE_HZ = CFG_SAMPLE_RATE_HZ;
constexpr uint32_t SAMPLE_PERIOD_US = 1000000UL / SAMPLE_RATE_HZ;

// ---------------------------------------------------------------------
//  Comunicación serial (USB-C)
// ---------------------------------------------------------------------
// Cada línea CSV completa ocupa ~230 bytes. A 100 Hz son ~23 kB/s, que
// NO caben en 115200 baudios (~11,5 kB/s). Con 921600 hay margen de 4x.
constexpr uint32_t SERIAL_BAUD = 921600;
constexpr uint32_t SERIAL_TX_BUFFER = 8192;

// ---------------------------------------------------------------------
//  Sensores de carga FSR 402 (entradas ADC1, compatibles con WiFi/BLE)
// ---------------------------------------------------------------------
constexpr uint8_t NUM_FSR = 4;
constexpr uint8_t PIN_FSR[NUM_FSR] = {
  32,  // P1-H  Talón izquierdo     (ADC1_CH4)
  33,  // P1-F  Antepié izquierdo   (ADC1_CH5)
  34,  // P2-H  Talón derecho       (ADC1_CH6, solo entrada)
  35   // P2-F  Antepié derecho     (ADC1_CH7, solo entrada)
};
constexpr const char* FSR_NAMES[NUM_FSR] = {"P1_H", "P1_F", "P2_H", "P2_F"};

// Lecturas rápidas promediadas DENTRO de cada periodo (reduce ruido del
// ADC del ESP32 sin retrasar la señal en el tiempo).
constexpr uint8_t FSR_OVERSAMPLE = 4;
// Promedio móvil temporal exigido en el documento (criterio de validación:
// "promedio móvil de 3 muestras"). Poner 1 para enviar la señal sin
// suavizado temporal (recomendado si se quiere el pico de impacto real).
#ifndef CFG_FSR_MOVING_AVG
#define CFG_FSR_MOVING_AVG 3
#endif
constexpr uint8_t FSR_MOVING_AVG = CFG_FSR_MOVING_AVG;
// Lectura ADC a partir de la cual se considera saturado el canal.
constexpr uint16_t FSR_SATURATION_RAW = 4000;

// ---------------------------------------------------------------------
//  IMU (prototipo actual: MPU6050 + magnetómetro QMC5883P)
// ---------------------------------------------------------------------
// El driver (ImuSensor) detecta solo el modelo en cada bus: MPU6050 y
// clones (0x68/0x69) o GY-85 (lo usan la simulación de Wokwi y el gemelo).
// Cada IMU va en su propio bus: así su magnetómetro (modo bypass, misma
// dirección en todas las placas) no choca con el de las otras.
// El ESP32 solo tiene 2 controladores I2C por hardware: la tercera IMU
// usa un bus I2C por software (bit-banging) implementado en SoftI2C.
constexpr uint8_t NUM_IMU = 3;
enum ImuId : uint8_t { IMU_THIGH = 0, IMU_SHANK = 1, IMU_LUMBAR = 2 };
constexpr const char* IMU_NAMES[NUM_IMU] = {"T", "P", "L"};  // Muslo, Pierna, Lumbar

struct I2CPins { uint8_t sda; uint8_t scl; };
constexpr I2CPins IMU_PINS[NUM_IMU] = {
  {21, 22},  // IMU-T Muslo  -> Wire  (I2C hardware 0)   = IMU1 del prototipo
  {18, 19},  // IMU-P Pierna -> Wire1 (I2C hardware 1)   = IMU2 del prototipo
  {16, 17}   // IMU-L Lumbar -> SoftI2C (pines RX2/TX2)  = pendiente de instalar
};
// Si una IMU no está conectada, sus columnas salen en 0, se marca su bit
// de error en flags y se vuelve a buscar cada IMU_RETRY_MS: al conectarla
// aparece sola (mensaje "#OK IMU L conectada"), sin reiniciar la placa.
constexpr uint32_t IMU_RETRY_MS = 3000;

// 400 kHz según documento. Con cables largos (>50 cm) sobre el cuerpo
// bajar a 100000 si aparecen errores I2C (flags / comando 'i').
constexpr uint32_t I2C_HW_FREQ = 400000;
constexpr uint16_t I2C_TIMEOUT_MS = 2;
// Medio periodo del I2C por software en microsegundos (2 us ≈ 150-200 kHz).
constexpr uint8_t SOFT_I2C_HALF_PERIOD_US = 2;

// El magnetómetro (máx. 75 Hz en HMC5883L) no se usa en la fusión por
// defecto; se lee cada N muestras para ahorrar tiempo de bus.
constexpr uint8_t MAG_READ_DIVIDER = 2;

// ---------------------------------------------------------------------
//  Montaje de las IMU sobre el cuerpo (convención del proyecto)
// ---------------------------------------------------------------------
// Ejes según la serigrafía de la placa (flechas X/Y impresas):
//   X -> a lo largo del segmento, apuntando hacia ARRIBA (cabeza)
//   Y -> medio-lateral (perpendicular al plano sagital)
//   Z -> perpendicular a la piel, apuntando hacia AFUERA del cuerpo
// Con esa convención la inclinación sagital de cada segmento es la
// rotación alrededor de Y. Si el montaje real difiere, se corrige aquí
// con el signo, sin tocar el resto del código.
// Con IMU en la cara anterior de muslo y pierna, al flexionar la rodilla
// la pierna gira en un sentido y el muslo en el contrario: la diferencia
// sale negativa, por eso el signo por defecto es -1 (verificado en el
// gemelo digital, carpeta simulacion/).
constexpr float KNEE_SIGN = -1.0f;  // +: flexión de rodilla positiva
constexpr float TRUNK_SIGN = 1.0f;  // +: flexión de tronco positiva

// Solo GY-85: remapeo de ejes del ITG3200 respecto al ADXL345 (en el
// MPU6050 ambos están en el mismo chip y ya coinciden). Índice y signo.
// Verificar con el "test de ejes" del README antes de confiar en ángulos.
constexpr uint8_t GYRO_AXIS_MAP[3] = {0, 1, 2};
constexpr int8_t GYRO_AXIS_SIGN[3] = {1, 1, 1};

// ---------------------------------------------------------------------
//  Fusión de orientación (filtro Mahony, acelerómetro + giroscopio)
// ---------------------------------------------------------------------
constexpr float MAHONY_KP = 1.0f;
constexpr float MAHONY_KI = 0.0f;
// Durante el impacto el acelerómetro no mide gravedad: si |a| se aleja
// de 1 g más que este margen, se ignora y se integra solo el giroscopio.
constexpr float ACCEL_GATE_G = 0.15f;

// ---------------------------------------------------------------------
//  Calibraciones
// ---------------------------------------------------------------------
constexpr uint16_t GYRO_CAL_SAMPLES = 200;     // 2 s a 100 Hz (doc: >=100)
constexpr float GYRO_CAL_MAX_STD_DPS = 1.5f;   // si hay más ruido, hubo movimiento
constexpr uint16_t ACCEL_CAL_SAMPLES = 200;
constexpr uint16_t TARE_SAMPLES = SAMPLE_RATE_HZ;  // 1 s de postura erguida
constexpr uint32_t MAG_CAL_SECONDS = 20;       // rotación en "8"

// Cada cuántos segundos imprimir una línea "#STAT" con tiempos por etapa
// (0 = nunca; el comando 'i' siempre la muestra).
#ifndef CFG_AUTO_STATS_S
#define CFG_AUTO_STATS_S 0
#endif
constexpr uint32_t AUTO_STATS_S = CFG_AUTO_STATS_S;

// Transmitir CSV desde el arranque (1) o esperar el comando 's' (0).
#ifndef CFG_STREAM_AT_BOOT
#define CFG_STREAM_AT_BOOT 1
#endif
constexpr bool STREAM_AT_BOOT = CFG_STREAM_AT_BOOT;

// Tamaño de la cola entre la tarea de muestreo y la de transmisión.
constexpr uint16_t SAMPLE_QUEUE_LEN = 64;
