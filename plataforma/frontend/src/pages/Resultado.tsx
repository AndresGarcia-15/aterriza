import clsx from 'clsx'
import { ArrowLeft, ArrowRight, ChevronDown, Pause, Play } from 'lucide-react'
import { MarcaEstado } from '../components/marks'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Footprints } from '../components/Footprints'
import { Button, CAT_ESTADO, Disclaimer, ESTADO, EstadoBadge, estadoVar, IndexRing, Sheet } from '../components/ui'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import type { Item, Referencia, SaltoDetalle } from '../lib/types'
import { AngleArcs } from '../three/AngleArcs'
import { Athlete, newJoints } from '../three/Athlete'
import { emptyPose, peakTime } from '../three/pose'
import { LoadsFrom, newClock, ReplayDriver, type ReplayClock } from '../three/Replay'
import { FloorPressure, Stage, type Vista } from '../three/Stage'

const fmt = (v: number | null | undefined, u = '') => (v == null ? '—' : `${Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) : v.toFixed(1).replace('.', ',')}${u}`)

function Comparacion({ d, ref_, clock, mirror }: { d: SaltoDetalle; ref_: Referencia | null; clock: React.MutableRefObject<ReplayClock>; mirror: { current: number } }) {
  const pose = useRef(emptyPose())
  const ghost = useRef(emptyPose())
  const joints = useRef(newJoints())
  const loads = useRef<number[]>([0, 0, 0, 0])
  return (
    <>
      <ReplayDriver serie={d.serie} ghost={ref_?.serie} clock={clock} pose={pose} ghostPose={ghost} mirror={mirror} modo={d.resultado.modo_salto ?? 'cajon'} />
      <LoadsFrom serie={d.serie} clock={mirror} loads={loads} />
      <Athlete pose={pose} joints={joints} smooth={0} idle={false} />
      {ref_ && <Athlete pose={ghost} ghost smooth={0} />}
      <AngleArcs joints={joints} pose={pose} metas={{ rodilla: 30, tronco: 10 }} />
      <FloorPressure loads={loads} joints={joints} />
    </>
  )
}

function Timeline({ clock, mirror, peak }: { clock: React.MutableRefObject<ReplayClock>; mirror: { current: number }; peak: number }) {
  const bar = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const txt = useRef<HTMLSpanElement>(null)
  const [playing, setPlaying] = useState(true)
  const span = [-0.5, 0.9]
  const pct = (t: number) => ((t - span[0]) / (span[1] - span[0])) * 100
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const p = pct(mirror.current)
      if (knob.current) knob.current.style.left = `${p}%`
      if (bar.current) bar.current.style.width = `${p}%`
      if (txt.current) txt.current.textContent = `${mirror.current >= 0 ? '+' : ''}${Math.round(mirror.current * 1000)} ms`
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  })
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const k = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    clock.current.t = span[0] + k * (span[1] - span[0])
    clock.current.playing = false
    setPlaying(false)
  }
  const modo = (from: number, to: number, speed: number) => {
    Object.assign(clock.current, { from, to, t: from, speed, playing: true, loop: true, held: 0 })
    setPlaying(true)
  }
  return (
    <div className="flex items-center gap-4">
      <button
        onClick={() => {
          clock.current.playing = !clock.current.playing
          setPlaying(clock.current.playing)
        }}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-bg"
        aria-label={playing ? 'Pausar' : 'Reproducir'}
      >
        {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
      </button>
      <div className="relative h-11 flex-1 cursor-pointer" onPointerDown={seek} onPointerMove={(e) => e.buttons && seek(e)} role="slider" aria-label="Tiempo de la repetición" aria-valuemin={-500} aria-valuemax={900} aria-valuenow={0} tabIndex={0}>
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line" />
        <div ref={bar} className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent" />
        {[
          [0, 'contacto'],
          [peak, 'máx. flexión'],
        ].map(([t, l]) => (
          <div key={l as string} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: `${pct(t as number)}%` }}>
            <div className="mx-auto h-11 w-px bg-ink/40" />
            <span className={clsx('eyebrow absolute top-12 whitespace-nowrap !text-[10px]', l === 'contacto' ? 'right-1' : 'left-1')}>{l}</span>
          </div>
        ))}
        <div ref={knob} className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent shadow-[0_0_0_4px_var(--accent-soft)]" />
      </div>
      <span ref={txt} className="tnum w-20 text-right font-mono text-sm text-ink-2" />
      <div className="hidden gap-1 sm:flex">
        <Button variant="ghost" onClick={() => modo(0, peak, 0.22)}>
          Contacto → máx.
        </Button>
        <Button variant="ghost" onClick={() => modo(-0.5, 0.9, 0.35)}>
          Completo
        </Button>
      </div>
    </div>
  )
}

