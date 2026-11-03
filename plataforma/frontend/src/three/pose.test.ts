import { describe, expect, it } from 'vitest'
import { BOX_H, emptyPose, fall, footPitch, limit, peakTime, poseFromFrame, poseFromSerie } from './pose'
import type { LiveFrame, Serie } from '../lib/types'

const serie: Serie = {
  t: [-0.4, -0.2, 0, 0.1, 0.2, 0.4],
  knee: [0, 3, 15, 50, 80, 60],
  trunk: [0, 2, 5, 20, 30, 20],
  thigh: [0, 2, 8, 27, 44, 33],
  valgus: [0, 0, 0, 5, 12, 6],
  lateral: null,
  fsr: [[1, 1, 1, 1], [0, 0, 0, 0], [0.4, 1.2, 0.4, 1.2], [2, 2, 2, 2], [1.5, 1.2, 1.5, 1.2], [1, 1, 1, 1]],
}

describe('pose del atleta', () => {
  it('respeta los límites articulares', () => {
    const p = limit({ ...emptyPose(), knee: 400, valgus: -90, trunk: 120 })
    expect(p.knee).toBe(140)
    expect(p.valgus).toBe(-25)
    expect(p.trunk).toBe(85)
  })
  it('interpola la serie con error < 5° respecto al dato (criterio §9)', () => {
    const p = poseFromSerie(serie, 0.1, emptyPose())
    expect(Math.abs(p.knee - 50)).toBeLessThan(5)
    expect(Math.abs(p.trunk - 20)).toBeLessThan(5)
    const q = poseFromSerie(serie, 0.15, emptyPose())
    expect(q.knee).toBeCloseTo(65, 5)
  })
  it('antepié antes que talón → punta del pie abajo', () => {
    expect(footPitch(0.1, 1.0, false)).toBeGreaterThan(15)
    expect(footPitch(1.0, 1.0, false)).toBe(0)
    expect(footPitch(0, 0, true)).toBe(24)
  })
  it('caída libre desde el cajón', () => {
    expect(fall(0).y).toBeCloseTo(BOX_H)
    expect(fall(1).y).toBe(0)
  })
  it('instante de máxima flexión', () => {
    expect(peakTime(serie)).toBe(0.2)
  })
  it('pierna izquierda sin IMU: el muslo se estima si falta', () => {
    const f: LiveFrame = { type: 'live', t: 0, knee: 40, trunk: 10, thigh: null, valgus: null, lateral: null, fsr: [1, 1, 1, 1], air: false, air_t: 0, flags: 0 }
    const p = poseFromFrame(f, emptyPose())
    expect(p.thighEstimated).toBe(true)
    expect(p.thigh).toBeCloseTo(22)
  })
})
