import clsx from 'clsx'
import { ArrowRight } from 'lucide-react'
import { ModoSaltoToggle, useModoSalto } from '../components/ModoSalto'
import { Cargando, MarcaEstado } from '../components/marks'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button, inputCls } from '../components/ui'
import { IMU_INFO } from '../lib/banco'
import { api } from '../lib/api'
import { frame } from '../lib/live'
import { useApp, useLive } from '../lib/store'
import { useFrame } from '@react-three/fiber'
import { Athlete, newJoints } from '../three/Athlete'
import { emptyPose, poseFromFrame } from '../three/pose'
import { FloorPressure, Stage } from '../three/Stage'

const FUENTES = [
  { id: 'demo', titulo: 'Demostración', desc: 'Gemelo digital con el firmware real. Sin hardware.', tag: 'gemelo · 100 Hz' },
  { id: 'usb', titulo: 'ESP32 por USB', desc: 'Plantillas e IMU reales del prototipo.', tag: 'USB · 921 600 baud' },
  { id: 'wokwi', titulo: 'Wokwi', desc: 'Simulación del circuito en VS Code.', tag: 'rfc2217 · :4000' },
] as const

function LivePose({ scan }: { scan: React.MutableRefObject<number | null> }) {
  const pose = useRef(emptyPose())
  const joints = useRef(newJoints())
  const loads = useRef<number[]>([0, 0, 0, 0])
  useFrame(() => {
    if (frame.current) {
      poseFromFrame(frame.current, pose.current)
      loads.current = frame.current.fsr
    }
  })
  return (
    <>
      <Athlete pose={pose} joints={joints} scan={scan} />
      <FloorPressure loads={loads} joints={joints} />
    </>
  )
}

