#!/bin/sh
# Compila el gemelo digital con los módulos reales del firmware (4 variantes:
# 100/200 Hz × promedio móvil 3/1). Requiere el compilador de Xcode
# (xcode-select --install) o cualquier g++/clang++.
set -e
cd "$(dirname "$0")"
FW=../../firmware/BiomecanicaESP32
CXX=${CXX:-c++}
mkdir -p bin
for rate in 100 200; do
  for ma in 3 1; do
    $CXX -std=gnu++17 -O2 -w -Ishim -I../modelo -I$FW \
      -DCFG_SAMPLE_RATE_HZ=$rate -DCFG_FSR_MOVING_AVG=$ma \
      sim_host.cpp $FW/ImuSensor.cpp $FW/Orientation.cpp $FW/FsrArray.cpp -o bin/sim_${rate}_ma${ma} -lm
    echo "bin/sim_${rate}_ma${ma}"
  done
done