function Medidor({ it }: { it: Item }) {
  // barra simple valor vs. meta (no es una gráfica: un solo número y su meta)
  if (it.valor == null || it.tipo === 'doble' || it.id === 'rigidez' || it.id === 'apoyo') return null
  const mayor = it.tipo === 'mayor'
  const max = Math.max(it.meta * 1.6, it.valor * 1.1, 1)
  const p = Math.max(2, Math.min(100, (it.valor / max) * 100))
  const m = (it.meta / max) * 100
  return (
    <div className="mt-4">
      <div className="relative h-2.5 rounded-full bg-surface-2">
        <div className="absolute inset-y-0 rounded-full" style={mayor ? { left: `${m}%`, right: 0, background: 'var(--ok-soft)' } : { left: 0, width: `${m}%`, background: 'var(--ok-soft)' }} />
        <motion.div initial={{ width: 0 }} animate={{ width: `${p}%` }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.3 }} className="absolute inset-y-0 left-0 rounded-full" style={{ background: estadoVar(it.estado) }} />
        <div className="absolute -top-1.5 h-5.5 w-0.5 bg-ink" style={{ left: `${m}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-xs text-muted">
        <span>
          tú: <b className="text-ink">{fmt(it.valor, it.unidad)}</b>
        </span>
        <span>
          meta: {mayor ? '≥' : '<'} {fmt(it.meta, it.unidad)}
        </span>
      </div>
    </div>
  )
}

export default function Resultado() {
  const { id } = useParams()
  const nav = useNavigate()
  const pro = useApp((s) => s.proToken)
  const [d, setD] = useState<SaltoDetalle | null>(null)
  const [ref_, setRef] = useState<Referencia | null>(null)
  const [err, setErr] = useState('')
  const [why, setWhy] = useState<Item | null>(null)
  const [detalle, setDetalle] = useState(false)
  const [vista, setVista] = useState<Vista>('lateral')
  const clock = useRef<ReplayClock>(newClock(0, 0.2, 0.22))
  const mirror = useRef(0)

  useEffect(() => {
    setD(null)
    api.get<SaltoDetalle>(`/api/saltos/${id}`).then(setD).catch((e) => setErr(e.message))
    api.get<Referencia>('/api/referencia').then(setRef).catch(() => {})
  }, [id])
  const peak = useMemo(() => (d ? peakTime(d.serie) : 0.2), [d])
  useEffect(() => {
    // por defecto: transición contacto → máxima flexión, con pausa en el pico
    Object.assign(clock.current, { from: -0.08, to: peak, t: -0.08, speed: 0.22, hold: 1.4, loop: true, playing: true })
  }, [peak])

  if (err) return <p className="p-10 text-bad">{err}</p>
  if (!d) return <div className="p-10 text-muted">Cargando resultado…</div>
  const r = d.resultado
  const est = CAT_ESTADO[r.categoria]
  const m = r.metricas
  const apoyo = r.items.find((i) => i.id === 'apoyo')

  return (
    <div className="mx-auto max-w-[1500px] px-6 pb-20 pt-8 lg:px-10" data-testid="resultado">
      <div className="no-print mb-6 flex items-center gap-3">
        <Button variant="quiet" onClick={() => nav(r.banco ? '/banco' : '/evaluar')}>
          <ArrowLeft className="size-4" /> {r.banco ? 'Banco de pruebas' : 'Evaluación'}
        </Button>
        <span className="eyebrow">
          {d.atleta?.nombre} · salto {d.numero} de {d.total} · {new Date(d.fecha).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
          {d.escenario ? ` · demo: ${d.escenario}` : ''}
        </span>
        <div className="ml-auto flex gap-2">
          {pro && (
            <Button variant="ghost" onClick={() => window.print()}>
              Exportar PDF
            </Button>
          )}
          {!r.banco && (
            <Button variant="ghost" onClick={() => nav('/progreso')}>
              Sesión y progreso <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {!r.banco && (r.sensores?.faltan.length ?? 0) > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl bg-mid-soft p-4 text-mid" data-testid="aviso-sensores">
          <MarcaEstado estado="pendiente" />
          <p className="text-ink-2">
            <b className="text-mid">Sin IMU de {r.sensores!.faltan.join(', ')}.</b> {(() => {
              const t = r.sensores!.texto.replace(/^Sin IMU de [^:]+: /, '')
              return t.charAt(0).toUpperCase() + t.slice(1)
            })()}
          </p>
        </div>
      )}

      {r.banco && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent-soft p-4" data-testid="aviso-banco">

          <p className="text-ink-2">
            <b className="text-ink">Prueba de banco, sin atleta.</b> {r.banco.texto}
          </p>
        </div>
      )}

      {r.confianza !== 'alta' && (
        <div className={clsx('mb-6 flex items-center gap-3 rounded-2xl p-4', r.confianza === 'baja' ? 'bg-bad-soft text-bad' : 'bg-mid-soft text-mid')} data-testid="aviso-confianza">
          <MarcaEstado estado={r.confianza === 'baja' ? 'no' : 'parcial'} />
          <p className="font-semibold">{r.confianza === 'baja' ? 'Este salto no se pudo medir bien; repítelo.' : 'Medición con confianza media.'}</p>
          <p className="text-ink-2">{r.motivos_confianza.join(' ')}</p>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[380px_minmax(0,1fr)]">
        {/* Columna del índice */}
        <aside className="flex flex-col gap-8">
          <div className="flex flex-col items-center rounded-[32px] border border-line bg-surface p-8 text-center">
            <p className="eyebrow mb-4">Índice de técnica</p>
            <IndexRing value={r.indice} estado={est} size={250} />
            <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 }} className="display mt-5 text-5xl" style={{ color: estadoVar(est) }} data-testid="categoria">
              {r.categoria}
            </motion.p>
            <p className="mt-2 text-ink-2">
              Aterrizaje <b className="text-ink">{r.rigidez ?? '—'}</b> · confianza {r.confianza}
            </p>
            <p className="mt-1 font-mono text-xs text-muted">
              índice 0 – 100 · {m.vuelo_ms != null ? `vuelo ${m.vuelo_ms} ms` : ''}
            </p>
            {r.avisos
              .filter((a) => a.tipo === 'asimetria')
              .map((a) => (
                <p key={a.tipo} className="mt-4 rounded-xl bg-mid-soft px-3 py-2 text-sm font-semibold text-mid" data-testid="aviso-asimetria">
                  {a.texto}
                </p>
              ))}
          </div>

          <div className="rounded-[32px] border border-line bg-surface p-6">
            <h3 className="display-cond text-2xl">Plantillas</h3>
            <p className="eyebrow mt-1">carga en × la carga de pie (relativa, sin calibrar)</p>
            <div className="mx-auto mt-3 max-w-[300px]">
              <Footprints serie={d.serie} clock={mirror} ordenMs={(m.antepie_a_talon_ms as number) ?? null} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-surface-2 p-3">
                <dt className="text-muted">Reparto izq. / der.</dt>
                <dd className="display-cond tnum text-xl">
                  {fmt(m.carga_izquierda_pct as number)} / {fmt(100 - ((m.carga_izquierda_pct as number) ?? 50))} %
                </dd>
              </div>
              <div className="rounded-xl bg-surface-2 p-3">
                <dt className="text-muted">Orden de apoyo</dt>
                <dd className="display-cond text-xl">{apoyo?.estado === 'ok' ? 'Antepié → talón' : apoyo?.estado === 'parcial' ? 'Pie plano' : 'Talón primero'}</dd>
              </div>
              <div className="col-span-2 rounded-xl bg-surface-2 p-3">
                <dt className="text-muted">Carga de impacto (pico)</dt>
                <dd className="display-cond tnum text-xl">
                  {fmt(m.carga_pico_rel as number)}× <span className="text-sm font-normal text-muted">la carga de pie (estimada, sin calibrar)</span>
                </dd>
              </div>
            </dl>
          </div>
        </aside>

        {/* Comparación + acciones */}
        <section className="flex min-w-0 flex-col gap-8">
          <div className="overflow-hidden rounded-[32px] border border-line bg-surface">
            <div className="relative h-[min(62vh,620px)] min-h-[420px]">
              <Stage vista={vista} zoom={vista === 'frontal' ? 1.05 : 1.1} focusY={0.8} className="absolute inset-0" cajon={(r.modo_salto ?? 'cajon') === 'cajon'}>
                <Comparacion d={d} ref_={ref_} clock={clock} mirror={mirror} />
              </Stage>
              <div className="absolute left-5 top-5 flex flex-wrap gap-3 text-sm">
                <span className="flex items-center gap-2 rounded-full bg-surface/80 px-3 py-1.5 backdrop-blur">
                  <span className="h-3 w-5 rounded-sm bg-ink-2" /> Tú
                </span>
                <span className="flex items-center gap-2 rounded-full bg-surface/80 px-3 py-1.5 backdrop-blur">
                  <span className="h-3 w-5 rounded-sm border border-accent bg-accent-soft shadow-[0_0_8px_var(--accent)]" /> Referencia
                </span>
                <span className="flex items-center gap-2 rounded-full bg-surface/80 px-3 py-1.5 backdrop-blur">
                  <span className="inline-block h-3 w-5 rounded-sm" style={{ background: 'repeating-linear-gradient(45deg, var(--accent) 0 2px, transparent 2px 5px)' }} /> Pierna izq. estimada
                </span>
              </div>
              <div className="absolute right-5 top-5 flex gap-1 rounded-full bg-surface/80 p-1 backdrop-blur">
                {(['lateral', 'frontal', 'orbital'] as const).map((v) => (
                  <button key={v} onClick={() => setVista(v)} className={clsx('rounded-full px-3 py-1.5 text-sm font-medium capitalize', vista === v ? 'bg-ink text-bg' : 'text-ink-2')}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="border-t border-line px-6 pb-9 pt-5">
              <Timeline clock={clock} mirror={mirror} peak={peak} />
            </div>
          </div>

          <div>
            <div className="mb-4 flex items-baseline gap-3">
              <h2 className="display text-4xl">{r.acciones.length ? 'Qué corregir' : 'Nada urgente que corregir'}</h2>
              <span className="eyebrow">priorizado por impacto</span>
            </div>
            <div className="grid gap-4 xl:grid-cols-3" data-testid="acciones">
              {r.acciones.map((a, i) => (
                <motion.article key={a.id} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 + i * 0.12, duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="flex flex-col rounded-[28px] border border-line bg-surface p-6" data-testid="accion">
                  <div className="flex items-center justify-between">
                    <span className="display text-5xl text-line-2">{i + 1}</span>
                    <EstadoBadge estado={a.estado} />
                  </div>
                  <p className="eyebrow mt-4">{a.nombre}</p>
                  <p className="mt-1 text-[22px] font-semibold leading-snug">{a.mensaje}</p>
                  <Medidor it={a} />
                  <button onClick={() => setWhy(a)} className="mt-auto flex items-center gap-1.5 self-start pt-5 font-semibold text-accent hover:underline" data-testid="porque">
                    ¿Por qué?
                  </button>
                </motion.article>
              ))}
            </div>
          </div>

          {r.fortalezas.length > 0 && (
            <div className="rounded-[28px] border border-ok/30 bg-ok-soft p-6">
              <h3 className="flex items-center gap-2 font-semibold text-ok">
                Lo que hiciste bien
              </h3>
              <ul className="mt-3 grid gap-2 md:grid-cols-3">
                {r.fortalezas.map((f) => (
                  <li key={f.id} className="flex gap-2 text-lg leading-snug">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ok" />
                    {f.mensaje}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-[28px] border border-line bg-surface">
            <button onClick={() => setDetalle(!detalle)} className="flex w-full items-center justify-between p-6 text-left">
              <span className="display-cond text-2xl">Resultado por ítem</span>
              <ChevronDown className={clsx('size-6 transition', detalle && 'rotate-180')} />
            </button>
            {detalle && (
              <div className="px-6 pb-6">
                <table className="w-full text-left">
                  <thead className="eyebrow">
                    <tr className="border-b border-line">
                      <th className="py-2 font-normal">LESS</th>
                      <th className="font-normal">Variable</th>
                      <th className="font-normal">Tú</th>
                      <th className="font-normal">Meta</th>
                      <th className="font-normal">Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((it) => (
                      <tr key={it.id} className="border-b border-line/60">
                        <td className="py-3 font-mono text-sm text-muted">{it.item}</td>
                        <td className="font-medium">{it.nombre}</td>
                        <td className="tnum font-mono">{it.id === 'rigidez' ? it.etiqueta : fmt(it.valor, it.unidad)}</td>
                        <td className="tnum font-mono text-muted">{it.id === 'rigidez' ? 'suave · puntaje 0 – 1' : `${it.tipo === 'menor' ? '<' : '≥'} ${fmt(it.meta, it.unidad)}`}</td>
                        <td>
                          <EstadoBadge estado={it.estado} />
                        </td>
                        <td className="text-right">
                          <button onClick={() => setWhy(it)} className="rounded-full p-1.5 text-muted hover:text-accent" aria-label={`¿Por qué? ${it.nombre}`}>
                            <span className="font-mono text-sm">¿?</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h4 className="eyebrow mt-6">No disponible con este hardware</h4>
                <ul className="mt-2 grid gap-2 md:grid-cols-2">
                  {r.no_disponible.map((n) => (
                    <li key={n.nombre} className="rounded-xl bg-surface-2 p-3 text-sm">
                      <b>{n.nombre}:</b> <span className="text-ink-2">{n.motivo}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Disclaimer text={r.aviso} />
          <p className="-mt-6 text-sm text-muted">Índice inspirado en LESS (Padua et al., 2009) con los ítems medibles; no es un índice de riesgo de lesión. Reglas v{r.version_reglas}.</p>
        </section>
      </div>

      <Sheet open={!!why} onOpenChange={(o) => !o && setWhy(null)} title={why ? `¿Por qué? · ${why.nombre}` : ''}>
        {why && (
          <div data-testid="porque-dialogo">
            <EstadoBadge estado={why.estado} />
            <p className="mt-4 text-lg leading-relaxed text-ink-2">{why.porque}</p>
            <Medidor it={why} />
            <p className="mt-6 rounded-xl bg-surface-2 p-4 font-mono text-sm text-ink-2">
              <span className="eyebrow block">Fuente</span>
              {why.fuente}
            </p>
            <p className="mt-4 text-sm text-muted">
              Referencias completas en plataforma/docs/ciencia.md.
            </p>
          </div>
        )}
      </Sheet>
      <span className="hidden">{ESTADO.ok.label}</span>
    </div>
  )
}
