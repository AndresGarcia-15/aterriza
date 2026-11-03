#!/bin/sh
# Compila los chips virtuales a WebAssembly. Requiere wasi-sdk (clang con
# destino wasm32-wasi). Los .wasm ya vienen compilados en dist/; solo hace
# falta recompilar si se modifica el modelo o los chips.
#   macOS:  brew install llvm  y descargar wasi-sysroot, o usar wasi-sdk
set -e
cd "$(dirname "$0")"
CLANG=${WASI_SDK:-/opt/wasi-sdk}/bin/clang
SYSROOT=${WASI_SDK:-/opt/wasi-sdk}/share/wasi-sysroot
for chip in gy85 fsr; do
  $CLANG --target=wasm32-unknown-wasi --sysroot "$SYSROOT" -O2 -nostartfiles \
    -Wl,--import-memory -Wl,--export-table -Wl,--no-entry -Wall -Wno-unused-function -Werror \
    -o dist/$chip.chip.wasm src/$chip.c -lm
  echo "dist/$chip.chip.wasm"
done
