// =====================================================================
//  SISTEMA PORTÁTIL DE EVALUACIÓN BIOMECÁNICA DEL ATERRIZAJE — UTB
//  Firmware ESP32 WROOM-32D (Arduino IDE, core esp32 3.x)
//
//  Adquiere de forma sincronizada (timestamp común):
//    - 4 sensores de carga FSR 402 (talón y antepié de cada pie)
//    - 3 IMU MPU6050 (+ magnetómetro QMC5883P): muslo, pierna y lumbar.
//      Prototipo actual: muslo (SDA21/SCL22) y pierna (SDA18/SCL19); la
//      lumbar (SDA16/SCL17) se detecta sola cuando se conecte.
//      El driver también reconoce el GY-85 (simulación de Wokwi / gemelo).
//  y transmite una línea CSV por muestra a 100 Hz por USB/Serial.
//
//  Arquitectura (FreeRTOS):
//    esp_timer (100 Hz) ──notifica──► tarea MUESTREO (núcleo 1, alta prioridad)
//        lee sensores, fusiona orientación, calibra ─► cola ─► tarea TRANSMISIÓN
//    tarea TRANSMISIÓN (núcleo 0): única dueña del puerto Serial
//    loop(): comandos del usuario y guardado de calibraciones en NVS
//
//  Comandos (una letra por el monitor serie, 921600 baudios):
//    h ayuda · i estado · c calibraciones · s iniciar · x detener
//    p modo Serial Plotter · t tara (postura de referencia, 1 s quieto)
//    g giroscopio (2 s quieto) · a acelerómetro (IMU planas, Z arriba)
//    m magnetómetro (20 s rotando en "8") · r borrar calibraciones IMU
// =====================================================================
// La lógica vive en App.cpp (el IDE de Arduino genera prototipos
// automáticos en los .ino que rompen los tipos propios; en .cpp no).
#include "App.h"

void setup() { appSetup(); }
void loop() { appLoop(); }
