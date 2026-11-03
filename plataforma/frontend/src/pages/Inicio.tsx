import clsx from 'clsx'
import { ArrowRight } from 'lucide-react'
import { DibujoBanco } from '../components/marks'
import { useModoSalto } from '../components/ModoSalto'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, CAT_ESTADO, estadoVar, Field, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import type { Atleta, Referencia } from '../lib/types'
import { Athlete, newJoints } from '../three/Athlete'
import { emptyPose } from '../three/pose'
import { newClock, ReplayDriver } from '../three/Replay'
import { FloorPressure, Stage } from '../three/Stage'
import { LoadsFrom } from '../three/Replay'

function Hero3D() {
  const [ref, setRef] = useState<Referencia | null>(null)
  const pose = useRef(emptyPose())
  const joints = useRef(newJoints())
  const loads = useRef<number[]>([0, 0, 0, 0])
  const clock = useRef(newClock(-0.55, 0.75, 0.32))
  const mirror = useRef(0)
  const modo = useModoSalto()
  useEffect(() => {
    api.get<Referencia>('/api/referencia').then(setRef).catch(() => {})
  }, [])
  return (
    <Stage vista="lateral" zoom={0.74} focusY={0.78} cajon={modo === 'cajon'}>
      {ref && <ReplayDriver serie={ref.serie} clock={clock} pose={pose} mirror={mirror} modo={modo} />}
      {ref && <LoadsFrom serie={ref.serie} clock={mirror} loads={loads} />}
      <Athlete pose={pose} joints={joints} smooth={0} />
      <FloorPressure loads={loads} joints={joints} />
    </Stage>
  )
}

const empty = { nombre: '', deporte: '', pierna_dominante: 'derecha', estatura_cm: '', masa_kg: '' }

