/**
 * Marcas propias de Aterriza. Un solo lenguaje gráfico, el del logo: una
 * trayectoria que cae y una línea de piso. Nada de íconos genéricos: el estado
 * de un sensor o de un ítem se dice con la misma metáfora del salto
 * (aterrizó sobre la línea · quedó corto · cayó por debajo).
 */
import clsx from 'clsx'
import { useEffect, useId, useRef } from 'react'
import type { Estado } from '../lib/types'
import { frame } from '../lib/live'
import { useLive } from '../lib/store'

type P = { className?: string; title?: string }
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

/** Estado como un mini-aterrizaje: ok = la trayectoria toca el piso; parcial = se queda
 *  a medio camino; no = atraviesa el piso; no disponible = solo el piso, punteado. */
export function MarcaEstado({ estado, className, title }: P & { estado: Estado | 'pendiente' }) {
  const col = estado === 'ok' ? 'var(--ok)' : estado === 'parcial' || estado === 'pendiente' ? 'var(--mid)' : estado === 'no' ? 'var(--bad)' : 'var(--muted)'
  return (
    <svg viewBox="0 0 24 24" className={clsx('size-5 shrink-0', className)} style={{ color: col }} role="img" aria-label={title ?? estado}>
      {estado === 'ok' && (
        <>
          <path d="M3 5c6 0 8 4 10 9s4 5 8 5" {...base} strokeWidth={2.2} />
          <circle cx="3" cy="5" r="1.8" fill="currentColor" />
          <path d="M2 21h20" {...base} strokeWidth={2.4} />
        </>
      )}
      {(estado === 'parcial' || estado === 'pendiente') && (
        <>
          <path d="M3 5c5 0 7 3 9 7" {...base} strokeWidth={2.2} />
          <circle cx="3" cy="5" r="1.8" fill="currentColor" />
          <path d="M2 21h20" {...base} strokeWidth={2.4} strokeDasharray={estado === 'pendiente' ? '2 3' : undefined} />
        </>
      )}
      {estado === 'no' && (
        <>
          <path d="M3 4c6 0 8 5 10 10s2 7 2 9" {...base} strokeWidth={2.2} />
          <circle cx="3" cy="4" r="1.8" fill="currentColor" />
          <path d="M2 17h20" {...base} strokeWidth={2.4} />
        </>
      )}
      {estado === 'no_disponible' && <path d="M2 18h20" {...base} strokeWidth={2.2} strokeDasharray="2 3.5" />}
    </svg>
  )
}

/** Cargando: el punto recorre la trayectoria del logo y "aterriza" sobre el piso. */
export function Cargando({ className }: P) {
  const id = `tray-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 40 24" className={clsx('h-4 w-7 shrink-0', className)} aria-hidden>
      <path id={id} d="M3 4c9 0 12 6 16 12s9 5 18 5" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round" />
      <path d="M2 22.5h36" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.6" strokeLinecap="round" />
      <circle r="2.4" fill="currentColor">
        <animateMotion dur="1.1s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.6 1">
          <mpath href={`#${id}`} />
        </animateMotion>
      </circle>
    </svg>
  )
}

/** Tara: la línea de piso con su marca de cero. */
export function MarcaCero({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={clsx('size-4 shrink-0', className)} aria-hidden>
      <path d="M3 15h18" {...base} strokeWidth={2} />
      <path d="M12 6v9" {...base} strokeWidth={2} />
      <path d="M8.5 9.5 12 6l3.5 3.5" {...base} strokeWidth={2} />
    </svg>
  )
}

/** Plantilla con sus dos sensores (talón y antepié). */
export function MarcaPlantilla({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={clsx('size-5 shrink-0', className)} aria-hidden>
      <path d="M12 2.5c3.3 0 5 3 5 7 0 3-1.3 4.6-1.3 7.2 0 3-1.6 4.8-3.7 4.8s-3.7-1.8-3.7-4.8C8.3 14 7 12.6 7 9.5c0-4 1.7-7 5-7z" {...base} />
      <circle cx="12" cy="7.5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="17.5" r="1.6" fill="currentColor" />
    </svg>
  )
}

