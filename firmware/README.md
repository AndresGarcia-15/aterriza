# Firmware ESP32 — Sistema portátil de evaluación biomecánica del aterrizaje (UTB)

Firmware preliminar para **ESP32 WROOM-32D** que adquiere de forma sincronizada
**4 FSR 402** (talón y antepié de cada pie) y **3 IMU MPU6050** con magnetómetro QMC5883P
(muslo, pierna, lumbar) a **100 Hz** y envía una línea CSV por muestra por USB-C.

> **Prototipo actual (oct. 2026):** 2 IMU instaladas (muslo y pierna). La lumbar está
> comprada y pendiente: mientras no esté, sus columnas salen en 0 con su bit de error en
> `flags`, y la plataforma marca el tronco como «no disponible». Al conectarla en SDA 16 /
> SCL 17 el firmware la detecta solo (mensaje `#OK IMU L conectada`), sin reiniciar.

Estado: v0.2.0, adaptado al prototipo real (MPU6050). El driver detecta solo el modelo
de IMU en cada bus (MPU6050/6500/9250 o GY-85), así la simulación de Wokwi y el gemelo
digital siguen funcionando con el mismo código.

```
firmware/
├── BiomecanicaESP32/        ← sketch principal (abrir el .ino en Arduino IDE)
│   ├── BiomecanicaESP32.ino   descripción y setup()/loop()
│   ├── config.h               ★ TODOS los parámetros ajustables (pines, Hz, signos…)
│   ├── App.cpp                tareas FreeRTOS, calibraciones, comandos, CSV
│   ├── ImuSensor.*            driver MPU6050 (+QMC5883P/HMC5883L) o GY-85, detección automática
│   ├── FsrArray.*             lectura ADC + sobremuestreo + promedio móvil
│   ├── Orientation.*          filtro Mahony + ángulo sagital (C++ puro)
│   ├── I2CBus.* / SoftI2C.*   buses I2C hardware y software
│   └── Calibration.*          calibraciones IMU en memoria no volátil (NVS)
├── I2CScanner/              ← sketch de prueba de cableado (cargar primero)
├── PruebaMPU6050/           ← prueba legible del prototipo actual (115200 baudios)
└── tools/logger.py          ← registrador de ensayos en el PC (CSV + JSON)
```

---

## 1. Qué instalar

**Arduino IDE 2** (lo exige la documentación) y, si quieres compilar y subir desde la
terminal, **arduino-cli**:

