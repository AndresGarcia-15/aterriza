"""Detección del ESP32 en los tres sistemas operativos (sin hardware: se simula pyserial)."""
from types import SimpleNamespace

from serial.tools import list_ports

from app.bridge import list_usb_ports


def _p(device, vid=None):
    return SimpleNamespace(device=device, vid=vid)


def test_windows_com(monkeypatch):
    # Bluetooth sin VID y un CP2102 en COM5: gana el ESP32
    monkeypatch.setattr(list_ports, "comports", lambda: [_p("COM3"), _p("COM5", 0x10C4)])
    assert list_usb_ports() == ["COM5"]


def test_macos_prefiere_cu(monkeypatch):
    monkeypatch.setattr(list_ports, "comports", lambda: [
        _p("/dev/tty.usbserial-0001", 0x10C4), _p("/dev/cu.usbserial-0001", 0x10C4), _p("/dev/cu.Bluetooth-Incoming-Port")])
    assert list_usb_ports() == ["/dev/cu.usbserial-0001"]


def test_linux_ch340_antes_que_otros(monkeypatch):
    monkeypatch.setattr(list_ports, "comports", lambda: [_p("/dev/ttyACM0", 0x2341), _p("/dev/ttyUSB0", 0x1A86), _p("/dev/ttyS0")])
    assert list_usb_ports() == ["/dev/ttyUSB0", "/dev/ttyACM0"]


def test_api_puertos(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    monkeypatch.setattr(list_ports, "comports", lambda: [_p("COM7", 0x1A86)])
    with TestClient(app) as c:
        assert c.get("/api/puertos").json() == {"puertos": ["COM7"], "sugerido": "COM7"}
