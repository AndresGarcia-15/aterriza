#!/usr/bin/env python3
"""Compila el gemelo digital con los módulos reales del firmware (4 variantes:
100/200 Hz × promedio móvil 3/1) en macOS, Linux o Windows.

Necesita un compilador de C++17 en el PATH (se usa el primero que aparezca):
  macOS    xcode-select --install                       (clang++ como c++)
  Linux    sudo apt install g++                         (o el paquete g++ de tu distribución)
  Windows  winget install BrechtSanders.WinLibs.POSIX.UCRT   (g++ de MinGW-w64)
Otro compilador: variable de entorno CXX (p. ej. CXX=clang++).

Uso:  python build.py      (los binarios quedan en bin/)
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FW = HERE.parent.parent / "firmware" / "BiomecanicaESP32"
EXE = ".exe" if os.name == "nt" else ""
VARIANTES = [(100, 3), (100, 1), (200, 3), (200, 1)]


def binario(rate: int, ma: int) -> Path:
    return HERE / "bin" / f"sim_{rate}_ma{ma}{EXE}"


def compilador() -> str | None:
    for c in filter(None, (os.environ.get("CXX"), "c++", "g++", "clang++")):
        if shutil.which(c):
            return c
    return None


def main() -> int:
    cxx = compilador()
    if not cxx:
        print(__doc__, file=sys.stderr)
        print("No se encontró un compilador de C++ (c++, g++ o clang++).", file=sys.stderr)
        return 1
    (HERE / "bin").mkdir(exist_ok=True)
    fuentes = [HERE / "sim_host.cpp", FW / "ImuSensor.cpp", FW / "Orientation.cpp", FW / "FsrArray.cpp"]
    for rate, ma in VARIANTES:
        out = binario(rate, ma)
        cmd = [cxx, "-std=gnu++17", "-O2", "-w", f"-I{HERE / 'shim'}", f"-I{HERE.parent / 'modelo'}", f"-I{FW}",
               f"-DCFG_SAMPLE_RATE_HZ={rate}", f"-DCFG_FSR_MOVING_AVG={ma}", *map(str, fuentes), "-o", str(out)]
        if os.name == "nt":
            cmd.append("-static")  # el .exe no depende de las DLL de MinGW
        else:
            cmd.append("-lm")
        subprocess.run(cmd, check=True)
        print(out.relative_to(HERE))
    return 0


if __name__ == "__main__":
    sys.exit(main())