| Sistema | Arduino IDE 2 | arduino-cli |
|---|---|---|
| macOS | `brew install --cask arduino-ide` | `brew install arduino-cli` |
| Windows | `winget install ArduinoSA.IDE.stable` | `winget install ArduinoSA.CLI` |
| Linux | AppImage de [arduino.cc/en/software](https://www.arduino.cc/en/software) | `curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh \| sh` |

Luego, en cualquier sistema, el soporte para ESP32 (core oficial de Espressif):

```bash
arduino-cli config init
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32
```

En **Arduino IDE**: *Settings → Additional boards manager URLs* → pega la misma URL;
luego *Boards Manager* → instala **esp32 by Espressif Systems (3.x)**.
Placa: **ESP32 Dev Module**. No se necesita ninguna librería externa: los drivers
están escritos a nivel de registros.

Para el logger en Python no hace falta instalar nada si ya tienes `uv`
(`uv run --with pyserial …`). Si no: `curl -LsSf https://astral.sh/uv/install.sh | sh`
en macOS/Linux o `winget install astral-sh.uv` en Windows.

**Puerto USB:** conecta el ESP32 y búscalo. El nombre cambia según el sistema:

| Sistema | Cómo verlo | Nombre típico |
|---|---|---|
| macOS | `ls /dev/cu.*` | `/dev/cu.usbserial-0001` o `/dev/cu.wchusbserial…` |
| Linux | `ls /dev/ttyUSB* /dev/ttyACM*` | `/dev/ttyUSB0` |
| Windows | Administrador de dispositivos → *Puertos (COM y LPT)* | `COM3` |

Si no aparece nada:
1. Prueba **otro cable USB-C**, porque muchos solo cargan y no transmiten datos.
2. Instala el driver del chip impreso junto al conector: CH340/CH9102 (WCH) o CP2102
   (Silicon Labs). En Windows casi siempre hace falta; en macOS y Linux suele venir incluido.
3. **Linux:** si aparece pero da «Permission denied», agrega tu usuario al grupo del puerto
   y cierra sesión: `sudo usermod -aG dialout $USER` (en Arch: `uucp`).

## 2. Compilar y subir

**Opción IDE:** abre `BiomecanicaESP32/BiomecanicaESP32.ino`, selecciona el puerto y presiona *Upload*.
Abre el *Serial Monitor* a **921600 baudios**.

**Opción terminal:**
```bash
cd firmware        # dentro del repositorio
arduino-cli compile --fqbn esp32:esp32:esp32 BiomecanicaESP32
arduino-cli upload  --fqbn esp32:esp32:esp32 -p PUERTO BiomecanicaESP32
arduino-cli monitor -p PUERTO -c baudrate=921600
```
`PUERTO` es el de la tabla anterior (`/dev/cu.usbserial-0001`, `/dev/ttyUSB0` o `COM3`).
Si aparece "Failed to connect", mantén presionado el botón **BOOT** de la placa al iniciar la carga.
Al encender, los primeros caracteres salen ilegibles: es el bootloader del ESP32, que
transmite a 115200 baudios. Es normal.

## 3. Cableado

| Señal | Pin ESP32 | Conexión |
|---|---|---|
| FSR P1-H talón izq. | GPIO 32 | 3V3 → FSR → **GPIO** → resistencia → GND (1 kΩ recomendado) |
| FSR P1-F antepié izq. | GPIO 33 | igual |
| FSR P2-H talón der. | GPIO 34 | igual (pin solo-entrada, correcto) |
| FSR P2-F antepié der. | GPIO 35 | igual |
| IMU-T muslo (IMU1) | SDA 21 / SCL 22 | I2C hardware `Wire` |
| IMU-P pierna (IMU2) | SDA 18 / SCL 19 | I2C hardware `Wire1` |
| IMU-L lumbar (pendiente) | SDA 16 / SCL 17 | I2C **por software** (pines RX2/TX2, ver hallazgo 1) |
| IMU alimentación | 3V3 y GND | al pin VCC del módulo |

Todos los pines están en ADC1 (siguen funcionando si más adelante se usa WiFi o Bluetooth)
y ninguno es pin de arranque (*strapping*). Los módulos MPU6050 traen resistencias pull-up
en SDA y SCL.

**Montaje de cada IMU (convención del código):** usa los ejes impresos en el módulo.
**X** a lo largo del segmento apuntando hacia la cabeza, **Y** medio-lateral y
**Z** saliendo de la piel. Si se monta distinto, se corrige en `config.h` con
`KNEE_SIGN` y `TRUNK_SIGN`. En el prototipo las placas están de canto con X hacia arriba
(en reposo `ax ≈ 1 g`): es justo la convención.

## 4. Puesta en marcha paso a paso (orden recomendado)

1. **Solo el ESP32 + `I2CScanner`.** Confirma que el toolchain y el cable funcionan (115200 baudios).
2. **`PruebaMPU6050`** (115200 baudios): cada IMU debe decir `OK` y su magnetómetro `0x80 OK`.
3. **Cargar el firmware principal** y enviar `i`. Cada IMU conectada dice `MPU6050 en 0x68`;
   la que falte dice `NO CONECTADA (se busca cada 3 s)`.
4. **FSR en protoboard:** envía `p` y abre el *Serial Plotter*. Presiona cada sensor;
   la curva debe subir. Presiona fuerte y revisa la saturación (lectura ≥ 4000).
5. **Test de ejes:** gira la IMU alrededor de su eje X impreso. Solo `gx` debe cambiar
   de forma notable, y lo mismo para Y y Z.
6. **Calibrar:**
   - `a`: las 3 IMU planas sobre la mesa con Z hacia arriba.
   - `g`: quietas. También se hace solo al encender.
   - `m`: opcional; rota cada IMU en forma de "8".
   Las calibraciones quedan guardadas en el ESP32 aunque se apague.
7. **Sobre el cuerpo:** pide al atleta quedarse erguido y quieto, envía `t` (tara)
   y verifica que rodilla y tronco marquen ≈ 0°. Flexiona la rodilla: debe dar positivo.
   Si da negativo, cambia `KNEE_SIGN` a `1` (el valor por defecto `-1` está verificado en la simulación).
8. **Registrar un ensayo:**
   ```bash
   cd firmware/tools
   uv run --with pyserial logger.py --participante P01 --ensayo drop1 --tara
   ```
   Al terminar, el logger reporta los Hz reales y los paquetes perdidos. Ese es el
   criterio de entrega "100 Hz sin pérdidas".

## 5. Comandos (una letra en el monitor serie)

| Tecla | Acción |
|---|---|
| `h` | ayuda |
| `i` | estado: IMU detectadas, errores I2C, Hz reales, tiempo máximo por muestra |
| `c` | calibraciones vigentes |
| `s` / `x` | iniciar / detener transmisión |
| `p` | alternar entre modo Serial Plotter y modo CSV |
| `t` | tara: postura erguida 1 s → rodilla y tronco = 0° |
| `g` | bias del giroscopio (2 s quieto) |
| `a` | offset del acelerómetro (IMU planas, Z arriba) |
| `m` | magnetómetro (20 s en "8") |
| `r` | borrar calibraciones de IMU |

## 6. Formato de datos

Las líneas que empiezan con `#` son mensajes; el resto son datos. El encabezado
llega como `#COLS,…`. Cada línea tiene 36 columnas:

`seq, t_us, P1_H, P1_F, P2_H, P2_F,` y luego por cada IMU (`T`, `P`, `L`):
`ax, ay, az [g], gx, gy, gz [°/s], mx, my, mz [µT],` y al final
`knee_flex [°], trunk_flex [°], flags`.

- **FSR:** cuentas crudas del ADC (0–4095) con promedio móvil de 3 muestras. La conversión
  a fuerza (N) se hace en el PC con la curva de calibración individual de cada sensor,
  como pide la documentación.
- **`seq`** sube de 1 en 1. Si falta un número, se perdió una muestra.
- **`flags`** (bits): 0–3 FSR saturado · 4–6 error de lectura de la IMU T/P/L (se repite el último valor) ·
  7 solo giroscopio (impacto) · 8 se perdió un periodo · 9 calibrando · 10 sin tara.

## 7. Hallazgos técnicos para el equipo (importante)

1. **El ESP32 solo tiene 2 controladores I2C por hardware.** Cada IMU va en su propio bus porque
   su magnetómetro (modo bypass) tiene la misma dirección en todas las placas. La lumbar usa I2C
   por software en GPIO 16/17,
   tal como sugiere la documentación ("I2C Soft/Wire2"). Si da problemas, la alternativa
   robusta es un multiplexor **TCA9548A** (~$15.000 COP) con las 3 IMU en un solo bus.
2. **115200 baudios no alcanzan para el paquete completo.** Una línea ocupa ~230 bytes; a 100 Hz
   son ~23 kB/s y 115200 baudios solo dan ~11,5 kB/s. Por eso se usa **921600**.
3. **Riesgo principal: saturación del FSR 402.** Su rango útil nominal es de unos pocos newtons
   a ~20 N. En un aterrizaje, el talón o el antepié pueden recibir cientos o miles de newtons.
   El firmware marca la saturación, pero hay que actuar sobre el hardware:
   - Probar con una resistencia menor (3,3 kΩ o 1 kΩ) para ampliar el rango.
   - Revisar el diseño del disco distribuidor (*puck*).
   - Calibrar dentro de la plantilla.

   La Documentación Maestra corregida dice que el sensor **aún no está decidido**. Este
   resultado es un insumo clave para esa decisión. Mientras no se valide contra una
   plataforma de fuerza, se reporta como "carga instrumentada estimada".
4. **100 Hz y el promedio móvil subestiman el pico de impacto.** El pico ocurre a unas
   decenas de ms del contacto, y las plataformas de fuerza muestrean a ≥ 1000 Hz.
   `SAMPLE_RATE_HZ` y `FSR_MOVING_AVG` (1 = sin suavizado) son configurables.
   Recomiendo probar 200 Hz y revisar el tiempo máximo por muestra con `i`.
5. **No usar alambre rígido sobre el cuerpo**, porque se rompe con el movimiento. Usa cable
   flexible multifilar y trenza SDA con GND y SCL con GND. Con cables de ~1 m, si aparecen
   errores I2C, baja `I2C_HW_FREQ` a 100000.
6. **Ángulos en el ESP32.** Rodilla y tronco se calculan en el plano sagital (fusión
   acelerómetro + giroscopio, robusta durante el impacto). El valgo dinámico necesita
   procesamiento 3D en el PC, que se puede hacer porque se envían todos los datos crudos.
   El magnetómetro se transmite, pero no se usa en la fusión, porque en interiores está distorsionado.
7. **Seguridad eléctrica:** durante pruebas con personas, el portátil debe estar con batería,
   **desconectado del tomacorriente**.
8. **ADC del ESP32:** no es lineal por encima de ~3,1 V. La curva individual raw → fuerza
   absorbe esa no linealidad, pero conviene trabajar por debajo de esa zona.

## 7b. Simulación

La carpeta `../simulacion/` permite probar todo este firmware sin hardware (Wokwi + gemelo digital).
Su resultado clave: con 10 kΩ el FSR se satura; **1 kΩ a 200 Hz sin promedio** captura el pico de carga con error < 3 %.

## 8. Materiales adicionales sugeridos

- Cable USB-C **de datos**.
- Cable flexible multifilar (p. ej. UTP o cinta plana) y termoencogible.
- Correas con velcro para fijar las IMU.
- Resistencias de 1 kΩ y 3,3 kΩ para probar rango.
- Pesas conocidas para la calibración.
- Multímetro.
- Opcional: TCA9548A.

## 9. Decisiones que siguen abiertas (del documento, no del código)

- Sensor de carga definitivo y su circuito.
- Frecuencia final.
- Filtros y umbrales.
- Interfaz definitiva (USB, BLE o WiFi).
- Software del PC (calibración, eventos, variables).

El firmware está preparado para cambiar estos puntos editando solo `config.h`.