function Paso({ n, titulo, activo, hecho, children }: { n: number; titulo: string; activo: boolean; hecho: boolean; children?: React.ReactNode }) {
  return (
    <section className={clsx('relative border-l-2 pb-10 pl-8 transition-colors', hecho ? 'border-ok' : activo ? 'border-accent' : 'border-line')}>
      <span className={clsx('absolute -left-[17px] top-0 grid size-8 place-items-center rounded-full border-2 text-sm font-bold transition', hecho ? 'border-ok bg-ok text-bg' : activo ? 'border-accent bg-bg text-accent' : 'border-line bg-bg text-muted')}>
        {n}
      </span>
      <h2 className={clsx('display-cond text-[28px] leading-8', !activo && !hecho && 'text-muted')}>{titulo}</h2>
      <AnimatePresence initial={false}>
        {activo && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
            <div className="pt-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

type SensorEstado = boolean | null | 'pendiente'

function Sensor({ label, ok, detalle, delay }: { label: string; ok: SensorEstado; detalle: string; delay: number }) {
  const warn = ok === 'pendiente'
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className={clsx('flex items-center gap-3 rounded-2xl border p-3.5', ok === null ? 'border-line' : warn ? 'border-mid/40 bg-mid-soft' : ok ? 'border-ok/40 bg-ok-soft' : 'border-bad/40 bg-bad-soft')} data-testid="sensor" data-estado={String(ok)}>
      <span className="grid size-9 place-items-center text-muted">{ok === null ? <Cargando /> : <MarcaEstado estado={warn ? 'pendiente' : ok ? 'ok' : 'no'} className="size-7" />}</span>
      <span className="flex-1 leading-tight">
        <span className="block font-semibold">{label}</span>
        <span className="font-mono text-xs text-muted">{detalle}</span>
      </span>
      <span className={clsx('text-sm font-semibold', warn ? 'text-mid' : ok ? 'text-ok' : ok === false ? 'text-bad' : 'text-muted')}>{ok === null ? '…' : warn ? 'Pendiente' : ok ? 'OK' : 'Revisar'}</span>
    </motion.div>
  )
}

export default function Preparar() {
  const modo = useModoSalto()
  const nav = useNavigate()
  const atleta = useApp((s) => s.atleta)
  const st = useLive((s) => s.status)
  const [fuente, setFuente] = useState<string>('demo')
  const [puertos, setPuertos] = useState<string[]>([])
  const [puerto, setPuerto] = useState('')
  const [url, setUrl] = useState('rfc2217://localhost:4000')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [cuenta, setCuenta] = useState<number | null>(null)
  const [taraOk, setTaraOk] = useState(false)
  const scan = useRef<number | null>(null)

  const conectado = st?.estado === 'conectado' && st.fresco
  // IMU opcional (la lumbar, aún sin instalar): si no está conectada no bloquea, solo se avisa
  const imuPendiente = (id: string, i: { ok: boolean; ausente?: boolean }) => !i.ok && !!i.ausente && !!IMU_INFO.find((m) => m.id === id)?.opcional
  const sensoresOk = !!st && st.fsr.length === 4 && st.fsr.every((s) => s.ok) && st.imu.every((s) => s.ok || imuPendiente(s.id, s)) && st.hz > 40
  const paso = !conectado ? 1 : !taraOk ? (sensoresOk ? 3 : 2) : 4

  useEffect(() => {
    if (fuente === 'usb')
      api.get<{ puertos: string[]; sugerido: string | null }>('/api/puertos').then((r) => {
        setPuertos(r.puertos)
        setPuerto(r.sugerido ?? r.puertos[0] ?? '')
      })
  }, [fuente])

  // barrido del atleta mientras se verifican los sensores
  useEffect(() => {
    if (paso !== 2 && paso !== 3) {
      scan.current = null
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = () => {
      const k = ((performance.now() - t0) / 1800) % 1
      scan.current = 0.05 + 1.85 * (k < 0.5 ? k * 2 : 2 - k * 2)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [paso])

  if (!atleta) return <Navigate to="/" replace />

  const conectar = async () => {
    setBusy(true)
    setErr('')
    setTaraOk(false)
    try {
      await api.post('/api/conectar', { fuente, puerto: fuente === 'usb' ? puerto : undefined, url: fuente === 'wokwi' ? url : undefined })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const tara = async () => {
    setErr('')
    for (const n of [3, 2, 1]) {
      setCuenta(n)
      await new Promise((r) => setTimeout(r, 900))
    }
    setCuenta(0)
    try {
      const r = await api.post<{ ok: boolean }>('/api/tara')
      if (!r.ok) throw new Error('No se detectó quietud. Quédate quieto y repite.')
      setTaraOk(true)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setCuenta(null)
    }
  }

  const empezar = async () => {
    await api.post('/api/sesion', { atleta_id: atleta.id })
    nav('/evaluar')
  }

  const fsrName: Record<string, string> = { P1_H: 'Talón izquierdo', P1_F: 'Antepié izquierdo', P2_H: 'Talón derecho', P2_F: 'Antepié derecho' }
  const imuName: Record<string, string> = { T: 'Muslo derecho', P: 'Pierna derecha', L: 'Lumbar' }

  return (
    <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="px-6 py-10 lg:px-16">
        <p className="eyebrow">Preparación guiada · {atleta.nombre}</p>
        <h1 className="display mb-10 mt-3 text-5xl">Listos en 3 pasos</h1>

        <Paso n={1} titulo="Conecta el dispositivo" activo={paso === 1} hecho={paso > 1}>
          <div className="grid gap-3 sm:grid-cols-3">
            {FUENTES.map((f) => (
              <button key={f.id} onClick={() => setFuente(f.id)} className={clsx('flex flex-col items-start gap-3 rounded-2xl border p-4 text-left transition', fuente === f.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-2')} data-testid={`fuente-${f.id}`}>
                <span className={clsx('font-mono text-[11px] uppercase tracking-[0.12em]', fuente === f.id ? 'text-accent' : 'text-muted')}>{f.tag}</span>
                <span>
                  <span className="block font-semibold">{f.titulo}</span>
                  <span className="text-sm leading-snug text-muted">{f.desc}</span>
                </span>
              </button>
            ))}
          </div>
          {fuente === 'usb' && (
            <select className={clsx(inputCls, 'mt-4 w-full')} value={puerto} onChange={(e) => setPuerto(e.target.value)} aria-label="Puerto USB">
              {puertos.length === 0 && <option value="">No se encontró ningún ESP32 (¿cable de datos?)</option>}
              {puertos.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          )}
          {fuente === 'wokwi' && <input className={clsx(inputCls, 'mt-4 w-full font-mono text-sm')} value={url} onChange={(e) => setUrl(e.target.value)} aria-label="URL de Wokwi" />}
          <Button size="lg" className="mt-5" onClick={conectar} disabled={busy} data-testid="conectar">
            {busy ? <Cargando /> : null} Conectar
          </Button>
        </Paso>

        <Paso n={2} titulo="Verifica los sensores" activo={paso === 2 || paso === 3} hecho={paso > 3 || (paso === 3 && sensoresOk)}>
          <p className="mb-4 max-w-lg text-ink-2">Párate sobre las plantillas o, sin atleta, <b className="text-ink">presiona cada una con la mano</b>: se marcan en verde al detectar la carga.</p>
          {st && (
            <div className="grid gap-2 sm:grid-cols-2">
              {st.fsr.map((s, i) => (
                <Sensor key={s.id} label={`Plantilla · ${fsrName[s.id]}`} ok={s.saturado ? false : s.visto === false ? null : s.ok} detalle={s.saturado ? 'saturado: revisar divisor' : s.visto === false ? 'presiónala una vez' : `lectura ${s.crudo}`} delay={i * 0.08} />
              ))}
              {st.imu.map((s, i) => {
                const pend = imuPendiente(s.id, s)
                return <Sensor key={s.id} label={`IMU · ${imuName[s.id]}`} ok={pend ? 'pendiente' : s.ok} detalle={pend ? 'no conectada: el tronco no se evaluará' : s.error ? 'error de comunicación I2C' : `|a| = ${s.g.toFixed(2)} g`} delay={0.32 + i * 0.08} />
              })}
              <Sensor label="Flujo de datos" ok={st.hz > 40} detalle={`${Math.round(st.hz)} Hz · ${st.perdidas} pérdidas`} delay={0.56} />
            </div>
          )}
          {st && !sensoresOk && st.tipo !== 'demo' && (
            <button onClick={() => nav('/banco')} className="mt-3 text-sm font-semibold text-accent underline-offset-4 hover:underline" data-testid="ir-banco">
              ¿Algo en rojo? Diagnostícalo sensor por sensor en el Banco de pruebas →
            </button>
          )}
        </Paso>

        <Paso n={3} titulo="Tara de pie" activo={paso === 3} hecho={paso > 3}>
          <p className="max-w-md text-lg text-ink-2">Párate derecho sobre las plantillas, con el peso repartido, y quédate quieto. Esa postura será el cero de los ángulos.</p>
          <p className="mt-2 max-w-md text-sm text-muted">Sin atleta: deja las IMU quietas en su posición de referencia (eje X hacia arriba, como de pie). Puedes volver a tarar cuando quieras con el botón «Tarar» de arriba.</p>
          <Button size="lg" className="mt-5" onClick={tara} disabled={cuenta !== null} data-testid="tara">
            Iniciar tara
          </Button>
        </Paso>

        <Paso n={4} titulo="¡Todo listo!" activo={paso === 4} hecho={false}>
          <p className="max-w-md text-lg text-ink-2">{modo === 'cajon' ? 'Protocolo: 3 aterrizajes desde el cajón de 30 – 40 cm.' : 'Protocolo: 3 saltos verticales en el sitio, aterrizando en el mismo lugar.'} El sistema analiza cada salto solo.</p>
          <ModoSaltoToggle className="mt-4 self-start !bg-surface-2" />
          <Button size="xl" className="mt-5" onClick={empezar} data-testid="empezar">
            Empezar evaluación <ArrowRight className="size-6" />
          </Button>
        </Paso>
        {err && <p className="mt-2 rounded-xl bg-bad-soft p-3 text-bad">{err}</p>}
      </div>

      <div className="relative min-h-[460px] overflow-hidden lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)]">
        <Stage vista="frontal" zoom={1.05} focusY={0.9}>
          <LivePose scan={scan} />
        </Stage>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-bg to-transparent" />
        <AnimatePresence>
          {cuenta !== null && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 grid place-items-center bg-bg/40 backdrop-blur-[2px]">
              <div className="text-center">
                <p className="display-cond text-3xl">Quédate de pie, quieto</p>
                <AnimatePresence mode="popLayout">
                  <motion.p key={cuenta} initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }} className="display mt-2 text-[180px] text-accent">
                    {cuenta || '·'}
                  </motion.p>
                </AnimatePresence>
                {cuenta === 0 && <p className="text-lg text-ink-2">Midiendo quietud…</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="absolute bottom-6 left-6 flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1.5 text-sm text-ink-2 backdrop-blur">
          <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: 'repeating-linear-gradient(45deg, var(--accent) 0 2px, transparent 2px 5px)' }} />
          Pierna izquierda estimada (sin IMU, en espejo)
        </div>
      </div>
    </div>
  )
}