/** Trayectoria del salto (el gesto del logo), para acciones de "saltar". */
export function MarcaSalto({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={clsx('size-5 shrink-0', className)} aria-hidden>
      <path d="M3 19c3-9 6-13 9-13s6 4 9 13" {...base} strokeDasharray="0.1 3.4" strokeWidth={2.2} />
      <path d="M2 21h20" {...base} />
    </svg>
  )
}

/** Señal en vivo: un trazo corto dibujado con los datos que llegan (sin luces que parpadean).
 *  Si no llega nada, la línea queda plana y apagada. */
export function TrazoSenal({ className }: P) {
  const ref = useRef<SVGPolylineElement>(null)
  const hist = useRef<number[]>(Array(28).fill(0))
  const vivo = useLive((s) => !!s.status && s.status.estado === 'conectado' && s.status.fresco)
  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      if (t - last > 70) {
        last = t
        const f = frame.current
        const fresco = f && performance.now() - frame.recibido < 1500
        // señal: rodilla + carga total, solo para que el trazo "respire" con el sensor
        const v = fresco ? Math.max(-1, Math.min(1, (f.knee ?? 0) / 60 + ((f.hw?.raw ?? [0]).reduce((a, b) => a + b, 0) / 16380 - 0.25))) : 0
        hist.current = [...hist.current.slice(1), v]
        const pts = hist.current.map((y, i) => `${(i / (hist.current.length - 1)) * 40},${8 - y * 6}`).join(' ')
        ref.current?.setAttribute('points', pts)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <svg viewBox="0 0 40 16" className={clsx('h-4 w-10 shrink-0', className)} aria-hidden>
      <line x1="0" x2="40" y1="15" y2="15" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
      <polyline ref={ref} points="0,8 40,8" fill="none" stroke={vivo ? 'var(--accent)' : 'currentColor'} strokeOpacity={vivo ? 1 : 0.35} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** Cambio de tema: medio disco (claro/oscuro) sobre la línea de piso. */
export function MarcaTema({ oscuro, className }: P & { oscuro: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={clsx('size-5 shrink-0', className)} aria-hidden>
      <circle cx="12" cy="11" r="6.5" {...base} />
      <path d={oscuro ? 'M12 4.5a6.5 6.5 0 0 1 0 13z' : 'M12 4.5a6.5 6.5 0 0 0 0 13z'} fill="currentColor" />
      <path d="M4 21h16" {...base} />
    </svg>
  )
}

/** Acceso profesional: una regla graduada (medir), cerrada o abierta. */
export function MarcaPro({ abierto, className }: P & { abierto: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={clsx('size-5 shrink-0', className)} aria-hidden>
      <rect x="3" y="8" width="18" height="8" rx="1.5" {...base} />
      <path d="M7 8v3M11 8v4.5M15 8v3M19 8v2" {...base} strokeWidth={1.5} />
      {abierto && <circle cx="21" cy="4" r="2" fill="var(--accent)" />}
    </svg>
  )
}

/** Dibujo técnico del banco (plantillas + ESP32 + IMU), en el trazo de la marca. */
export function DibujoBanco({ className }: P) {
  const pie = 'M0 -11c3.2 0 4.8 2.8 4.8 6.6 0 2.8-1.2 4.3-1.2 6.8 0 2.8-1.5 4.6-3.6 4.6s-3.6-1.8-3.6-4.6c0-2.5-1.2-4-1.2-6.8 0-3.8 1.6-6.6 4.8-6.6z'
  return (
    <svg viewBox="0 0 84 48" className={clsx('h-12 w-[84px] shrink-0', className)} aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d={pie} transform="translate(12 26) scale(1.25)" />
        <path d={pie} transform="translate(30 26) scale(-1.25 1.25)" />
        <rect x="46" y="17" width="16" height="10" rx="1.5" />
        <rect x="70" y="8" width="9" height="7" rx="1" />
        <rect x="70" y="30" width="9" height="7" rx="1" />
        <path d="M16 18c8-6 20-6 30 2M33 34c6 2 10 0 13-7M62 20c4-5 6-8 8-8M62 24c4 4 6 9 8 9" strokeOpacity="0.55" />
        <path d="M2 45h80" strokeOpacity="0.5" />
      </g>
      <g fill="var(--accent)">
        <circle cx="12" cy="18.5" r="2" />
        <circle cx="12" cy="31" r="2" />
        <circle cx="30" cy="18.5" r="2" />
        <circle cx="30" cy="31" r="2" />
      </g>
    </svg>
  )
}
