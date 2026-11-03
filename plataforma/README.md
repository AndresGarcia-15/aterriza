# Aterriza — plataforma de retroalimentación del aterrizaje (UTB)

Producto para el deportista: salta (desde el cajón o en el sitio), aterriza y recibe al instante **qué hizo
bien, qué corregir y cómo**, comparado con un aterrizaje de referencia, con un atleta 3D que
reproduce el movimiento medido. Sin gráficas ni datos crudos en la vista del atleta (eso vive
en el **Modo profesional**, protegido con PIN).

```
[ESP32 USB / Wokwi / Demo] ──CSV (36 col.)──► backend FastAPI ──WebSocket 30 Hz──► React + three.js
                                              ├ core/link.py del laboratorio (reutilizado)
                                              ├ métricas LESS + motor de reglas (rules.yaml)
                                              └ SQLite local (atletas, sesiones, saltos)
```

## Instalación en Mac (una vez)
1. Homebrew → `brew install uv node`
2. Para el modo demo con el gemelo digital ya compilado no hace falta nada más
   (si falta `simulacion/gemelo/bin`, se compila solo con `xcode-select --install`).

## Uso
```bash
cd plataforma
./iniciar.sh          # compila si hace falta y abre http://127.0.0.1:8000
./iniciar.sh red      # accesible desde otros equipos (Tailscale)
./iniciar.sh dev      # desarrollo: Vite con recarga en caliente (:5173) + API (:8000)
```
También se puede abrir con doble clic en **Abrir Aterriza.command**.

### Fuentes de datos
- **Demostración:** el firmware real ejecutado en el gemelo digital (3 escenarios:
  controlado, rígido, asimétrico con valgo). En *Evaluación* aparecen los botones para soltar
  cada escenario y un modo *Auto*.
- **ESP32 por USB:** se detecta el puerto `/dev/cu.usbserial*` (921 600 baudios). El firmware
  **no** se modifica: mismo CSV de 36 columnas y mismos comandos (`t i g a m s x`).
- **Wokwi:** `rfc2217://localhost:4000` con la simulación corriendo en VS Code.

- **Banco virtual:** un ESP32 simulado con el mismo CSV del firmware, cuyas plantillas e IMU
  se manejan con el mouse y el teclado (para probar sin hardware).

## Hardware actual y simulación con las manos
- **Prototipo (oct. 2026):** ESP32 + 4 FSR 402 + IMU MPU6050 (con QMC5883P) en muslo
  (SDA 21/SCL 22) y pierna (SDA 18/SCL 19). La **IMU lumbar** (SDA 16/SCL 17) está pendiente:
  mientras falte, la plataforma la muestra como «pendiente», no bloquea la preparación y los
  ítems de tronco y cadera salen «no disponibles» (el índice usa lo que sí se midió).
  Firmware: `firmware/BiomecanicaESP32` v0.2.0 (detecta MPU6050 o GY-85 solo).
- **Botón «Tarar»** en la barra superior siempre que hay un dispositivo: la postura actual pasa
  a ser el cero (rodilla, tronco y muslo). Necesita 1 s de quietud de las IMU.
- **Sin atleta, en Evaluación:** presiona las 4 plantillas 2 s → suelta → presiona antepiés y
  luego talones. Moviendo las IMU de muslo y pierna se simula la flexión de rodilla. Pasa por
  la misma detección, métricas y recomendaciones que un salto real.

## Banco de pruebas (sin atleta)
Menú **Banco** (o «¿Aún sin atleta?» en la portada). Funciona con el ESP32 por USB, Wokwi o el
banco virtual, y no se mezcla con los atletas (sus saltos se guardan con el atleta reservado
«Banco de pruebas», oculto en la lista).
- **Sensores en vivo:** lectura cruda de cada FSR (ADC, voltaje, estado, minigráfica) y de cada
  IMU (|a|, giro, inclinación), banderas del firmware traducidas, tara y mensajes.
- **Prueba guiada:** reposo → presiona cada FSR → gira cada IMU → frecuencia. Detecta pines
  flotantes, cables cruzados entre canales, divisores que saturan, IMU sin señal o con buses
  cruzados, y guarda un reporte (Historial).
- **Salto con las manos:** presiona las 4 plantillas 2 s, suelta y vuelve a presionar (antepié →
  talón). Pasa por el mismo detector y motor de reglas; las variables de una IMU ausente quedan
  «no disponibles» y el índice usa solo lo medible.
- **Representación 3D explorable:** *Hardware* (gemelo de la mesa: plantillas que se iluminan,
  cables con pulsos de datos y las IMU girando con la orientación real del filtro Mahony) o
  *Atleta* (con los sensores puestos en su sitio, rayos X y ejes de montaje). Clic en cualquier
  pieza → la cámara se acerca y se abre su ficha (qué es, para qué sirve, especificaciones con
  unidades, conexión y lectura actual).

### Verlo a distancia con Tailscale
1. Instala Tailscale en el Mac del laboratorio y en el equipo remoto, con la misma cuenta.
2. En el Mac: `./iniciar.sh red` → muestra `http://100.x.y.z:8000`.
3. Ábrelo en el otro equipo. Todo viaja por WebSocket (sin polling): la latencia típica dentro
   de la tailnet es < 100 ms, por debajo del criterio de 300 ms.

## Pruebas
```bash
cd backend && uv run --group dev pytest -q        # motor de reglas (3 escenarios) + flujo por API
cd frontend && npm test                           # Vitest: cinemática 3D y componentes
cd frontend && npm run e2e                        # Playwright: flujo completo en demo (servidor en :8000)
```

## Estructura
- `backend/app/` — `main.py` (API + WebSocket), `live.py` (tiempo real y detección), `banco.py` (banco virtual y filtro de métricas sin IMU),
  `metrics.py` (variables de la sección 3), `engine.py` (índice, acciones, confianza),
  `orientation.py` (Mahony en el PC), `demo.py`, `reference.py`, `db.py`.
- `backend/feedback/rules.yaml` — umbrales, pesos, mensajes y citas (versionado).
- `frontend/src/pages` — Inicio, Preparar, Evaluar, Resultado, Progreso, Pro, Banco.
- `frontend/src/three` — atleta 3D (`Athlete.tsx`), gemelo del banco (`BenchRig.tsx`), escena, arcos de ángulo, repetición.
- `docs/` — `ciencia.md`, `ATTRIBUTIONS.md`, `GUIA_DOCENTE.md`.

## Privacidad
Los datos se guardan solo en `backend/data/plataforma.db` (SQLite local). En *Progreso* se
exportan a CSV o se borran por atleta. PIN del Modo profesional por defecto: **2468**
(cámbialo en Modo profesional → Configuración).

## Pendiente / límites conocidos
- Calibrar los FSR contra una plataforma de fuerza para reportar carga en % del peso corporal.
- Confirmar con hardware los signos de muslo y valgo (`backend/app/orientation.py`).
- Instalar la IMU lumbar (el firmware y la plataforma ya la esperan en SDA 16 / SCL 17).
- Los umbrales "operativos" deben revisarse con datos reales del grupo.
