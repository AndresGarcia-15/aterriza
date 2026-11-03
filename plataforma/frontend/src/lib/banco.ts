/** Banco de pruebas: nombres, pines (firmware config.h) y utilidades compartidas. */
import { api } from './api'
import { frame } from './live'
import type { Hardware } from './types'

export const FSR_INFO = [
  { id: 'P1_H', nombre: 'Talón izquierdo', corto: 'Talón izq.', gpio: 32 },
  { id: 'P1_F', nombre: 'Antepié izquierdo', corto: 'Antepié izq.', gpio: 33 },
  { id: 'P2_H', nombre: 'Talón derecho', corto: 'Talón der.', gpio: 34 },
  { id: 'P2_F', nombre: 'Antepié derecho', corto: 'Antepié der.', gpio: 35 },
] as const

export const IMU_INFO = [
  { id: 'T', nombre: 'Muslo derecho', corto: 'Muslo', sda: 21, scl: 22, bus: 'I2C hardware', opcional: false },
  { id: 'P', nombre: 'Pierna derecha', corto: 'Pierna', sda: 18, scl: 19, bus: 'I2C hardware', opcional: false },
  // La lumbar está comprada y pendiente de instalar: mientras falte, el tronco queda "no disponible".
  { id: 'L', nombre: 'Lumbar', corto: 'Lumbar', sda: 16, scl: 17, bus: 'I2C por software', opcional: true },
] as const
export const IMU_MODELO = 'MPU6050 + QMC5883P'

export const SAT_RAW = 4000 // FSR_SATURATION_RAW del firmware
export const PRESS_RAW = 300 // por encima de esto, el FSR se considera presionado

export const FLAGS: { bit: number; texto: string; grave: boolean }[] = [
  { bit: 0, texto: 'Talón izq. saturado', grave: true },
  { bit: 1, texto: 'Antepié izq. saturado', grave: true },
  { bit: 2, texto: 'Talón der. saturado', grave: true },
  { bit: 3, texto: 'Antepié der. saturado', grave: true },
  { bit: 4, texto: 'IMU muslo sin señal', grave: true },
  { bit: 5, texto: 'IMU pierna sin señal', grave: true },
  { bit: 6, texto: 'IMU lumbar sin señal (pendiente de instalar)', grave: false },
  { bit: 7, texto: 'Solo giroscopio (sin acelerómetro)', grave: false },
  { bit: 8, texto: 'Muestra atrasada (overrun)', grave: false },
  { bit: 9, texto: 'Calibrando', grave: false },
  { bit: 10, texto: 'Sin tara', grave: false },
]

export const flagList = (f: number) => FLAGS.filter((x) => f & (1 << x.bit))

/** Lectura cruda (0-4095) → estado legible del FSR. */
export function fsrEstado(raw: number): { label: string; tono: 'muted' | 'accent' | 'bad' } {
  if (raw >= SAT_RAW) return { label: 'Saturado', tono: 'bad' }
  if (raw > PRESS_RAW) return { label: 'Presionado', tono: 'accent' }
  return { label: 'En reposo', tono: 'muted' }
}

/** Voltaje aproximado en el pin (ADC de 12 bits, atenuación 11 dB ≈ 0-3,3 V). */
export const volts = (raw: number) => (raw / 4095) * 3.3

/** Inclinación del segmento (°): ángulo entre el eje X del sensor (a lo largo del segmento,
 *  hacia arriba según la convención de montaje) y la vertical. De pie / de canto = 0°. */
export function tilt(q: number[] | undefined): number | null {
  if (!q) return null
  const [w, x, y, z] = q
  const upX = 2 * (x * z - w * y)
  return (Math.acos(Math.max(-1, Math.min(1, upX))) * 180) / Math.PI
}

/** Hardware del último cuadro en vivo, o null si los datos están viejos (> 1,5 s). */
export function hwNow(): Hardware | null {
  const f = frame.current
  if (!f?.hw || performance.now() - frame.recibido > 1500) return null
  return f.hw
}

/** Control del banco virtual. */
export const virtual = {
  fsr: (fsr: (number | boolean | null)[]) => api.post('/api/banco/virtual', { fsr }).catch(() => {}),
  imu: (imu: Record<string, boolean>) => api.post('/api/banco/virtual', { imu }).catch(() => {}),
  giro: (k: string) => api.post('/api/banco/virtual', { giro: k }).catch(() => {}),
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
export type Aterrizaje = 'antepie' | 'plano' | 'talon'

/** Salto completo con el banco virtual: de pie 2,2 s → vuelo 0,32 s → aterrizaje. */
export async function saltoVirtual(tipo: Aterrizaje, asimetrico: boolean) {
  const L = asimetrico ? 1500 : 2600
  const R = asimetrico ? 3300 : 2600
  await virtual.fsr([true, true, true, true])
  await wait(2200)
  await virtual.fsr([false, false, false, false])
  await wait(320)
  if (tipo === 'plano') await virtual.fsr([L, L, R, R])
  else if (tipo === 'antepie') {
    await virtual.fsr([null, L, null, R])
    await wait(55)
    await virtual.fsr([L, null, R, null])
  } else {
    await virtual.fsr([L, null, R, null])
    await wait(55)
    await virtual.fsr([null, L, null, R])
  }
  await wait(1600)
}
