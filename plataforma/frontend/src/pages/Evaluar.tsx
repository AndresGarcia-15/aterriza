import { useFrame, useThree } from '@react-three/fiber'
import clsx from 'clsx'
import { ArrowRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button, CAT_ESTADO, ESTADO, estadoVar } from '../components/ui'
import { api } from '../lib/api'
import { IMU_INFO, saltoVirtual } from '../lib/banco'
import { frame, onContacto, onSalto } from '../lib/live'
import { useApp, useLive } from '../lib/store'
import type { Referencia, SaltoEvento } from '../lib/types'
import { AngleArcs } from '../three/AngleArcs'
import { Athlete, newJoints } from '../three/Athlete'
import { emptyPose, loadsAt, poseFromFrame, type ModoSalto } from '../three/pose'
import { RootMotion } from '../three/raiz'
import { ModoSaltoToggle, useModoSalto } from '../components/ModoSalto'
import { Cargando, MarcaPlantilla, MarcaSalto } from '../components/marks'
import { newClock, ReplayDriver } from '../three/Replay'
import { FloorPressure, Shockwave, Stage, type Vista } from '../three/Stage'

type Fase = 'listo' | 'aire' | 'analizando' | 'repeticion' | 'resultado'
/** Atleta en vivo + repetición en cámara lenta con fantasma tras cada salto. */
function Escena({ fase, salto, referencia, onReplayEnd, shock, modo }: { fase: Fase; salto: SaltoEvento | null; referencia: Referencia | null; onReplayEnd: () => void; shock: React.MutableRefObject<{ t: number; k: number; x: number; z: number } | null>; modo: ModoSalto }) {
  const pose = useRef(emptyPose())
  const ghost = useRef(emptyPose())
  const joints = useRef(newJoints())
  const loads = useRef<number[]>([0, 0, 0, 0])
  const raiz = useRef(new RootMotion())
  const clock = useRef(newClock(-0.45, 0.62, 0.3))
  const replaying = fase === 'repeticion'
  const { clock: three } = useThree()

  useEffect(() => raiz.current.reset(modo), [modo])
  useEffect(() => {
    if (replaying) {
      clock.current = { ...newClock(-0.45, 0.62, 0.3), loop: false, hold: 0.6 }
    }
  }, [replaying, salto])

  useEffect(() => {
    if (fase === 'resultado' || fase === 'listo') raiz.current.backToBox(three.elapsedTime)
  }, [fase, three])

  useFrame((st) => {
    if (replaying && salto) {
      loads.current = loadsAt(salto.serie, clock.current.t)
      return
    }
    const f = frame.current
    if (!f) return
    poseFromFrame(f, pose.current)
    loads.current = f.fsr
    raiz.current.update(f, st.clock.elapsedTime, pose.current)
  })

  return (
    <>
      {replaying && salto && <ReplayDriver serie={salto.serie} ghost={referencia?.serie} clock={clock} pose={pose} ghostPose={ghost} onEnd={onReplayEnd} modo={modo} />}
      <Athlete pose={pose} joints={joints} smooth={replaying ? 0 : 24} />
      {replaying && referencia && <Athlete pose={ghost} ghost smooth={0} />}
      {replaying && <AngleArcs joints={joints} pose={pose} metas={{ rodilla: 30, tronco: 10 }} />}
      <FloorPressure loads={loads} joints={joints} />
      <Shockwave trigger={shock} />
    </>
  )
}

function ShockBridge({ shock, onShake }: { shock: React.MutableRefObject<{ t: number; k: number; x: number; z: number } | null>; onShake: React.MutableRefObject<number> }) {
  const { clock, camera } = useThree()
  useEffect(
    () =>
      onContacto(() => {
        shock.current = { t: clock.elapsedTime, k: 1, x: 0, z: 0.03 }
        onShake.current = clock.elapsedTime
      }),
    [clock, shock, onShake],
  )
  // micro-sacudida de cámara proporcional al impacto (100 ms)
  useFrame((st) => {
    const age = st.clock.elapsedTime - onShake.current
    if (age < 0.18) {
      const a = (1 - age / 0.18) * 0.012
      camera.position.y += Math.sin(age * 140) * a
    }
  })
  return null
}