export default function Inicio() {
  const nav = useNavigate()
  const { atleta, setAtleta } = useApp()
  const [lista, setLista] = useState<Atleta[] | null>(null)
  const [nuevo, setNuevo] = useState(false)
  const [f, setF] = useState(empty)
  const [err, setErr] = useState('')

  const load = () => api.get<Atleta[]>('/api/atletas').then(setLista).catch(() => setLista([]))
  useEffect(() => {
    load()
  }, [])
  useEffect(() => {
    if (lista && lista.length === 0) setNuevo(true)
  }, [lista])

  const elegir = (a: Atleta) => {
    setAtleta(a)
    nav('/preparar')
  }
  const crear = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    try {
      const a = await api.post<Atleta>('/api/atletas', {
        nombre: f.nombre.trim(),
        deporte: f.deporte.trim(),
        pierna_dominante: f.pierna_dominante,
        estatura_cm: f.estatura_cm ? Number(f.estatura_cm) : null,
        masa_kg: f.masa_kg ? Number(f.masa_kg) : null,
      })
      setF(empty)
      elegir(a)
    } catch (x) {
      setErr((x as Error).message)
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section className="relative z-10 flex flex-col justify-center px-6 py-12 lg:px-16">
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="eyebrow">
          Evaluación del aterrizaje · 2 plantillas · 3 IMU
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="display mt-4 text-[clamp(3.2rem,7vw,6.4rem)]"
        >
          Aterriza
          <br />
          <span className="text-accent">suave.</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-6 max-w-[34ch] text-xl text-ink-2">
          Salta, aterriza y recibe al instante qué hiciste bien y qué corregir, comparado con un aterrizaje de referencia.
        </motion.p>

        <div className="mt-10 max-w-xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="eyebrow">¿Quién va a saltar?</h2>
            {!nuevo && (
              <Button variant="quiet" onClick={() => setNuevo(true)}>
                + Nuevo atleta
              </Button>
            )}
          </div>
          {nuevo ? (
            <motion.form initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} onSubmit={crear} className="grid grid-cols-2 gap-4 rounded-3xl border border-line bg-surface p-6" data-testid="form-atleta">
              <div className="col-span-2">
                <Field label="Nombre">
                  <input autoFocus required className={inputCls} value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej. Valentina Ríos" />
                </Field>
              </div>
              <Field label="Deporte">
                <input className={inputCls} value={f.deporte} onChange={(e) => setF({ ...f, deporte: e.target.value })} placeholder="Voleibol" />
              </Field>
              <Field label="Pierna dominante">
                <div className="grid h-12 grid-cols-2 rounded-xl border border-line-2 p-1">
                  {['derecha', 'izquierda'].map((p) => (
                    <button type="button" key={p} onClick={() => setF({ ...f, pierna_dominante: p })} className={clsx('rounded-lg text-[15px] font-medium capitalize transition', f.pierna_dominante === p ? 'bg-ink text-bg' : 'text-ink-2')}>
                      {p}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Estatura (cm)">
                <input inputMode="numeric" className={inputCls} value={f.estatura_cm} onChange={(e) => setF({ ...f, estatura_cm: e.target.value.replace(/[^\d.]/g, '') })} placeholder="172" />
              </Field>
              <Field label="Masa (kg)" hint="Normaliza la carga cuando los FSR estén calibrados.">
                <input inputMode="decimal" className={inputCls} value={f.masa_kg} onChange={(e) => setF({ ...f, masa_kg: e.target.value.replace(/[^\d.]/g, '') })} placeholder="64" />
              </Field>
              {err && <p className="col-span-2 text-bad">{err}</p>}
              <div className="col-span-2 mt-2 flex justify-end gap-2">
                {lista && lista.length > 0 && (
                  <Button type="button" variant="quiet" onClick={() => setNuevo(false)}>
                    Cancelar
                  </Button>
                )}
                <Button type="submit" size="lg">
                  Crear y continuar <ArrowRight className="size-5 transition group-hover:translate-x-0.5" />
                </Button>
              </div>
            </motion.form>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="lista-atletas">
              {lista?.map((a, i) => {
                const e = a.ultima_categoria ? CAT_ESTADO[a.ultima_categoria] : null
                return (
                  <motion.li key={a.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>
                    <button
                      onClick={() => elegir(a)}
                      className={clsx('group flex w-full items-center gap-4 rounded-2xl border bg-surface p-4 text-left transition hover:border-ink/30', atleta?.id === a.id ? 'border-accent' : 'border-line')}
                    >
                      <span className="grid size-12 place-items-center rounded-full bg-surface-2 text-lg font-bold">
                        {(a.nombre || '·').slice(0, 1).toUpperCase()}
                      </span>
                      <span className="flex-1">
                        <span className="block text-lg font-semibold">{a.nombre}</span>
                        <span className="text-sm text-muted">
                          {[a.deporte, `pierna ${a.pierna_dominante}`, `${a.saltos ?? 0} saltos`].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {a.ultimo_indice != null && e && (
                        <span className="text-right">
                          <span className="display tnum block text-3xl" style={{ color: estadoVar(e) }}>
                            {a.ultimo_indice}
                          </span>
                          <span className="eyebrow">último</span>
                        </span>
                      )}
                      <ArrowRight className="size-5 text-muted transition group-hover:translate-x-1 group-hover:text-ink" />
                    </button>
                  </motion.li>
                )
              })}
            </ul>
          )}
          <button onClick={() => nav('/banco')} className="group mt-6 flex w-full items-center gap-4 rounded-2xl border border-dashed border-line-2 p-4 text-left transition hover:border-accent" data-testid="cta-banco">
            <DibujoBanco className="text-ink-2" />
            <span className="flex-1">
              <span className="block text-lg font-semibold">Sin atleta todavía: prueba el hardware</span>
              <span className="text-sm text-muted">Banco de pruebas: sensores en vivo, prueba guiada y un salto simulado con las manos.</span>
            </span>
            <ArrowRight className="size-5 text-muted transition group-hover:translate-x-1 group-hover:text-ink" />
          </button>
        </div>
      </section>
      <section className="relative min-h-[420px] overflow-hidden lg:min-h-0">
        <Hero3D />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent" />
        <div className="pointer-events-none absolute left-0 top-0 hidden h-full w-40 bg-gradient-to-r from-bg to-transparent lg:block" />
        <div className="absolute bottom-8 right-8 flex items-center gap-5 text-sm text-ink-2">
          <span className="flex items-center gap-2">
            <span className="h-3 w-5 rounded-sm bg-ink-2/80" /> Atleta
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-5 rounded-sm border border-accent bg-accent-soft shadow-[0_0_10px_var(--accent)]" /> Referencia
          </span>
        </div>
      </section>
    </div>
  )
}
