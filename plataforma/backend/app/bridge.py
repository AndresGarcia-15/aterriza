"""Acceso al código probado del laboratorio (laboratorio/core): se reutiliza tal cual."""
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[3]
LAB = PROJECT / "laboratorio"
if str(LAB) not in sys.path:
    sys.path.insert(0, str(LAB))

from core import analysis, link, paths  # noqa: E402,F401
from core.link import Link, SerialSource, find_usb_port, FLAG_NAMES  # noqa: E402,F401