const INSTR: Record<Fase, { titulo: string; sub?: string }> = {
  listo: { titulo: 'Súbete al cajón', sub: '35 cm · déjate caer · aterriza con ambos pies' },
  aire: { titulo: '¡Aterriza!' },
  analizando: { titulo: 'Analizando…', sub: 'Comparando con el aterrizaje de referencia' },
  repeticion: { titulo: 'Repetición', sub: 'cámara lenta · 0,3× · fantasma = referencia' },
  resultado: { titulo: '' },
}

export default function Evaluar() {
  const nav = useNavigate()
  const atleta = useApp((s) => s.atleta)
  const st = useLive((s) => s.status)
  const [fase, setFase] = useState<Fase>('listo')
  const [salto, setSalto] = useState<SaltoEvento | null>(null)
  const [ref, setRef] = useState<Referencia | null>(null)
  const [vista, setVista] = useState<Vista>('lateral')
  const modo = useModoSalto()
  const shock = useRef<{ t: number; k: number; x: number; z: number } | null>(null)
  const shake = useRef(-10)
  const faseRef = useRef(fase)
  faseRef.current = fase

  useEffect(() => {
    api.get<Referencia>('/api/referencia').then(setRef).catch(() => {})
  }, [])
  useEffect(() => onContacto(() => setFase('analizando')), [])
  useEffect(
    () =>
      onSalto((s) => {
        setSalto(s)
        setFase('repeticion')
      }),
    [],
  )
  // fase "aire" a partir de los cuadros en vivo
  useEffect(() => {
    const id = setInterval(() => {
      const f = frame.current
      if (f?.air && f.air_t > 0.04 && f.air_t < 1.5 && (faseRef.current === 'listo' || faseRef.current === 'resultado')) setFase('aire')
      // más de 1,5 s sin carga no es un vuelo: nadie está sobre las plantillas (p. ej. simulando con las manos)
      else if (f?.air && f.air_t >= 1.5 && faseRef.current === 'aire') setFase('listo')
    }, 30)
    return () => clearInterval(id)
  }, [])

  if (!atleta) return <Navigate to="/" replace />
  const ses = st?.sesion
  const conteo = salto?.conteo ?? ses?.conteo ?? 0
  const objetivo = ses?.objetivo ?? 3
  const completo = conteo >= objetivo
  const demo = st?.demo
  const res = salto?.resultado
  const est = res ? CAT_ESTADO[res.categoria] : 'ok'
  const sinConexion = !st || st.estado !== 'conectado'

  const instr = fase === 'listo' && modo === 'sitio' ? { titulo: 'Salta en el sitio', sub: 'salto vertical · aterriza con ambos pies en el mismo lugar' } : INSTR[fase]
  const saltarDemo = (esc?: number) => api.post('/api/demo/saltar', { escenario: esc })
  const real = !!st && st.estado === 'conectado' && st.tipo !== 'demo'
  const imusFaltan = (st?.imu ?? []).filter((i) => i.ausente).map((i) => IMU_INFO.find((m) => m.id === i.id)?.corto.toLowerCase() ?? i.id)

  return (
    <div className="relative h-[100vh] overflow-hidden" data-testid="evaluar">
      <Stage vista={vista} zoom={vista === 'frontal' ? 1.55 : 1.62} focusY={0.72} className="absolute inset-0" cajon={modo === 'cajon'}>
        <Escena fase={fase} salto={salto} referencia={ref} onReplayEnd={() => setFase('resultado')} shock={shock} modo={modo} />
        <ShockBridge shock={shock} onShake={shake} />
      </Stage>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-bg via-bg/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-bg via-bg/70 to-transparent" />

      {/* Protocolo */}
      <div className="absolute left-6 top-24 lg:left-10">
        <p className="eyebrow">{atleta.nombre} · protocolo de caída</p>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="display tnum text-6xl" data-testid="contador">
            {Math.min(conteo, objetivo)}
          </span>
          <span className="display-cond text-2xl text-muted">de {objetivo} saltos válidos</span>
        </div>
        <div className="mt-3 flex gap-1.5">
          {Array.from({ length: objetivo }).map((_, i) => (
            <motion.span key={i} className="h-1.5 w-12 rounded-full" animate={{ backgroundColor: i < conteo ? 'var(--accent)' : 'var(--line-2)' }} />
          ))}
        </div>
      </div>

      {/* Vistas */}
      <div className="absolute right-6 top-24 flex flex-col items-end gap-2 lg:right-10">
        <div className="flex gap-1 rounded-2xl border border-line bg-surface/70 p-1 backdrop-blur" role="group" aria-label="Vista de cámara">
          {(
            [
              ['lateral', 'Lateral'],
              ['frontal', 'Frontal'],
              ['orbital', 'Libre'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} onClick={() => setVista(v)} className={clsx('rounded-xl px-3 py-2 text-sm font-medium transition', vista === v ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink')}>
              {l}
            </button>
          ))}
        </div>
        <ModoSaltoToggle />
      </div>

      {/* Instrucción grande */}
      <AnimatePresence mode="wait">
        {fase !== 'resultado' && (
          <motion.div key={fase} initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -12, filter: 'blur(6px)' }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }} className={clsx('pointer-events-none absolute inset-x-0 text-center', fase === 'repeticion' || fase === 'analizando' ? 'top-24' : 'bottom-28')} data-testid="instruccion">
            <p className={clsx('display', fase === 'aire' && 'text-accent', fase === 'repeticion' || fase === 'analizando' ? 'text-[clamp(2rem,4vw,3.5rem)]' : 'text-[clamp(3rem,7vw,6.5rem)]')}>{sinConexion ? 'Conecta el dispositivo' : completo && fase === 'listo' ? 'Protocolo completo' : instr.titulo}</p>
            {instr.sub && !sinConexion && <p className="mt-3 text-xl text-ink-2">{instr.sub}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tarjeta de resultado */}
      <AnimatePresence>
        {fase === 'resultado' && res && (
          <motion.div initial={{ opacity: 0, y: 40, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30 }} transition={{ type: 'spring', stiffness: 220, damping: 26 }} className="absolute bottom-8 left-1/2 w-[min(920px,calc(100%-3rem))] -translate-x-1/2 rounded-[28px] border border-line bg-surface/85 p-6 shadow-2xl backdrop-blur-xl" data-testid="tarjeta-resultado">
            {res.confianza === 'baja' ? (
              <div className="flex items-center gap-6">

                <div className="flex-1">
                  <p className="display-cond text-3xl">Este salto no se pudo medir bien; repítelo.</p>
                  <p className="text-ink-2">{res.motivos_confianza.join(' ')}</p>
                </div>
                <Button size="lg" onClick={() => setFase('listo')}>
                  Repetir
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-baseline gap-3">
                  <span className="display tnum text-7xl" style={{ color: estadoVar(est) }}>
                    {res.indice}
                  </span>
                  <span>
                    <span className="display-cond block text-3xl">{res.categoria}</span>
                    <span className="eyebrow">índice de técnica · 0 – 100{res.metricas?.vuelo_ms != null ? ` · vuelo ${res.metricas.vuelo_ms} ms` : ''}</span>
                  </span>
                </div>
                <div className="min-w-[260px] flex-1 border-l border-line pl-6">
                  {res.acciones[0] ? (
                    <>
                      <p className="eyebrow mb-1">Lo primero a corregir</p>
                      <p className="text-xl font-semibold leading-snug">{res.acciones[0].mensaje}</p>
                    </>
                  ) : (
                    <>
                      <p className="eyebrow mb-1">Lo hiciste bien</p>
                      <p className="text-xl font-semibold leading-snug">{res.fortalezas[0]?.mensaje}</p>
                    </>
                  )}
                  {res.avisos
                    .filter((a) => a.tipo === 'asimetria')
                    .map((a) => (
                      <p key={a.tipo} className={clsx('mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold', ESTADO.parcial.soft, ESTADO.parcial.color)} data-testid="aviso-asimetria">
                        {a.texto}
                      </p>
                    ))}
                </div>
                <div className="flex gap-2">
                  {salto?.id && (
                    <Button variant="ghost" size="lg" onClick={() => nav(`/salto/${salto.id}`)} data-testid="ver-detalle">
                      Ver detalle
                    </Button>
                  )}
                  {completo ? (
                    <Button size="lg" onClick={() => nav('/progreso')}>
                      Ver sesión <ArrowRight className="size-5" />
                    </Button>
                  ) : (
                    <Button size="lg" onClick={() => setFase('listo')} data-testid="siguiente">
                      Siguiente salto <ArrowRight className="size-5" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hardware real sin atleta: cómo simular un aterrizaje con las manos */}
      {real && fase !== 'resultado' && <ManosPanel virtual={st?.tipo === 'virtual'} habilitado={fase === 'listo'} imusFaltan={imusFaltan} />}

      {/* Controles de demostración */}
      {demo && fase !== 'resultado' && (
        <div className="absolute bottom-8 left-6 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/75 p-2 backdrop-blur lg:left-10" data-testid="demo-controles">
          <span className="eyebrow px-2">Demo</span>
          {Object.entries(demo.escenarios).map(([k, v]) => (
            <button key={k} onClick={() => saltarDemo(Number(k))} disabled={demo.reproduciendo || fase !== 'listo'} className="rounded-xl px-3 py-2 text-sm font-medium text-ink-2 transition hover:bg-surface-2 hover:text-ink disabled:opacity-40" data-testid={`demo-esc-${k}`}>
              {v}
            </button>
          ))}
          <button onClick={() => api.post(`/api/demo/auto?on=${!demo.auto}`)} className={clsx('rounded-xl px-3 py-2 text-sm font-medium', demo.auto ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-surface-2')}>
            Auto
          </button>
        </div>
      )}
      {fase === 'resultado' && res && (
        <div className="pointer-events-none absolute right-10 top-1/2 hidden -translate-y-1/2 xl:block">
          <div className="eyebrow mb-2">Ítems</div>
          <div className="grid grid-cols-1 gap-1">
            {res.items
              .filter((i) => i.estado !== 'no_disponible')
              .map((i) => {
                const e = ESTADO[i.estado]
                return (
                  <span key={i.id} className={clsx('flex items-center gap-2 text-sm', e.color)}>
                    <e.Icon className="size-4" /> <span className="text-ink-2">{i.nombre}</span>
                  </span>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

/** Con el hardware real y sin atleta: guía para simular el aterrizaje con las manos. */
function ManosPanel({ virtual, habilitado, imusFaltan }: { virtual: boolean; habilitado: boolean; imusFaltan: string[] }) {
  const [corriendo, setCorriendo] = useState(false)
  const simular = async () => {
    setCorriendo(true)
    try {
      await saltoVirtual('antepie', false)
    } finally {
      setCorriendo(false)
    }
  }
  return (
    <div className="absolute left-6 top-60 max-w-[420px] rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur lg:left-10" data-testid="manos-panel">
      <p className="eyebrow mb-2 flex items-center gap-2">
        <MarcaPlantilla className="size-4" /> Sin atleta: simula con las manos
      </p>
      <ol className="list-decimal space-y-0.5 pl-5 text-[15px] text-ink-2">
        <li>Presiona las 4 plantillas y mantén 2 s (de pie).</li>
        <li>Suelta todo de golpe (vuelo).</li>
        <li>Presiona primero los antepiés y luego los talones (contacto).</li>
      </ol>
      <p className="mt-2 text-sm text-muted">Mueve las IMU de muslo y pierna para simular la flexión de rodilla. Si los ángulos no parten de 0, usa «Tarar».</p>
      {imusFaltan.length > 0 && (
        <p className="mt-2 inline-flex rounded-full bg-mid-soft px-3 py-1 text-sm font-semibold text-mid" data-testid="aviso-imu-faltante">
          Sin IMU {imusFaltan.join(', ')}: {imusFaltan.includes('lumbar') ? 'el tronco no se evaluará' : 'esos ítems no se evaluarán'}
        </p>
      )}
      {virtual && (
        <Button className="mt-3" onClick={simular} disabled={corriendo || !habilitado} data-testid="simular-virtual">
          {corriendo ? <Cargando /> : <MarcaSalto />} Simular salto (banco virtual)
        </Button>
      )}
    </div>
  )
}
