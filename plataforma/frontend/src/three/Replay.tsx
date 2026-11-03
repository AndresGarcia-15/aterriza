import { useFrame } from '@react-three/fiber'
import type { MutableRefObject } from 'react'
import type { Serie } from '../lib/types'
import { loadsAt, poseFromSerie, type ModoSalto, type Pose } from './pose'

export interface ReplayClock {
  t: number
  playing: boolean
  speed: number
  from: number
  to: number
  loop: boolean
  hold: number // pausa (s) al final de cada vuelta
  held: number
}

export const newClock = (from = -0.6, to = 0.9, speed = 0.35): ReplayClock => ({
  t: from, playing: true, speed, from, to, loop: true, hold: 0.9, held: 0,
})

/** Avanza el reloj de la repetición y calcula la pose del atleta y del fantasma. */
export function ReplayDriver({
  serie, ghost, clock, pose, ghostPose, ghostOffset = 0, onEnd, mirror, modo = 'cajon',
}: {
  modo?: ModoSalto
  serie?: Serie | null
  ghost?: Serie | null
  clock: MutableRefObject<ReplayClock>
  pose?: MutableRefObject<Pose>
  ghostPose?: MutableRefObject<Pose>
  ghostOffset?: number
  onEnd?: () => void
  mirror?: { current: number }
}) {
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const c = clock.current
    if (c.playing) {
      if (c.t >= c.to) {
        c.held += dt
        if (c.held >= c.hold) {
          c.held = 0
          if (c.loop) c.t = c.from
          else {
            c.playing = false
            onEnd?.()
          }
        }
      } else c.t = Math.min(c.to, c.t + dt * c.speed)
    }
    if (mirror) mirror.current = c.t
    if (serie && pose) poseFromSerie(serie, c.t, pose.current, modo)
    if (ghost && ghostPose) {
      poseFromSerie(ghost, c.t, ghostPose.current, modo)
      ghostPose.current.z += ghostOffset
    }
  })
  return null
}

/** Cargas de las plantillas de la serie en el instante del reloj (para el piso 3D). */
export function LoadsFrom({ serie, clock, loads }: { serie: Serie; clock: { current: number }; loads: MutableRefObject<number[]> }) {
  useFrame(() => {
    loads.current = loadsAt(serie, clock.current)
  })
  return null
}
