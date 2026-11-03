/**
 * Pose biomecánica → ángulos de segmento (plano sagital y frontal).
 * Convenciones (docs/ciencia.md; firmware config.h):
 *   knee    flexión de rodilla (knee_flex del firmware, relativa a la tara de pie)
 *   trunk   flexión de tronco (trunk_flex, IMU lumbar)
 *   thigh   inclinación del muslo: + = la rodilla va hacia adelante (cadera ≈ trunk + thigh)
 *   valgus  inclinación frontal de la pierna DERECHA (+ = rodilla hacia adentro)
 *   lateral inclinación lateral del tronco
 * La pierna izquierda no tiene IMU: se anima en espejo y se marca como estimada.
 */
import type { LiveFrame, Serie } from '../lib/types'

export interface Pose {
  knee: number
  trunk: number
  thigh: number
  valgus: number
  lateral: number
  footL: number // flexión plantar (°): + = punta abajo
  footR: number
  arms: number // flexión de hombros (equilibrio)
  y: number // altura de la raíz sobre el piso (m): cajón / vuelo
  z: number // desplazamiento antero-posterior del apoyo (m)
  thighEstimated: boolean
}

export type ModoSalto = 'cajon' | 'sitio'
export const BOX_H = 0.35 // cajón de caída de 30-40 cm
export const BOX_Z = -0.62 // el cajón queda detrás del punto de aterrizaje
const G = 9.81

export const emptyPose = (): Pose => ({
  knee: 0, trunk: 0, thigh: 0, valgus: 0, lateral: 0, footL: 0, footR: 0, arms: 0, y: 0, z: 0, thighEstimated: false,
})

// Límites articulares (se respetan siempre, también con datos ruidosos).
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
export function limit(p: Pose): Pose {
  p.knee = clamp(p.knee, -5, 140)
  p.thigh = clamp(p.thigh, -30, 120)
  p.trunk = clamp(p.trunk, -30, 85)
  p.valgus = clamp(p.valgus, -25, 25)
  p.lateral = clamp(p.lateral, -30, 30)
  p.footL = clamp(p.footL, -15, 45)
  p.footR = clamp(p.footR, -15, 45)
  return p
}

/** Flexión plantar según el orden de carga de la plantilla: si el antepié carga y
 *  el talón todavía no, la punta del pie está abajo (contacto antepié → talón). */
export function footPitch(heel: number, fore: number, air: boolean): number {
  if (air) return 24
  if (fore > 0.2 && heel < 0.45) return 24 * (1 - heel / 0.45)
  return 0
}

/** Trayectoria del cuerpo al dejarse caer del cajón (caída libre). */
export function fall(airT: number): { y: number; z: number } {
  const T = Math.sqrt((2 * BOX_H) / G)
  const k = Math.min(1, airT / T)
  return { y: Math.max(0, BOX_H - 0.5 * G * airT * airT), z: BOX_Z * (1 - k * (2 - k)) }
}

/** Salto vertical en el sitio: subida y bajada en el mismo punto. T = vuelo nominal (s);
 *  con la serie de un salto ya medido se usa el vuelo real. */
export function jumpInPlace(airT: number, T = 0.45): { y: number; z: number } {
  if (airT <= 0 || airT >= T) return { y: 0, z: 0 }
  const tau = airT
  return { y: Math.max(0, 0.5 * G * tau * (T - tau)), z: 0 }
}

export function poseFromFrame(f: LiveFrame, out: Pose): Pose {
  out.knee = f.knee
  out.trunk = f.trunk
  out.thighEstimated = f.thigh == null
  out.thigh = f.thigh ?? 0.55 * f.knee
  out.valgus = f.valgus ?? 0
  out.lateral = f.lateral ?? 0
  out.footL = footPitch(f.fsr[0], f.fsr[1], f.air)
  out.footR = footPitch(f.fsr[2], f.fsr[3], f.air)
  out.arms = f.air ? 35 : 8 + 0.45 * Math.max(0, f.knee)
  return limit(out)
}

/** Interpola la serie de un salto en el instante t (s desde el contacto). */
export function poseFromSerie(s: Serie, t: number, out: Pose, modo: ModoSalto = 'cajon'): Pose {
  const ts = s.t
  let i = 0
  if (t <= ts[0]) i = 0
  else if (t >= ts[ts.length - 1]) i = ts.length - 2
  else {
    let lo = 0
    let hi = ts.length - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (ts[m] <= t) lo = m
      else hi = m
    }
    i = lo
  }
  const j = Math.min(i + 1, ts.length - 1)
  const a = ts[j] === ts[i] ? 0 : clamp((t - ts[i]) / (ts[j] - ts[i]), 0, 1)
  const L = (arr: number[] | null | undefined, def = 0) => (arr ? arr[i] + (arr[j] - arr[i]) * a : def)
  const fs = s.fsr[i].map((v, k) => v + (s.fsr[j][k] - v) * a)
  const air = fs.reduce((x, y) => x + y, 0) < 0.25 && t < 0.02 && t > -0.45
  out.knee = L(s.knee)
  out.trunk = L(s.trunk)
  out.thighEstimated = !s.thigh
  out.thigh = s.thigh ? L(s.thigh) : 0.55 * out.knee
  out.valgus = L(s.valgus)
  out.lateral = L(s.lateral)
  out.footL = footPitch(fs[0], fs[1], air)
  out.footR = footPitch(fs[2], fs[3], air)
  out.arms = air ? 35 : 8 + 0.45 * Math.max(0, out.knee)
  // raíz: de pie en el cajón → caída libre → apoyo en el punto de aterrizaje
  const tAir = flightStart(s)
  if (modo === 'sitio') {
    const j = t >= tAir && t < 0 ? jumpInPlace(t - tAir, -tAir) : { y: 0, z: 0 }
    out.y = j.y
    out.z = 0
  } else if (t < tAir) {
    out.y = BOX_H
    out.z = BOX_Z
  } else if (t < 0) {
    const f = fall(t - tAir)
    out.y = f.y
    out.z = f.z
  } else {
    out.y = 0
    out.z = 0
  }
  return limit(out)
}

const cacheFlight = new WeakMap<Serie, number>()
export function flightStart(s: Serie): number {
  const c = cacheFlight.get(s)
  if (c !== undefined) return c
  let tA = -0.26
  for (let i = 0; i < s.t.length; i++) {
    if (s.t[i] >= 0) break
    const sum = s.fsr[i].reduce((x, y) => x + y, 0)
    if (sum < 0.25) {
      tA = s.t[i]
      break
    }
  }
  cacheFlight.set(s, tA)
  return tA
}

/** Instante de máxima flexión de rodilla (0-500 ms tras el contacto). */
export function peakTime(s: Serie): number {
  let best = 0
  let bt = 0
  for (let i = 0; i < s.t.length; i++) {
    if (s.t[i] < 0 || s.t[i] > 0.5) continue
    if (s.knee[i] > best) {
      best = s.knee[i]
      bt = s.t[i]
    }
  }
  return bt
}

export function loadsAt(s: Serie, t: number): number[] {
  let i = 0
  while (i < s.t.length - 1 && s.t[i + 1] <= t) i++
  return s.fsr[i]
}
