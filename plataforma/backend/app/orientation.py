"""
Orientación de cada IMU en el PC (réplica del filtro Mahony del firmware,
firmware/BiomecanicaESP32/Orientation.cpp) para obtener lo que el CSV no trae
ya calculado: inclinación del muslo (cadera aprox., ítem 5), inclinación frontal
de la pierna (valgo aprox., ítem 10) e inclinación lateral del tronco (ítem 9).

Convención de montaje del firmware (config.h): X a lo largo del segmento hacia
arriba, Z saliendo de la piel, Y medio-lateral. El vector "arriba" en ejes del
sensor da:
  - inclinación sagital  = atan2(vz, vx)   (igual que sagittalAngleDeg)
  - inclinación frontal  = atan2(vy, vx)
Todos los ángulos se reportan RELATIVOS a la postura de pie (tara).
"""
from __future__ import annotations

import math

# Signos de montaje. Igual que KNEE_SIGN/TRUNK_SIGN en el firmware: se verifican
# con el gemelo digital y, con hardware real, con el "test de ejes" del README.
THIGH_SIGN = 1.0      # + = la rodilla va hacia adelante del muslo (flexión de cadera)
VALGUS_SIGN = -1.0    # + = inclinación frontal de la pierna derecha del escenario "valgo"
LATERAL_SIGN = 1.0    # + = inclinación lateral del tronco (magnitud: lo que importa es |°|)

KP, GATE_G = 1.0, 0.15   # MAHONY_KP y ACCEL_GATE_G del firmware
D2R = math.pi / 180.0
R2D = 180.0 / math.pi


class Mahony:
    __slots__ = ("q0", "q1", "q2", "q3", "ready")

    def __init__(self):
        self.q0, self.q1, self.q2, self.q3 = 1.0, 0.0, 0.0, 0.0
        self.ready = False

    def init_from_accel(self, ax, ay, az):
        n = math.sqrt(ax * ax + ay * ay + az * az)
        if n < 1e-6:
            return
        ax, ay, az = ax / n, ay / n, az / n
        if az < -0.9999:
            self.q0, self.q1, self.q2, self.q3 = 0.0, 1.0, 0.0, 0.0
        else:
            q0, q1, q2 = 1.0 + az, ay, -ax
            qn = math.sqrt(q0 * q0 + q1 * q1 + q2 * q2)
            self.q0, self.q1, self.q2, self.q3 = q0 / qn, q1 / qn, q2 / qn, 0.0
        self.ready = True

    def up(self):
        q0, q1, q2, q3 = self.q0, self.q1, self.q2, self.q3
        return (2.0 * (q1 * q3 - q0 * q2), 2.0 * (q0 * q1 + q2 * q3), q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3)

    def update(self, gx, gy, gz, ax, ay, az, dt):
        """gx..gz en °/s (ya sin sesgo, como los envía el firmware); a en g."""
        if not self.ready:
            self.init_from_accel(ax, ay, az)
            return
        gx, gy, gz = gx * D2R, gy * D2R, gz * D2R
        n = math.sqrt(ax * ax + ay * ay + az * az)
        if n > 1e-6 and abs(n - 1.0) <= GATE_G:
            ax, ay, az = ax / n, ay / n, az / n
            vx, vy, vz = self.up()
            gx += KP * (ay * vz - az * vy)
            gy += KP * (az * vx - ax * vz)
            gz += KP * (ax * vy - ay * vx)
        gx *= 0.5 * dt
        gy *= 0.5 * dt
        gz *= 0.5 * dt
        a, b, c, d = self.q0, self.q1, self.q2, self.q3
        q0 = a + (-b * gx - c * gy - d * gz)
        q1 = b + (a * gx + c * gz - d * gy)
        q2 = c + (a * gy - b * gz + d * gx)
        q3 = d + (a * gz + b * gy - c * gx)
        qn = math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3)
        self.q0, self.q1, self.q2, self.q3 = q0 / qn, q1 / qn, q2 / qn, q3 / qn


def sagittal(v) -> float:
    return math.atan2(v[2], v[0]) * R2D


def frontal(v) -> float:
    return math.atan2(v[1], v[0]) * R2D


class SegmentTracker:
    """Procesa fila a fila (en vivo) o un archivo completo (análisis).
    Devuelve ángulos absolutos; la tara la aplica quien los usa."""

    def __init__(self):
        self.f = {"T": Mahony(), "P": Mahony(), "L": Mahony()}
        self.last_t = None

    def step(self, t_s: float, imu: dict[str, tuple]) -> tuple[float, float, float]:
        dt = 0.01 if self.last_t is None else min(max(t_s - self.last_t, 1e-4), 0.1)
        self.last_t = t_s
        for k, (ax, ay, az, gx, gy, gz) in imu.items():
            self.f[k].update(gx, gy, gz, ax, ay, az, dt)
        thigh = THIGH_SIGN * sagittal(self.f["T"].up())
        valgus = VALGUS_SIGN * frontal(self.f["P"].up())
        lateral = LATERAL_SIGN * frontal(self.f["L"].up())
        return thigh, valgus, lateral


def wrap180(d: float) -> float:
    while d > 180:
        d -= 360
    while d < -180:
        d += 360
    return d
