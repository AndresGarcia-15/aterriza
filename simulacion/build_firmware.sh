#!/bin/sh
# Recompila el firmware real para la simulación de Wokwi (ejecutar después
# de cambiar cualquier archivo de firmware/BiomecanicaESP32).
set -e
cd "$(dirname "$0")"
# CFG_AUTO_STATS_S=3: imprime cada 3 s una línea #STAT con los tiempos por etapa
arduino-cli compile --fqbn esp32:esp32:esp32 --build-property "compiler.cpp.extra_flags=-DCFG_AUTO_STATS_S=3" \
  --output-dir build ../firmware/BiomecanicaESP32
echo "Listo: build/BiomecanicaESP32.ino.merged.bin  (en Wokwi: reinicie la simulación)"
