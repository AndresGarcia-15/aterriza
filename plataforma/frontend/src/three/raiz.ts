/**
 * Movimiento de la raíz del atleta 3D a partir de los cuadros en vivo, según el
 * modo de salto:
 *   cajon  de pie en el cajón → caída libre → apoyo en el punto de aterrizaje → vuelve al cajón
 *   sitio  de pie en el piso → salto vertical en el sitio → aterriza en el mismo lugar
 * Más de 1,5 s sin carga en las plantillas no es un vuelo: nadie está encima
 * (p. ej. simulando con las manos), así que el atleta espera de pie.
 */
import type { LiveFrame } from '../lib/types'
import { BOX_H, BOX_Z, fall, jumpInPlace, type ModoSalto } from './pose'

type Modo = 'box' | 'air' | 'floor' | 'return'

export class RootMotion {
  mode: Modo = 'box'
  t0 = 0
  modo: ModoSalto = 'cajon'
  /** Segundos en el piso antes de volver al cajón (solo modo cajón). */
  returnAfter = 2.4

  reset(modo: ModoSalto) {
    this.modo = modo
    this.mode = modo === 'cajon' ? 'box' : 'floor'
  }

  /** Vuelve al cajón ya (p. ej. al pasar a "listo"). */
  backToBox(now: number) {
    if (this.modo === 'cajon' && this.mode === 'floor') {
      this.mode = 'return'
      this.t0 = now
    }
  }

  update(f: LiveFrame, now: number, out: { y: number; z: number }) {
    const cajon = this.modo === 'cajon'
    if (f.air && f.air_t >= 1.5) {
      if (cajon && (this.mode === 'air' || this.mode === 'floor')) {
        this.mode = 'return'
        this.t0 = now
      } else if (!cajon) this.mode = 'floor'
    } else if (f.air && f.air_t > 0.04 && this.mode !== 'air') {
      this.mode = 'air'
      this.t0 = now - f.air_t
    } else if (!f.air && this.mode === 'air') {
      this.mode = 'floor'
      this.t0 = now
    } else if (cajon && this.mode === 'floor' && now - this.t0 > this.returnAfter) {
      this.mode = 'return'
      this.t0 = now
    }

    if (this.mode === 'air') {
      const p = cajon ? fall(f.air_t) : jumpInPlace(f.air_t)
      out.y = p.y
      out.z = p.z
    } else if (this.mode === 'floor') {
      out.y = 0
      out.z = 0
    } else if (this.mode === 'box') {
      out.y = cajon ? BOX_H : 0
      out.z = cajon ? BOX_Z : 0
    } else {
      // vuelve al cajón: arco suave de 0,9 s
      const k = Math.min(1, (now - this.t0) / 0.9)
      const e = k * k * (3 - 2 * k)
      out.y = BOX_H * e + Math.sin(Math.PI * k) * 0.12
      out.z = BOX_Z * e
      if (k >= 1) this.mode = 'box'
    }
  }
}
