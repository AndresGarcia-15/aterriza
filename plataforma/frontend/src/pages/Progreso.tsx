import clsx from 'clsx'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button, CAT_ESTADO, Disclaimer, estadoVar, Sheet } from '../components/ui'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import type { Atleta, Item } from '../lib/types'

interface SesionP {
  id: number
  inicio: string
  saltos: number
  validos: number
  promedio?: number
  mejor?: number
  principal?: (Item & { repeticiones: number; de: number }) | null
  saltos_lista: { id: number; indice: number; categoria: string; confianza: string; fecha: string }[]
}
interface Prog {
  atleta: Atleta
  sesiones: SesionP[]
  proxima_meta: { texto: string; nombre: string; indice_objetivo: number | null } | null
}

const cat = (v: number) => (v >= 85 ? 'ok' : v >= 70 ? 'ok' : v >= 55 ? 'parcial' : 'no') as 'ok' | 'parcial' | 'no'

/** Tendencia del índice entre sesiones: la única gráfica permitida en la vista del atleta. */
function Tendencia({ s }: { s: SesionP[] }) {
  const pts = s.filter((x) => x.promedio != null)
  if (pts.length < 1) return null
  const W = 720
  const H = 220
  const px = (i: number) => (pts.length === 1 ? W / 2 : 40 + (i * (W - 80)) / (pts.length - 1))
  const py = (v: number) => H - 28 - (v / 100) * (H - 56)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${px(i)},${py(p.promedio!)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Evolución del índice promedio por sesión">
      {[55, 70, 85].map((b) => (
        <g key={b}>
          <line x1="30" x2={W - 10} y1={py(b)} y2={py(b)} stroke="var(--line)" strokeDasharray="3 5" />
          <text x={W - 8} y={py(b) - 5} textAnchor="end" className="fill-[var(--muted)] font-mono text-[10px]">
            {b}
          </text>
        </g>
      ))}
      <motion.path d={d} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }} />
      {pts.map((p, i) => (
        <g key={p.id}>
          <motion.circle cx={px(i)} cy={py(p.promedio!)} r="7" fill="var(--bg)" stroke={estadoVar(cat(p.promedio!))} strokeWidth="3" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.1 }} />
          <text x={px(i)} y={py(p.promedio!) - 16} textAnchor="middle" className="fill-[var(--ink)] font-mono text-[13px] font-medium">
            {p.promedio}
          </text>
          <text x={px(i)} y={H - 6} textAnchor="middle" className="fill-[var(--muted)] font-mono text-[10px]">
            {new Date(p.inicio).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
          </text>
        </g>
      ))}
    </svg>
  )
}

export default function Progreso() {
  const nav = useNavigate()
  const { atleta, setAtleta } = useApp()
  const [p, setP] = useState<Prog | null>(null)
  const [borrar, setBorrar] = useState(false)
  useEffect(() => {
    if (atleta) api.get<Prog>(`/api/atletas/${atleta.id}/progreso`).then(setP).catch(() => {})
  }, [atleta])
  if (!atleta) return <Navigate to="/" replace />
  if (!p) return <div className="p-10 text-muted">Cargando…</div>
  const ult = p.sesiones[p.sesiones.length - 1]

  const confirmarBorrado = async () => {
    await api.del(`/api/atletas/${atleta.id}`)
    setAtleta(null)
    nav('/')
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6 pb-20 pt-10 lg:px-10" data-testid="progreso">
      <p className="eyebrow">Sesión y progreso</p>
      <h1 className="display mt-2 text-6xl">{atleta.nombre}</h1>
      {!ult ? (
        <div className="mt-10 rounded-3xl border border-line bg-surface p-10 text-center">
          <p className="text-xl text-ink-2">Aún no hay saltos registrados.</p>
          <Button size="lg" className="mt-5" onClick={() => nav('/preparar')}>
            Empezar una evaluación
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <div className="rounded-[28px] border border-line bg-surface p-6">
              <p className="eyebrow">Promedio de la sesión · índice 0 – 100</p>
              <p className="display tnum mt-3 text-7xl" style={{ color: estadoVar(cat(ult.promedio ?? 0)) }} data-testid="promedio">
                {ult.promedio ?? '—'}
              </p>
              <p className="mt-1 text-ink-2">
                {ult.validos} saltos válidos de {ult.saltos}
              </p>
            </div>
            <div className="rounded-[28px] border border-line bg-surface p-6">
              <p className="eyebrow flex items-center gap-2">
                Mejor salto · índice 0 – 100
              </p>
              <p className="display tnum mt-3 text-7xl" style={{ color: estadoVar(cat(ult.mejor ?? 0)) }}>
                {ult.mejor ?? '—'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {ult.saltos_lista.map((j, i) => (
                  <Link key={j.id} to={`/salto/${j.id}`} className={clsx('rounded-full border px-3 py-1 font-mono text-sm transition hover:border-ink/40', j.confianza === 'baja' ? 'border-dashed border-line text-muted' : 'border-line')}>
                    #{i + 1} · <b style={{ color: estadoVar(CAT_ESTADO[j.categoria]) }}>{j.indice}</b>
                  </Link>
                ))}
              </div>
            </div>
            <div className="rounded-[28px] border border-accent/40 bg-accent-soft p-6" data-testid="proxima-meta">
              <p className="eyebrow flex items-center gap-2 !text-accent">
                Tu próxima meta
              </p>
              <p className="mt-3 text-2xl font-semibold leading-snug">{p.proxima_meta?.texto ?? '¡Mantén tu técnica!'}</p>
              {p.proxima_meta?.indice_objetivo && <p className="mt-2 text-ink-2">Siguiente nivel: índice {p.proxima_meta.indice_objetivo}</p>}
            </div>
          </div>

          {ult.principal && (
            <div className="mt-4 rounded-[28px] border border-line bg-surface p-6" data-testid="recomendacion-sesion">
              <p className="eyebrow">Recomendación principal de la sesión · se repitió en {ult.principal.repeticiones} de {ult.principal.de} saltos</p>
              <p className="display-cond mt-2 text-3xl">{ult.principal.mensaje}</p>
            </div>
          )}

          <div className="mt-8 rounded-[28px] border border-line bg-surface p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="display-cond text-2xl">Evolución del índice</h2>
              <span className="eyebrow">promedio por sesión · índice 0 – 100</span>
            </div>
            <Tendencia s={p.sesiones} />
          </div>
        </>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3 rounded-[28px] border border-line p-6">
        <div className="flex-1">
          <h3 className="font-semibold">Tus datos</h3>
          <p className="text-sm text-muted">Se guardan solo en este equipo (SQLite local). Puedes exportarlos o borrarlos cuando quieras.</p>
        </div>
        <a href={`/api/atletas/${atleta.id}/exportar.csv`} download>
          <Button variant="ghost">
            Exportar CSV
          </Button>
        </a>
        <Button variant="danger" onClick={() => setBorrar(true)}>
          Borrar atleta
        </Button>
      </div>
      <Disclaimer className="mt-6" text="Herramienta educativa de técnica; no es un diagnóstico médico." />

      <Sheet open={borrar} onOpenChange={setBorrar} title="¿Borrar todos los datos?">
        <p className="text-ink-2">
          Se borrarán {atleta.nombre}, sus sesiones y todos sus saltos de este equipo. No se puede deshacer.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setBorrar(false)}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirmarBorrado}>
            Borrar definitivamente
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
