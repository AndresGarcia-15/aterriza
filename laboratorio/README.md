# Laboratorio biomecánico (Dash)

Panel interactivo que integra todo el sistema: ver el ESP32 en vivo, enviar
comandos, grabar ensayos, correr protocolos automáticos, ejecutar el gemelo
digital, configurar Wokwi y analizar o comparar los ensayos.

## Abrir

| Sistema | Abrir |
|---|---|
| macOS | Doble clic en `Abrir laboratorio.command`, o `sh iniciar.sh` |
| Linux | `sh iniciar.sh` |
| Windows | Doble clic en `Abrir laboratorio (Windows).cmd`, o `.\iniciar.ps1` en PowerShell |

- Se abre solo en el navegador: <http://127.0.0.1:8050>. Para cerrarlo: `Ctrl+C` en la terminal.
- La primera vez instala `uv` si falta, descarga las dependencias de Python (~1 min) y compila
  el gemelo digital (~20 s). Para eso necesita un compilador de C++: ver
  [simulacion/README.md](../simulacion/README.md#2-gemelo-digital-barrido-rápido-en-el-pc).

## Pestañas

**En vivo**
- **Fuente de datos.** Hay tres opciones:
  - **Simulador:** el firmware real corriendo en el gemelo digital; no necesita nada más.
  - **Wokwi:** la simulación de VS Code, por `rfc2217://localhost:4000`.
  - **ESP32 USB:** la placa real.
- **Diagrama del sistema animado.** ESP32, 3 IMU y 4 FSR con sus valores en vivo; los cables
  se ponen verdes si llegan datos y rojos si hay error o saturación.
- **Figura del atleta.** Muestra la rodilla y el tronco medidos en tiempo real.
- **Señales.** Carga plantar, ángulos y aceleraciones de los últimos 8 s.
- **Comandos.** Tara en quietud, `t`, `i`, `g` y `a`, con la consola del firmware.
- **Grabar ensayo.** Usa el mismo formato que `logger.py`: CSV crudo + JSON de metadatos.
- **Protocolo automático.** Conecta, hace la tara cuando el atleta está quieto, graba N segundos y deja el ensayo analizado.

**Experimentos**
- **Simular** una configuración (escenario, resistencia, fracción de carga, frecuencia, filtro)
  y ver real frente a medido, con los indicadores de error.
- **Barrido completo.** Corre las 108 configuraciones y muestra mapas de error y de saturación.
- **Wokwi.** Envía la configuración elegida a `diagram.json` y recompila el firmware; Wokwi se reinicia solo.

**Ensayos** (se actualiza solo cuando termina una grabación)
- **Indicadores del ensayo:** duración, Hz reales, pérdidas, saturación.
- **Aterrizajes detectados.** Para cada uno: vuelo, rodilla en el contacto y en el pico,
  tiempo de absorción, tronco, pico de carga y asimetría izquierda/derecha.
- **Gráficas con los contactos marcados.** La carga se puede ver en cuentas del ADC o estimada
  con la curva nominal del FSR 402.
- **Comparación** de aterrizajes de varios ensayos, alineados al contacto.

## Archivos

- `ensayos/`: ensayos grabados desde el laboratorio (también lee `firmware/tools/ensayos/` del logger).
- `core/`: `link.py` (fuentes, búfer, grabación), `analysis.py` (eventos y variables),
  `experiments.py` (gemelo, barrido, Wokwi, protocolo), `figures.py` (gráficas).

> La carga estimada usa la curva **nominal** del FSR 402: es "carga instrumentada
> estimada" hasta que cada sensor tenga su calibración.
