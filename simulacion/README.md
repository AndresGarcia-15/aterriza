# Simulación 100 % digital — Sistema biomecánico del aterrizaje

Prueba el **firmware real del ESP32** sin componentes físicos. Sensores
virtuales reproducen un aterrizaje simulado y la comparación muestra qué
tan bien el sistema mide la "verdad" simulada.

```
modelo/landing_model.h   aterrizaje sintético (70 kg, caída de 40 cm, 3 escenarios)
modelo/gy85_device.h     GY-85 virtual a nivel de registros (ADXL345, ITG3200, HMC5883L)
chips/                   chips virtuales para Wokwi (ya compilados en chips/dist)
diagram.json, wokwi.toml circuito en Wokwi con el pinout del documento
build/                   firmware compilado (ya listo; se regenera con build_firmware.sh)
gemelo/                  gemelo digital en el PC + barrido de 108 configuraciones
```

## 1. Simular el ESP32 en Wokwi (VS Code)

1. En VS Code abre **esta carpeta** (`simulacion/`) con *File → Open Folder*.
2. Abre `diagram.json` y pulsa **▶ Play** en el panel de Wokwi.
   También funciona `Cmd+Shift+P` → **Wokwi: Start Simulator**.
3. En el monitor serie verás el arranque, la calibración del giroscopio y luego las líneas CSV.
   Puedes escribir comandos ahí mismo: `i`, `t`, `p`, etc. (están en el README del firmware).

**Cronología simulada** (se repite cada 10 s):

| Tiempo de simulación | Qué pasa |
|---|---|
| 0–8 s | De pie sobre el cajón. Calibración del giroscopio y momento de la **tara** (`t`) |
| 7,7 s | Se deja caer (~0,29 s en el aire: los acelerómetros leen 0 g) |
| 8,0 s | Contacto: pico de fuerza y flexión de rodilla y tronco |
| ~9,2 s en adelante | De pie de nuevo. Próximo aterrizaje a los 18 s, 28 s… |

**Controles en vivo:** haz clic en el chip *Plantillas FSR* durante la
simulación para mover la **resistencia del divisor** y la **fracción de
carga**. Con el modo `p` y el *Serial Plotter* se ve el efecto al instante.

**Cambiar de escenario:** en `diagram.json`, pon `"scenario"` en `"0"`
(controlado), `"1"` (rígido) o `"2"` (asimétrico con valgo) en **los
cuatro chips** (3 IMU + FSR) y reinicia.

**Registrar un ensayo con el logger** (con la simulación corriendo y su pestaña visible):
```bash
cd ../firmware/tools
uv run --with pyserial logger.py --port rfc2217://localhost:4000 --participante SIM --ensayo controlado --tara
```

**Si modificas el firmware:** ejecuta `sh build_firmware.sh` y reinicia la simulación.

> **Firmware v0.2.0 (26-oct-2026):** el hardware real usa MPU6050. El driver detecta solo el
> modelo, así que la simulación sigue usando los GY-85 virtuales sin cambios. Los pines se
> alinearon con el prototipo: pierna en SDA 18/SCL 19 (`Wire1`) y lumbar en SDA 16/SCL 17
> (I2C por software); `diagram.json` ya está actualizado. Recompila con `sh build_firmware.sh`
> antes de volver a usar Wokwi.

### Lo verificado en Wokwi (21-oct-2026)

- Los 3 GY-85 virtuales y las plantillas responden al firmware real: de pie, la rodilla marca 5,0° y el tronco 5,0°, igual que el modelo.
- Los FSR con 10 kΩ leen 4094 y 4026, **saturados**, como predijo el gemelo digital. El chip compensa que el ADC virtual de Wokwi use 5 V de referencia (atributo `adc_ref`).
- **Frecuencia en Wokwi: ~70 Hz en lugar de 100 Hz** (bandera 256 = periodo perdido). Los intervalos alternan entre ~10,7 y ~15,5 ms según si se lee el magnetómetro, lo que apunta a que cada transacción I2C tarda ~1,6 ms simulados, unas 6 veces más que en el hardware real. Es una limitación del simulador; en la placa real hay que confirmarlo con el comando `i` o con las líneas `#STAT`. Los datos siguen siendo válidos porque el firmware usa el `dt` real y las marcas de tiempo.
- **La terminal de VS Code se atrasa mucho** si está activo el *modo optimizado para lector de pantalla* (barra inferior: "Lector de pantalla optimizado"). Desactívalo para ver la salida en tiempo real.
- La compilación de simulación imprime cada 3 s una línea `#STAT` con los tiempos por etapa (FSR, IMU-T, IMU-P, IMU-L, resto).

## 2. Gemelo digital (barrido rápido en el PC)

Compila los módulos reales del firmware (drivers, filtro de orientación,
lectura de FSR) contra los sensores virtuales y corre 108 combinaciones en segundos:

```bash
cd gemelo
sh build.sh          # requiere el compilador de Xcode (xcode-select --install)
python3 run_sweep.py # genera resultados/metricas.csv y series_aterrizaje.csv
```

Los resultados están en el panel interactivo **"Gemelo digital del aterrizaje"**.

## 3. Resultados principales (fracción de carga 0,1)

| Diseño | FSR saturado | Error del pico de carga |
|---|---|---|
| **Actual:** 10 kΩ, 100 Hz, promedio de 3 | ~94 % del aterrizaje | −71 % a −82 % |
| 1 kΩ, 100 Hz, promedio de 3 | 0 % | −14 % a −31 % |
| 1 kΩ, 200 Hz, sin promedio | 0 % | −0,2 % a −2,4 % |

- **Hay que bajar la resistencia del divisor** (1 kΩ). Con 10 kΩ, el FSR 402 queda casi saturado con la persona solo de pie.
- **200 Hz y sin promedio móvil** capturan el pico de impacto; el promedio de 3 a 100 Hz lo recorta.
- **Ángulos:** el firmware sigue la rodilla y el tronco con un error RMS < 0,5° en el caso ideal. En la realidad será mayor (movimiento de piel, alineación).
- **Signo de rodilla:** la simulación confirmó que, con el montaje del README, el signo correcto es `KNEE_SIGN = -1` (ya corregido).

## Límites

El aterrizaje es un modelo cinemático simplificado, no musculoesquelético.
El FSR se extrapola por encima de 100 N. No se simulan ruido eléctrico,
cables largos ni histéresis o deriva del FSR: eso se valida con hardware.
