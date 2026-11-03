/**
 * Mapa de plantillas: dos huellas con calor en talón y antepié (carga relativa a
 * la de pie) y la flecha del orden de apoyo antepié → talón. Puede animarse con un
 * reloj externo (repetición sincronizada con el atleta 3D) sin re-render de React.
 */
import { useEffect, useId, useRef } from 'react'
import { loadsAt } from '../three/pose'
import type { Serie } from '../lib/types'

export const FOOT = 'M50 6c16 0 27 15 28 38 1 22-6 38-9 56-3 17 6 32 4 52-2 22-14 34-27 34s-24-11-25-30c-1-23 6-36 4-56-2-18-11-31-10-54C16 21 33 6 50 6z'

function heat(x: number) {
  const v = Math.max(0, Math.min(1, x / 3))
  // azul → cian → ámbar → rojo (misma rampa que el piso 3D)
  const stops = [
    [0, [30, 90, 230]],
    [0.35, [40, 225, 215]],
    [0.75, [255, 190, 60]],
    [1, [255, 70, 80]],
  ] as const
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1]
      const [b, cb] = stops[i]
      const k = (v - a) / (b - a)
      return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * k)).join(',')})`
    }
  }
  return 'rgb(255,70,80)'
}

interface Props {
  serie?: Serie
  clock?: { current: number }
  static?: number[]
  ordenMs?: number | null
  compact?: boolean
}

export function Footprints({ serie, clock, static: fixed, ordenMs, compact }: Props) {
  const uid = useId().replace(/:/g, '')
  const refs = useRef<(SVGCircleElement | null)[]>([])
  const stops = useRef<(SVGStopElement | null)[]>([])
  const labels = useRef<(SVGTextElement | null)[]>([])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const l = fixed ?? (serie && clock ? loadsAt(serie, clock.current) : [0, 0, 0, 0])
      l.forEach((x, i) => {
        const r = refs.current[i]
        const s = stops.current[i]
        if (r) r.setAttribute('opacity', String(Math.min(1, 0.15 + x / 1.4)))
        if (s) s.setAttribute('stop-color', heat(x))
        if (r) r.setAttribute('r', String(17 + Math.min(14, x * 4)))
        const t = labels.current[i]
        if (t) t.textContent = `${x.toFixed(1).replace('.', ',')}×`
      })
      if (!fixed) raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [serie, clock, fixed])

  // índice: 0 izq. talón, 1 izq. antepié, 2 der. talón, 3 der. antepié
  const feet = [
    { x: 0, flip: true, name: 'Izquierdo', heel: 0, fore: 1 },
    { x: 120, flip: false, name: 'Derecho', heel: 2, fore: 3 },
  ]
  return (
    <svg viewBox="-20 -14 260 252" className={compact ? 'h-full w-full' : 'w-full'} role="img" aria-label="Mapa de presión de las plantillas">
      <defs>
        {[0, 1, 2, 3].map((i) => (
          <radialGradient key={i} id={`${uid}g${i}`}>
            <stop ref={(e) => void (stops.current[i] = e)} offset="0" stopColor="#40e0d0" />
            <stop offset="1" stopColor="#40e0d0" stopOpacity="0" />
          </radialGradient>
        ))}
        {feet.map((f) => (
          <clipPath id={`${uid}c${f.x}`} key={f.x}>
            <path d={FOOT} transform={`translate(${f.x},0) ${f.flip ? 'translate(100,0) scale(-1,1)' : ''}`} />
          </clipPath>
        ))}
      </defs>
      {feet.map((f) => (
        <g key={f.x}>
          <path d={FOOT} transform={`translate(${f.x},0) ${f.flip ? 'translate(100,0) scale(-1,1)' : ''}`} fill="var(--surface-2)" stroke="var(--line-2)" strokeWidth="1.5" />
          <g clipPath={`url(#${uid}c${f.x})`}>
            <circle ref={(e) => void (refs.current[f.fore] = e)} cx={f.x + 50} cy={48} r={22} fill={`url(#${uid}g${f.fore})`} />
            <circle ref={(e) => void (refs.current[f.heel] = e)} cx={f.x + 50} cy={186} r={22} fill={`url(#${uid}g${f.heel})`} />
          </g>
          {!compact && (
            <>
              <text x={f.x + 50} y={232} textAnchor="middle" className="fill-[var(--muted)] font-mono text-[10px] uppercase tracking-[0.14em]">
                {f.name}
              </text>
              <text ref={(e) => void (labels.current[f.fore] = e)} x={f.x + 50} y={52} textAnchor="middle" className="fill-[var(--ink)] font-mono text-[11px] font-medium" />
              <text ref={(e) => void (labels.current[f.heel] = e)} x={f.x + 50} y={190} textAnchor="middle" className="fill-[var(--ink)] font-mono text-[11px] font-medium" />
            </>
          )}
        </g>
      ))}
      {!compact && ordenMs != null && (
        <g>
          <defs>
            <marker id={`${uid}arr`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0 10 5 0 10z" fill={ordenMs >= 0 ? 'var(--ok)' : 'var(--bad)'} />
            </marker>
          </defs>
          <path
            d={ordenMs >= 0 ? 'M110 66 C 118 110 118 140 110 172' : 'M110 172 C 118 140 118 110 110 66'}
            stroke={ordenMs >= 0 ? 'var(--ok)' : 'var(--bad)'}
            strokeWidth="2.2"
            fill="none"
            strokeDasharray="4 4"
            markerEnd={`url(#${uid}arr)`}
          >
            <animate attributeName="stroke-dashoffset" from="16" to="0" dur="0.8s" repeatCount="indefinite" />
          </path>
          <text x={110} y={-2} textAnchor="middle" className="fill-[var(--ink-2)] font-mono text-[10px]">
            {ordenMs >= 0 ? 'antepié → talón' : 'talón primero'}
          </text>
        </g>
      )}
    </svg>
  )
}
