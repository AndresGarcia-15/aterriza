/**
 * Banco de pruebas: el sistema REAL sin atleta.
 *  1. Sensores en vivo  · cada FSR e IMU con su lectura, estado y pistas de cableado.
 *  2. Prueba guiada     · checklist que detecta pines flotantes, cables cruzados,
 *                         saturación del divisor e IMU sin señal; guarda un reporte.
 *  3. Salto con las manos · presiona, suelta y vuelve a presionar las plantillas:
 *                         pasa por el MISMO detector y motor de reglas que un atleta.
 *  4. Historial         · reportes de la prueba guiada y saltos de banco.
 * A la derecha, la representación 3D: el hardware sobre la mesa o el atleta.
 */
import { useFrame, useThree } from '@react-three/fiber'
import clsx from 'clsx'
import { ArrowRight } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FOOT } from '../components/Footprints'
import { Cargando, MarcaCero, MarcaEstado, TrazoSenal } from '../components/marks'
import { ModoSaltoToggle, useModoSalto } from '../components/ModoSalto'
import { Button, CAT_ESTADO, ESTADO, estadoVar, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { FSR_INFO, IMU_INFO, IMU_MODELO, PRESS_RAW, SAT_RAW, flagList, fsrEstado, hwNow, saltoVirtual, tilt, virtual, volts, type Aterrizaje } from '../lib/banco'
import { frame, onContacto, onSalto } from '../lib/live'
import { useLive } from '../lib/store'
import type { Hardware, SaltoEvento } from '../lib/types'
import { Athlete, newJoints } from '../three/Athlete'
import { BenchRig } from '../three/BenchRig'
import { FichaPanel, useExplora } from '../three/Explorador'
import { emptyPose, poseFromFrame, type ModoSalto } from '../three/pose'
import { RootMotion } from '../three/raiz'
import { SensoresCuerpo } from '../three/SensoresCuerpo'
import { FloorPressure, Shockwave, Stage } from '../three/Stage'

type Tab = 'vivo' | 'guiada' | 'salto' | 'historial'
type Rep = 'hardware' | 'atleta'

/** Re-render periódico con el último hardware recibido (la escena 3D no lo necesita). */
function useHw(hz = 12): Hardware | null {
  const [hw, setHw] = useState<Hardware | null>(null)
  useEffect(() => {
    const id = setInterval(() => setHw(hwNow()), 1000 / hz)
    return () => clearInterval(id)
  }, [hz])
  return hw
}

const toneCls = { muted: 'text-muted', accent: 'text-accent', bad: 'text-bad' } as const

// ====================================================================== conexión
const FUENTES = [
  { id: 'usb', titulo: 'ESP32 por USB', desc: 'Tu placa con los sensores en la mesa.', tag: 'USB · 921 600 baud' },
  { id: 'wokwi', titulo: 'Wokwi', desc: 'El circuito simulado en VS Code.', tag: 'rfc2217 · :4000' },
  { id: 'virtual', titulo: 'Banco virtual', desc: 'Sensores simulados que manejas con el mouse.', tag: 'mouse · teclado' },
] as const

function Conexion() {
  const st = useLive((s) => s.status)
  const [fuente, setFuente] = useState<string>('usb')
  const [puertos, setPuertos] = useState<string[]>([])
  const [puerto, setPuerto] = useState('')
  const [url, setUrl] = useState('rfc2217://localhost:4000')
  const [conLumbar, setConLumbar] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const conectado = st?.estado === 'conectado'
  const esDemo = conectado && st?.tipo === 'demo'

  useEffect(() => {
    if (fuente === 'usb')
      api
        .get<{ puertos: string[]; sugerido: string | null }>('/api/puertos')
        .then((r) => {
          setPuertos(r.puertos)
          setPuerto(r.sugerido ?? r.puertos[0] ?? '')
        })
        .catch(() => {})
  }, [fuente])

  const conectar = async () => {
    setBusy(true)
    setErr('')
    try {
      await api.post('/api/conectar', {
        fuente,
        puerto: fuente === 'usb' ? puerto || undefined : undefined,
        url: fuente === 'wokwi' ? url : undefined,
        imu: fuente === 'virtual' ? { T: true, P: true, L: conLumbar } : undefined,
      })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (conectado && !esDemo)
    return (
      <div className={clsx('flex flex-wrap items-center gap-4 rounded-2xl border border-line border-l-2 bg-surface p-3 pl-4', st.fresco ? 'border-l-accent' : 'border-l-mid')} data-testid="banco-conectado">
        <TrazoSenal className="h-6 w-14" />
        <span className="flex-1 leading-tight">
          <span className="block font-semibold">{st.tipo === 'virtual' ? 'Banco virtual' : st.tipo === 'wokwi' ? 'Wokwi' : 'ESP32 por USB'}</span>
          <span className="font-mono text-xs text-muted">
            {st.fresco ? `${Math.round(st.hz)} Hz · ${st.perdidas} muestras perdidas` : 'conectado, sin datos todavía'} · {st.fuente}
          </span>
        </span>
        <Button variant="quiet" onClick={() => api.post('/api/desconectar')}>
          Desconectar
        </Button>
      </div>
    )

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      {esDemo && <p className="mb-3 rounded-xl bg-mid-soft px-3 py-2 text-sm text-mid">Está conectada la demostración con atleta virtual. Para el banco usa tu ESP32 o el banco virtual.</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        {FUENTES.map((f) => (
          <button key={f.id} onClick={() => setFuente(f.id)} className={clsx('flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition', fuente === f.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-2')} data-testid={`banco-fuente-${f.id}`}>
            <span className={clsx('font-mono text-[10px] uppercase tracking-[0.12em]', fuente === f.id ? 'text-accent' : 'text-muted')}>{f.tag}</span>
            <span className="block text-[15px] font-semibold leading-tight">{f.titulo}</span>
            <span className="text-xs leading-tight text-muted">{f.desc}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {fuente === 'usb' && (
          <select className={clsx(inputCls, 'h-11 min-w-0 flex-1 text-[15px]')} value={puerto} onChange={(e) => setPuerto(e.target.value)} aria-label="Puerto USB">
            {puertos.length === 0 && <option value="">No se encontró ningún ESP32 (¿cable de datos?)</option>}
            {puertos.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        )}
        {fuente === 'wokwi' && <input className={clsx(inputCls, 'h-11 min-w-0 flex-1 font-mono text-sm')} value={url} onChange={(e) => setUrl(e.target.value)} aria-label="URL de Wokwi" />}
        {fuente === 'virtual' && (
          <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={conLumbar} onChange={(e) => setConLumbar(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Simular también la IMU lumbar <span className="text-muted">(sin marcar = como el prototipo hoy: muslo y pierna)</span>
          </label>
        )}
        <Button onClick={conectar} disabled={busy} data-testid="banco-conectar">
          {busy && <Cargando />} Conectar
        </Button>
      </div>
      {err && <p className="mt-3 rounded-xl bg-bad-soft p-3 text-sm text-bad">{err}</p>}
    </div>
  )
}

// ====================================================================== 1. sensores en vivo
function Spark({ values, max = 4095, sat }: { values: number[]; max?: number; sat?: number }) {
  const w = 120
  const h = 30
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - (Math.min(v, max) / max) * h}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full" preserveAspectRatio="none" aria-hidden>
      {sat !== undefined && <line x1="0" x2={w} y1={h - (sat / max) * h} y2={h - (sat / max) * h} stroke="var(--bad)" strokeDasharray="3 3" strokeWidth="0.8" />}
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function useHistory(hw: Hardware | null, n = 80) {
  const h = useRef<number[][]>([[], [], [], []])
  if (hw) hw.raw.forEach((r, i) => (h.current[i] = [...h.current[i].slice(-(n - 1)), r]))
  return h.current
}

function Vivo({ hw }: { hw: Hardware | null }) {
  const st = useLive((s) => s.status)
  const hist = useHistory(hw)
  const [tara, setTara] = useState<'' | 'esperando' | 'ok' | 'error'>('')
  const f = frame.current?.flags ?? 0
  const flags = hw ? flagList(f) : []

  const hacerTara = async () => {
    setTara('esperando')
    try {
      const r = await api.post<{ ok: boolean }>('/api/tara')
      setTara(r.ok ? 'ok' : 'error')
    } catch {
      setTara('error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="eyebrow mb-3">Plantillas · 4 FSR 402 (divisor de voltaje al ADC)</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {FSR_INFO.map((s, i) => {
            const raw = hw?.raw[i] ?? 0
            const e = fsrEstado(raw)
            return (
              <div key={s.id} className={clsx('rounded-2xl border p-3.5 transition-colors', raw >= SAT_RAW ? 'border-bad/50 bg-bad-soft' : raw > PRESS_RAW ? 'border-accent/50 bg-accent-soft' : 'border-line bg-surface')} data-testid="banco-fsr">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{s.nombre}</span>
                  <span className={clsx('text-sm font-semibold', toneCls[e.tono])}>{hw ? e.label : ''}</span>
                </div>
                <div className="mt-1 flex items-baseline gap-2 whitespace-nowrap">
                  <span className="display tnum text-[34px]" data-testid={`banco-fsr-raw-${i}`}>
                    {hw ? raw : '—'}
                  </span>
                  <span className="font-mono text-xs text-muted">cuentas · ≈ {volts(raw).toFixed(2).replace('.', ',')} V</span>
                  <span className="ml-auto font-mono text-xs text-muted">GPIO {s.gpio}</span>
                </div>
                <Spark values={hist[i]} sat={SAT_RAW} />
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-sm text-muted">Unidad: cuentas del ADC de 12 bits (0 – 4095 ≈ 0 – 3,3 V en el pin). En reposo debe leer cerca de 0; presionado con un dedo sube. Si llega a 4000 cuentas (línea roja) el divisor satura: con FSR 402 usa una resistencia de 1 kΩ.</p>
      </section>

      <section>
        <h3 className="eyebrow mb-3">Sensores de movimiento · 3 IMU {IMU_MODELO}</h3>
        <div className="grid gap-3">
          {IMU_INFO.map((m, n) => {
            const ok = !!hw?.ok?.[n]
            const a = hw?.a?.[n] ?? 0
            const g = hw?.g?.[n] ?? 0
            const t = tilt(hw?.q?.[n])
            const pend = !!hw && !ok && m.opcional && a < 0.05
            return (
              <div key={m.id} className={clsx('flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border p-3.5', !hw ? 'border-line' : ok ? 'border-ok/40 bg-ok-soft' : pend ? 'border-mid/40 bg-mid-soft' : 'border-bad/40 bg-bad-soft')} data-testid="banco-imu">
                <MarcaEstado estado={!hw ? 'no_disponible' : ok ? 'ok' : pend ? 'pendiente' : 'no'} className="size-7" />
                <span className="min-w-[150px] flex-1 leading-tight">
                  <span className="block font-semibold">IMU · {m.nombre}</span>
                  <span className="font-mono text-xs text-muted">
                    SDA {m.sda} / SCL {m.scl} · {m.bus}
                  </span>
                </span>
                {hw && ok && (
                  <span className="grid grid-cols-3 gap-5 font-mono text-sm">
                    <span>
                      <span className="eyebrow block !text-[10px]">|a| · g</span>
                      <span className={clsx(Math.abs(a - 1) > 0.1 && 'text-mid')}>{a.toFixed(2)} g</span>
                    </span>
                    <span>
                      <span className="eyebrow block !text-[10px]">giro · °/s</span>
                      {Math.round(g)} °/s
                    </span>
                    <span>
                      <span className="eyebrow block !text-[10px]">inclinación · °</span>
                      {t === null ? '—' : `${Math.round(t)} °`}
                    </span>
                  </span>
                )}
                {pend && <span className="basis-full text-sm text-mid">Pendiente de instalar. Al conectarla en SDA {m.sda} / SCL {m.scl} aparece sola: el firmware la busca cada 3 s. Mientras tanto el tronco queda «no disponible».</span>}
                {hw && !ok && !pend && <span className="basis-full text-sm text-bad">Sin señal I2C: revisa VCC (3,3 V), GND y que SDA/SCL no estén invertidos. Confírmala con PruebaMPU6050.ino.</span>}
              </div>
            )
          })}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="eyebrow mb-2">Flujo de datos</h3>
          <p className="display tnum text-4xl">
            {st?.fresco ? Math.round(st.hz) : '—'} <span className="display-cond text-xl text-muted">Hz</span>
          </p>
          <p className="mt-1 text-sm text-muted">Meta: 100 Hz · {st?.perdidas ?? 0} muestras perdidas</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {hw && flags.length === 0 && <span className="rounded-full bg-ok-soft px-2.5 py-1 text-xs font-semibold text-ok">Sin banderas de error</span>}
            {flags.map((x) => (
              <span key={x.bit} className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold', x.grave ? 'bg-bad-soft text-bad' : 'bg-mid-soft text-mid')}>
                {x.texto}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="eyebrow mb-2">Tara del banco</h3>
          <p className="text-sm text-ink-2">Deja las IMU quietas en la posición que será el cero de los ángulos (1 s de quietud).</p>
          <Button variant="ghost" className="mt-3" onClick={hacerTara} disabled={!hw || tara === 'esperando'} data-testid="banco-tara">
            {tara === 'esperando' ? <Cargando /> : <MarcaCero />} {st?.tara ? 'Repetir tara' : 'Hacer tara'}
          </Button>
          <p className={clsx('mt-2 text-sm', tara === 'error' ? 'text-bad' : 'text-muted')}>{tara === 'error' ? 'No hubo 1 s de quietud. Repite sin mover las IMU.' : st?.tara ? 'Tara aplicada: los ángulos (°) se miden desde esta posición.' : 'Sin tara: los ángulos (°) no tienen cero.'}</p>
        </div>
      </section>

      <section>
        <h3 className="eyebrow mb-2">Mensajes del firmware</h3>
        <pre className="max-h-40 overflow-auto rounded-2xl border border-line bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink-2">{(st?.mensajes ?? []).join('\n') || '—'}</pre>
      </section>
    </div>
  )
}

// ====================================================================== 2. prueba guiada
type CEstado = 'pendiente' | 'activo' | 'ok' | 'parcial' | 'no' | 'omitido'
interface Check {
  id: string
  titulo: string
  instruccion: string
  estado: CEstado
  nota?: string
}

const PASOS: Omit<Check, 'estado'>[] = [
  { id: 'reposo', titulo: 'Plantillas en reposo', instruccion: 'No toques las plantillas durante 2 segundos.' },
  ...FSR_INFO.map((s, i) => ({ id: `fsr${i}`, titulo: `FSR · ${s.nombre}`, instruccion: `Presiona con un dedo el ${s.nombre.toLowerCase()} (GPIO ${s.gpio}) y suéltalo.` })),
  ...IMU_INFO.map((m, n) => ({ id: `imu${n}`, titulo: `IMU · ${m.nombre}`, instruccion: `Toma la IMU del ${m.corto.toLowerCase()} (SDA ${m.sda} / SCL ${m.scl}) y gírala con la mano.` })),
  { id: 'flujo', titulo: 'Flujo de datos', instruccion: 'Midiendo la frecuencia de muestreo durante 2 segundos.' },
]

const nuevoChecks = (): Check[] => PASOS.map((p) => ({ ...p, estado: 'pendiente' }))
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
const std = (a: number[]) => {
  const m = mean(a)
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)))
}

function useGuia() {
  const [checks, setChecks] = useState<Check[]>(nuevoChecks)
  const [paso, setPaso] = useState(-1) // -1 sin empezar · PASOS.length = terminado
  const [sub, setSub] = useState('') // sub-instrucción en vivo
  const acc = useRef<{ t0: number; s: number[][]; base: number[]; hit: number; who: number; peak: number; fase: string; perd0: number; conImu: boolean }>({ t0: 0, s: [], base: [0, 0, 0, 0], hit: 0, who: -1, peak: 0, fase: '', perd0: 0, conImu: true })

  const fijar = useCallback((i: number, estado: CEstado, nota?: string) => {
    setChecks((c) => c.map((x, k) => (k === i ? { ...x, estado, nota } : x)))
  }, [])
  const avanzar = useCallback((i: number) => {
    acc.current = { ...acc.current, t0: performance.now(), s: [], hit: 0, who: -1, peak: 0, fase: '', perd0: useLive.getState().status?.perdidas ?? 0 }
    setSub('')
    setPaso(i + 1)
    if (i + 1 < PASOS.length) setChecks((c) => c.map((x, k) => (k === i + 1 ? { ...x, estado: 'activo' } : x)))
  }, [])
  const empezar = (conImu: boolean) => {
    setChecks(nuevoChecks())
    acc.current.base = [0, 0, 0, 0]
    acc.current.conImu = conImu
    avanzar(-1)
  }
  const omitir = () => {
    fijar(paso, 'omitido', 'Omitido por el usuario')
    avanzar(paso)
  }

  useEffect(() => {
    if (paso < 0 || paso >= PASOS.length) return
    const id = PASOS[paso].id
    const A = acc.current
    const iv = setInterval(() => {
      const hw = hwNow()
      const st = useLive.getState().status
      const el = performance.now() - A.t0
      if (!hw) {
        setSub('Esperando datos del dispositivo…')
        return
      }
      if (id === 'reposo') {
        A.s.push([...hw.raw])
        setSub(`Midiendo… ${Math.min(2, el / 1000).toFixed(1)} s`)
        if (el < 2000) return
        const cols = [0, 1, 2, 3].map((k) => A.s.map((r) => r[k]))
        A.base = cols.map(mean)
        const ruido = cols.map(std)
        const flot = ruido.map((r, k) => (r > 60 ? k : -1)).filter((k) => k >= 0)
        const alto = A.base.map((m, k) => (m > 200 ? k : -1)).filter((k) => k >= 0)
        if (flot.length) fijar(paso, 'no', `Pin flotante (ruido ±${Math.round(Math.max(...flot.map((k) => ruido[k])))} cuentas) en ${flot.map((k) => `GPIO ${FSR_INFO[k].gpio}`).join(', ')}: el FSR o la resistencia a GND no están conectados.`)
        else if (alto.length) fijar(paso, 'parcial', `Lectura alta sin presionar en ${alto.map((k) => FSR_INFO[k].corto).join(', ')} (${alto.map((k) => Math.round(A.base[k])).join(', ')} cuentas): ¿FSR doblado o pisado?`)
        else fijar(paso, 'ok', `Las 4 cerca de 0 cuentas (ruido ±${Math.round(Math.max(...ruido))} cuentas).`)
        avanzar(paso)
        return
      }
      if (id.startsWith('fsr')) {
        const k = Number(id.slice(3))
        const thr = hw.raw.map((_, j) => Math.max(PRESS_RAW, A.base[j] + 250))
        const on = hw.raw.map((r, j) => r > thr[j])
        if (A.fase === '' && on.some(Boolean)) {
          setSub('Suelta todo primero…')
          return
        }
        if (A.fase === '') A.fase = 'esperando'
        if (A.fase === 'esperando') {
          setSub('Esperando la presión…')
          let j = -1
          hw.raw.forEach((r, i) => {
            if (on[i] && (j < 0 || r - A.base[i] > hw.raw[j] - A.base[j])) j = i
          })
          if (j >= 0) {
            A.hit = A.who === j ? A.hit + 1 : 1
            A.who = j
            A.peak = Math.max(A.peak, hw.raw[j])
            if (A.hit >= 6) A.fase = 'soltar'
          } else A.hit = 0
          if (el > 25000) {
            fijar(paso, 'no', `No respondió en 25 s: revisa el divisor y la soldadura del GPIO ${FSR_INFO[k].gpio}.`)
            avanzar(paso)
          }
          return
        }
        if (A.fase === 'soltar') {
          A.peak = Math.max(A.peak, ...hw.raw)
          setSub('¡Detectado! Ahora suelta.')
          if (on.some(Boolean)) return
          const j = A.who
          if (j !== k) fijar(paso, 'no', `Respondió ${FSR_INFO[j].nombre} (GPIO ${FSR_INFO[j].gpio}): cables cruzados. Intercambia los cables o corrige el pin en config.h.`)
          else if (A.peak >= SAT_RAW) fijar(paso, 'parcial', `Responde, pero saturó (${A.peak} cuentas) con un dedo: la resistencia del divisor es muy alta. Usa 1 kΩ.`)
          else fijar(paso, 'ok', `Responde bien · pico ${A.peak} de 4095 cuentas.`)
          avanzar(paso)
        }
        return
      }
      if (id.startsWith('imu')) {
        const n = Number(id.slice(3))
        const m = IMU_INFO[n]
        if (!A.conImu) {
          fijar(paso, 'omitido', 'No incluida en esta prueba (IMU aún sin conectar).')
          avanzar(paso)
          return
        }
        if (!hw.ok || !hw.ok[n]) {
          setSub('Buscando la IMU…')
          if (el > 1200) {
            if (m.opcional) fijar(paso, 'omitido', `Pendiente de instalar (SDA ${m.sda} / SCL ${m.scl}): el tronco queda «no disponible» hasta conectarla.`)
            else fijar(paso, 'no', `No detectada: revisa VCC 3,3 V, GND, SDA ${m.sda} y SCL ${m.scl} (sin invertir).`)
            avanzar(paso)
          }
          return
        }
        const g = hw.g ?? [0, 0, 0]
        if (A.fase !== 'mover') {
          // primero todas quietas (si la anterior sigue moviéndose, se confundiría con un cruce)
          if (Math.max(...g) > 20) {
            A.s = []
            A.t0 = performance.now()
            setSub('Deja todas las IMU quietas un momento…')
            return
          }
          A.s.push([hw.a?.[n] ?? 0])
          setSub('Quieta un momento…')
          if (el < 600) return
          A.fase = 'mover'
        }
        setSub('Gírala con la mano…')
        const j = g.indexOf(Math.max(...g))
        const otras = g.filter((_, i) => i !== j)
        if (g[j] > 60 && Math.max(...otras) < 0.5 * g[j]) {
          A.hit = A.who === j ? A.hit + 1 : 1
          A.who = j
        } else A.hit = 0
        if (A.hit >= 4) {
          const a0 = mean(A.s.map((x) => x[0]))
          if (j !== n) fijar(paso, 'no', `Se movió la IMU conectada como ${IMU_INFO[j].corto} (SDA ${IMU_INFO[j].sda}): los buses están cruzados.`)
          else if (Math.abs(a0 - 1) > 0.1) fijar(paso, 'parcial', `Responde, pero en reposo |a| = ${a0.toFixed(2)} g (debería ser 1,00): calibra el acelerómetro con el comando 'a'.`)
          else fijar(paso, 'ok', `Responde · |a| en reposo ${a0.toFixed(2)} g.`)
          avanzar(paso)
        } else if (el > 25000) {
          fijar(paso, 'no', 'Se detecta pero no registró giro en 25 s: ¿giroscopio sin calibrar o placa pegada?')
          avanzar(paso)
        }
        return
      }
      if (id === 'flujo') {
        A.s.push([st?.hz ?? 0])
        setSub(`Midiendo… ${Math.min(2, el / 1000).toFixed(1)} s`)
        if (el < 2000) return
        const hz = mean(A.s.map((x) => x[0]))
        const lost = (st?.perdidas ?? 0) - A.perd0
        if (hz >= 90 && lost === 0) fijar(paso, 'ok', `${Math.round(hz)} Hz sin pérdidas.`)
        else if (hz >= 40) fijar(paso, 'parcial', `${Math.round(hz)} Hz · ${lost} pérdidas en 2 s (meta: 100 Hz).`)
        else fijar(paso, 'no', `Solo ${Math.round(hz)} Hz: revisa el cable USB y que la velocidad sea 921 600 baud.`)
        avanzar(paso)
      }
    }, 50)
    return () => clearInterval(iv)
  }, [paso, fijar, avanzar])

  return { checks, paso, sub, empezar, omitir }
}

const CHK: Record<CEstado, string> = {
  pendiente: 'border-line text-muted',
  activo: 'border-accent text-accent',
  ok: 'border-ok/40 bg-ok-soft text-ok',
  parcial: 'border-mid/40 bg-mid-soft text-mid',
  no: 'border-bad/40 bg-bad-soft text-bad',
  omitido: 'border-line text-muted',
}
function MarcaCheck({ e }: { e: CEstado }) {
  if (e === 'activo') return <Cargando className="mt-0.5" />
  if (e === 'pendiente') return <span className="mt-0.5 w-7 shrink-0 text-center font-mono text-xs leading-5 text-muted">—</span>
  return <MarcaEstado estado={e === 'omitido' ? 'no_disponible' : e} className="mt-0.5" />
}

function Guiada({ esVirtual, onGuardado }: { esVirtual: boolean; onGuardado: () => void }) {
  const { checks, paso, sub, empezar, omitir } = useGuia()
  const st = useLive((s) => s.status)
  const [notas, setNotas] = useState('')
  const [guardado, setGuardado] = useState(false)
  const [conImu, setConImu] = useState(() => !!hwNow()?.ok?.some(Boolean))
  const fin = paso >= PASOS.length
  const malos = checks.filter((c) => c.estado === 'no').length
  const omitidos = checks.filter((c) => c.estado === 'omitido').length
  const aprobado = fin && malos === 0
  const actual = paso >= 0 && !fin ? PASOS[paso] : null

  useEffect(() => setGuardado(false), [paso])

  const guardar = async () => {
    await api.post('/api/banco/reportes', { fuente: st?.fuente ?? '', aprobado, notas, checks: checks.map(({ id, titulo, estado, nota }) => ({ id, titulo, estado, nota })), flujo: { hz: st?.hz, perdidas: st?.perdidas } })
    setGuardado(true)
    onGuardado()
  }
  const simularPresion = async (k: number) => {
    const f: (boolean | null)[] = [null, null, null, null]
    f[k] = true
    await virtual.fsr(f)
    setTimeout(() => {
      f[k] = false
      virtual.fsr(f)
    }, 900)
  }

  return (
    <div className="flex flex-col gap-5">
      {paso < 0 && (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="text-lg text-ink-2">Revisa el hardware sensor por sensor. La prueba detecta pines flotantes, cables cruzados entre canales, divisores que saturan e IMU sin señal, y deja un reporte guardado.</p>
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-[15px] text-ink-2">
            <input type="checkbox" checked={conImu} onChange={(e) => setConImu(e.target.checked)} className="size-4 accent-[var(--accent)]" data-testid="guia-con-imu" />
            Incluir las 3 IMU <span className="text-muted">(desmárcalo si todavía no están conectadas)</span>
          </label>
          <Button size="lg" className="mt-4" onClick={() => empezar(conImu)} disabled={!st?.fresco} data-testid="guia-empezar">
            Empezar prueba guiada
          </Button>
        </div>
      )}

      {actual && (
          <motion.div key={actual.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-accent/50 bg-accent-soft p-6" data-testid="guia-actual">
            <p className="eyebrow">
              Paso {paso + 1} de {PASOS.length}
            </p>
            <p className="display-cond mt-1 text-[30px] leading-9">{actual.instruccion}</p>
            <p className="mt-2 flex items-center gap-2 font-mono text-sm text-accent">
              <Cargando /> {sub || '…'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {esVirtual && actual.id.startsWith('fsr') && (
                <Button variant="ghost" onClick={() => simularPresion(Number(actual.id.slice(3)))} data-testid="guia-simular">
                  Simular presión
                </Button>
              )}
              {esVirtual && actual.id.startsWith('imu') && (
                <Button variant="ghost" onClick={() => virtual.giro(IMU_INFO[Number(actual.id.slice(3))].id)} data-testid="guia-simular">
                  Simular giro
                </Button>
              )}
              {actual.id !== 'reposo' && actual.id !== 'flujo' && (
                <Button variant="quiet" onClick={omitir}>
                  Omitir (aún no está conectado)
                </Button>
              )}
            </div>
          </motion.div>
        )}

      {fin && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={clsx('rounded-3xl border p-6', aprobado ? 'border-ok/40 bg-ok-soft' : 'border-bad/40 bg-bad-soft')} data-testid="guia-resumen">
          <p className={clsx('display-cond text-3xl', aprobado ? 'text-ok' : 'text-bad')}>{aprobado ? (omitidos ? `Aprobado, con ${omitidos} sensor${omitidos > 1 ? 'es' : ''} sin probar` : 'Hardware aprobado') : `${malos} punto${malos > 1 ? 's' : ''} por corregir`}</p>
          <p className="mt-1 text-ink-2">{aprobado ? 'Todo lo conectado responde como debe.' : 'Corrige lo marcado en rojo y repite la prueba.'}</p>
          <textarea className={clsx(inputCls, 'mt-4 h-20 w-full resize-none py-3 text-[15px]')} placeholder="Notas (opcional): resistencias usadas, cables, quién probó…" value={notas} onChange={(e) => setNotas(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={guardar} disabled={guardado} data-testid="guia-guardar">
              {guardado ? 'Reporte guardado' : 'Guardar reporte'}
            </Button>
            <Button variant="ghost" onClick={() => empezar(conImu)}>
              Repetir prueba
            </Button>
          </div>
        </motion.div>
      )}

      <ol className="grid gap-2">
        {checks.map((c) => {
          return (
            <li key={c.id} className={clsx('flex items-start gap-3 rounded-2xl border p-3', CHK[c.estado])} data-testid={`check-${c.id}`} data-estado={c.estado}>
              <MarcaCheck e={c.estado} />
              <span className="leading-snug">
                <span className="block font-semibold text-ink">{c.titulo}</span>
                {c.nota && <span className="text-sm text-ink-2">{c.nota}</span>}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ====================================================================== 3. salto con las manos
type Fase = 'presiona' | 'suelta' | 'aire' | 'largo' | 'corto' | 'analizando' | 'resultado' | 'fallo'

/** Las dos plantillas vistas desde arriba, con cada FSR encendido según su lectura (cuentas ADC). */
function PiesVivos({ hw }: { hw: Hardware | null }) {
  const pies = [
    { x: 0, flip: true, heel: 0, fore: 1, nombre: 'izq.' },
    { x: 120, flip: false, heel: 2, fore: 3, nombre: 'der.' },
  ]
  return (
    <svg viewBox="-6 -4 232 236" className="h-44 w-auto shrink-0" role="img" aria-label="Plantillas en vivo" data-testid="pies-vivos">
      {pies.map((p) => (
        <g key={p.x}>
          <path d={FOOT} transform={`translate(${p.x},0) ${p.flip ? 'translate(100,0) scale(-1,1)' : ''}`} fill="var(--surface-2)" stroke="var(--line-2)" strokeWidth="1.5" />
          {[p.fore, p.heel].map((k) => {
            const raw = hw?.raw[k] ?? 0
            const on = raw > PRESS_RAW
            const cy = k % 2 === 0 ? 158 : 52
            return (
              <g key={k}>
                <circle cx={p.x + 50} cy={cy} r={17} fill="var(--accent)" fillOpacity={Math.min(0.9, raw / 3200)} stroke={raw >= SAT_RAW ? 'var(--bad)' : on ? 'var(--accent)' : 'var(--line-2)'} strokeWidth={on ? 2.2 : 1.2} />
                <text x={p.x + 50} y={cy + 4} textAnchor="middle" className="font-mono text-[11px]" fill={raw > 1800 ? 'var(--accent-ink)' : 'var(--ink-2)'}>
                  {raw}
                </text>
              </g>
            )
          })}
          <text x={p.x + 50} y={214} textAnchor="middle" className="fill-[var(--muted)] font-mono text-[10px] uppercase tracking-[0.14em]">
            {p.nombre}
          </text>
        </g>
      ))}
      <text x={110} y={230} textAnchor="middle" className="fill-[var(--muted)] font-mono text-[9px]">
        cuentas ADC (0 – 4095)
      </text>
    </svg>
  )
}

const ETAPAS = [
  { t: 'De pie', s: '4 FSR ≥ 2 s' },
  { t: 'Suelta', s: 'las 4 a la vez' },
  { t: 'Vuelo', s: '80 – 1500 ms' },
  { t: 'Contacto', s: 'antepié → talón' },
  { t: 'Análisis', s: '≈ 1 s' },
]
const etapaDe: Record<Fase, number> = { presiona: 0, suelta: 1, aire: 2, largo: 2, corto: 2, analizando: 4, resultado: 5, fallo: 4 }

function LineaEtapas({ fase }: { fase: Fase }) {
  const k = etapaDe[fase]
  const malo = fase === 'largo' || fase === 'corto' || fase === 'fallo'
  return (
    <ol className="grid grid-cols-5 gap-1" data-testid="salto-etapas">
      {ETAPAS.map((e, i) => (
        <li key={e.t} className={clsx('border-t-2 pt-1.5 leading-tight transition-colors', i < k ? 'border-accent text-ink-2' : i === k ? (malo ? 'border-mid text-mid' : 'border-accent text-ink') : 'border-line text-muted')}>
          <span className="block text-[13px] font-semibold">{e.t}</span>
          <span className="font-mono text-[10px]">{e.s}</span>
        </li>
      ))}
    </ol>
  )
}

function SaltoManos({ esVirtual, hw, onSalto: alGuardar }: { esVirtual: boolean; hw: Hardware | null; onSalto: () => void }) {
  const nav = useNavigate()
  const [fase, setFaseState] = useState<Fase>('presiona')
  const [hold, setHold] = useState(0)
  const [aviso, setAviso] = useState('')
  const [vueloMs, setVueloMs] = useState<number | null>(null)
  const [salto, setSalto] = useState<SaltoEvento | null>(null)
  const [tipo, setTipo] = useState<Aterrizaje>('antepie')
  const [asim, setAsim] = useState(false)
  const [corriendo, setCorriendo] = useState(false)
  const faseRef = useRef<Fase>(fase)
  const m = useRef({ hold: 0, dip: 0, parcial: 0, suelo: 0, vuelo: 0, last: performance.now() })
  const timer = useRef<number | undefined>(undefined)
  const setFase = useCallback((f: Fase) => {
    faseRef.current = f
    setFaseState(f)
  }, [])
  const reiniciar = useCallback(
    (msg = '') => {
      Object.assign(m.current, { hold: 0, dip: 0, parcial: 0, suelo: 0, vuelo: 0 })
      setHold(0)
      setAviso(msg)
      setFase('presiona')
    },
    [setFase],
  )

  // El contacto solo cuenta si veníamos de soltar: así un roce suelto no "aterriza" nada.
  useEffect(
    () =>
      onContacto((c) => {
        const ph = faseRef.current
        if (ph !== 'suelta' && ph !== 'aire') return
        setVueloMs(Math.round(c.vuelo_ms))
        setFase('analizando')
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => faseRef.current === 'analizando' && setFase('fallo'), 4500)
      }),
    [setFase],
  )
  useEffect(
    () =>
      onSalto((s) => {
        clearTimeout(timer.current)
        const v = s.resultado.metricas?.vuelo_ms
        if (typeof v === 'number') setVueloMs(Math.round(v))
        setSalto(s)
        setFase('resultado')
        alGuardar()
      }),
    [alGuardar, setFase],
  )
  useEffect(() => () => clearTimeout(timer.current), [])

  // Máquina de estados con los cuadros en vivo (20 Hz). Cada transición exige la anterior:
  // de pie (4 FSR, 2 s, tolera parpadeos < 250 ms) → suelta → vuelo → contacto.
  useEffect(() => {
    const id = setInterval(() => {
      const f = frame.current
      const h = hwNow()
      const M = m.current
      const now = performance.now()
      // tiempo real transcurrido (no se integra a 20 Hz: si el navegador se atrasa, el reloj no)
      const dt = Math.min(0.6, (now - M.last) / 1000)
      M.last = now
      if (!f || !h) return
      const ph = faseRef.current
      const n = h.raw.filter((r) => r > PRESS_RAW).length
      if (ph === 'presiona') {
        if (n === 4) {
          M.hold += dt
          M.dip = 0
          if (M.hold > 0.3) setAviso('')
        } else if (M.hold > 0) {
          M.dip += dt
          if (M.dip > 0.25) M.hold = 0
        }
        setHold(M.hold)
        if (M.hold >= 2) {
          M.parcial = 0
          setFase('suelta')
        }
      } else if (ph === 'suelta') {
        if (f.air && f.air_t > 0.02) {
          M.suelo = 0
          M.vuelo = f.air_t
          setVueloMs(null)
          setFase('aire')
        } else if (n === 4) M.parcial = 0
        else if ((M.parcial += dt) > 0.6) reiniciar('Soltaste de a poco: para que cuente como vuelo, suelta las 4 a la vez.')
      } else if (ph === 'aire') {
        if (f.air) {
          M.vuelo = f.air_t
          M.suelo = 0
          if (f.air_t > 1.5) setFase('largo')
        } else if ((M.suelo += dt) > 0.5) {
          // tocó, pero el detector no lo tomó como aterrizaje
          setVueloMs(Math.round(M.vuelo * 1000))
          setFase(M.vuelo < 0.08 ? 'corto' : 'fallo')
        }
      } else if (ph === 'largo' || ph === 'corto' || ph === 'fallo') {
        // volver a presionar las 4 arranca otro intento
        if (n === 4) reiniciar()
      }
    }, 50)
    return () => clearInterval(id)
  }, [reiniciar, setFase])

  const otro = () => {
    setSalto(null)
    setVueloMs(null)
    reiniciar()
  }
  const simular = async () => {
    otro()
    setCorriendo(true)
    try {
      await saltoVirtual(tipo, asim)
    } finally {
      setCorriendo(false)
    }
  }

  const res = salto?.resultado
  const est = res ? CAT_ESTADO[res.categoria] : 'ok'
  const medibles = res?.items.filter((i) => i.estado !== 'no_disponible') ?? []
  const faltan = res?.items.filter((i) => i.estado === 'no_disponible') ?? []
  const n = hw?.raw.filter((r) => r > PRESS_RAW).length ?? 0
  const INSTR: Record<Fase, { t: string; s: string }> = {
    presiona: { t: 'Presiona las 4 plantillas', s: 'Dos dedos por plantilla (talón y antepié) durante 2 s: así «está de pie».' },
    suelta: { t: 'Suelta todo de golpe', s: 'Las 4 a la vez: esa es la fase de vuelo.' },
    aire: { t: 'Aterriza', s: 'Presiona primero los antepiés y enseguida los talones.' },
    largo: { t: 'Vuelo demasiado largo', s: 'Más de 1500 ms no es un aterrizaje. Presiona las 4 para intentar de nuevo.' },
    corto: { t: 'Vuelo demasiado corto', s: `Duró ${vueloMs ?? 0} ms y el mínimo es 80 ms: suelta un poco más de tiempo. Presiona las 4 para repetir.` },
    analizando: { t: 'Analizando', s: 'El mismo detector y motor de reglas que con un atleta.' },
    resultado: { t: '', s: '' },
    fallo: { t: 'No se pudo analizar', s: 'El detector no encontró una postura «de pie» estable antes del vuelo. Presiona las 4 de nuevo y mantenlas 2 s quietas.' },
  }
  const acento = fase === 'aire' || fase === 'suelta'
  const malo = fase === 'fallo' || fase === 'largo' || fase === 'corto'

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-line bg-surface p-4 text-[15px] text-ink-2">
        <p>
          <b className="text-ink">¿Para qué sirve?</b> Sin atleta, tus manos hacen de pies: de pie → vuelo → contacto. El sistema lo detecta, lo analiza y te dice qué midió. Sin IMU solo se evalúan los ítems de las plantillas (apoyo antepié → talón, simultaneidad y simetría de carga); el resto queda «no disponible», sin inventar nada.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">El atleta 3D salta</span>
          <ModoSaltoToggle compacto className="!bg-surface-2" />
        </div>
      </div>

      {fase !== 'resultado' ? (
        <div className={clsx('rounded-3xl border p-6 transition-colors', acento ? 'border-accent/60 bg-accent-soft' : malo ? 'border-mid/40 bg-mid-soft' : 'border-line bg-surface')} data-testid="salto-fase" data-fase={fase}>
          <LineaEtapas fase={fase} />
          <div className="mt-5 flex flex-wrap items-center gap-6">
            <div className="min-w-[220px] flex-1">
              <p className={clsx('display text-[clamp(1.9rem,3.2vw,2.8rem)] leading-none', acento && 'text-accent')}>{INSTR[fase].t}</p>
              <p className="mt-2 text-lg text-ink-2">{INSTR[fase].s}</p>
              {fase === 'presiona' && (
                <div className="mt-4">
                  <div className="h-1.5 overflow-hidden bg-surface-2">
                    <div className="h-full bg-accent transition-[width] duration-100" style={{ width: `${Math.min(100, (hold / 2) * 100)}%` }} />
                  </div>
                  <p className="mt-1.5 font-mono text-xs text-muted">
                    {n}/4 FSR presionados (&gt; {PRESS_RAW} cuentas) · {hold.toFixed(1).replace('.', ',')} / 2,0 s {hw && hw.base === null && n === 4 ? '· fijando el nivel «de pie»…' : ''}
                  </p>
                </div>
              )}
              {fase === 'aire' && <p className="mt-3 font-mono text-sm text-accent">en el aire</p>}
              {fase === 'analizando' && (
                <p className="mt-3 flex items-center gap-2 font-mono text-sm text-accent">
                  <Cargando /> vuelo {vueloMs} ms · analizando los primeros 1000 ms tras el contacto
                </p>
              )}
              {aviso && fase === 'presiona' && <p className="mt-3 border-l-2 border-mid pl-2.5 text-sm text-mid">{aviso}</p>}
              {malo && (
                <Button variant="ghost" className="mt-4" onClick={otro}>
                  Intentar de nuevo
                </Button>
              )}
            </div>
            <PiesVivos hw={hw} />
          </div>
        </div>
      ) : (
        res && (
          <motion.div initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 26 }} className="rounded-3xl border border-line bg-surface p-6" data-testid="salto-resultado">
            <div className="flex flex-wrap items-center gap-5">
              <span className="display tnum text-7xl" style={{ color: estadoVar(est) }}>
                {res.indice}
              </span>
              <span className="flex-1">
                <span className="display-cond block text-3xl">{res.categoria}</span>
                <span className="eyebrow">
                  índice 0 – 100 con {medibles.length} ítem{medibles.length === 1 ? '' : 's'} medible{medibles.length === 1 ? '' : 's'} · prueba de banco{vueloMs ? ` · vuelo ${vueloMs} ms` : ''}
                </span>
              </span>
              <span className={clsx('rounded-full px-3 py-1 text-sm font-semibold', res.confianza === 'alta' ? 'bg-ok-soft text-ok' : res.confianza === 'media' ? 'bg-mid-soft text-mid' : 'bg-bad-soft text-bad')}>confianza {res.confianza}</span>
            </div>
            {res.banco && <p className="mt-3 text-sm text-muted">{res.banco.texto}</p>}
            {res.confianza === 'baja' && <p className="mt-2 text-sm text-bad">{res.motivos_confianza.join(' ')}</p>}
            <ul className="mt-4 grid gap-1.5">
              {medibles.map((i) => {
                const e = ESTADO[i.estado]
                return (
                  <li key={i.id} className="flex items-center gap-3 text-[15px]">
                    <e.Icon />
                    <span className="flex-1">{i.nombre}</span>
                    <span className="font-mono text-sm text-muted">{i.valor === null ? '—' : `${typeof i.valor === 'number' ? Math.round(i.valor * 10) / 10 : i.valor} ${i.unidad}`}</span>
                  </li>
                )
              })}
            </ul>
            {faltan.length > 0 && <p className="mt-3 text-sm text-muted">No disponibles sin IMU: {faltan.map((i) => i.nombre.toLowerCase()).join(', ')}.</p>}
            {res.acciones[0] && (
              <div className="mt-4 rounded-2xl bg-surface-2 p-4">
                <p className="eyebrow mb-1">Lo que el atleta oiría primero</p>
                <p className="text-lg font-semibold leading-snug">{res.acciones[0].mensaje}</p>
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={otro} data-testid="salto-otro">
                Otro salto
              </Button>
              {salto?.id && (
                <Button variant="ghost" onClick={() => nav(`/salto/${salto.id}`)}>
                  Ver detalle completo <ArrowRight className="size-4" />
                </Button>
              )}
            </div>
          </motion.div>
        )
      )}

      {esVirtual && (
        <div className="rounded-2xl border border-dashed border-line-2 p-4" data-testid="salto-virtual">
          <p className="eyebrow mb-3">Banco virtual · salto simulado (de pie 2,2 s · vuelo 320 ms)</p>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['antepie', 'Antepié → talón'],
                ['plano', 'Pie plano'],
                ['talon', 'Talón primero'],
              ] as const
            ).map(([v, l]) => (
              <button key={v} onClick={() => setTipo(v)} className={clsx('rounded-full px-3 py-1.5 text-sm font-medium transition', tipo === v ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-surface-2')}>
                {l}
              </button>
            ))}
            <label className="ml-1 flex cursor-pointer items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={asim} onChange={(e) => setAsim(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Más carga a la derecha
            </label>
            <Button className="ml-auto" onClick={simular} disabled={corriendo} data-testid="salto-simular">
              {corriendo && <Cargando />} Simular salto
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted">
            O a mano: mantén <kbd className="rounded border border-line-2 px-1.5 font-mono text-xs">Espacio</kbd> = las 4 plantillas · <kbd className="rounded border border-line-2 px-1.5 font-mono text-xs">A S K L</kbd> = cada una.
          </p>
        </div>
      )}
    </div>
  )
}

// ====================================================================== 4. historial
interface Reporte {
  id: number
  fecha: string
  fuente: string
  aprobado: boolean
  notas: string
  checks: { id: string; titulo: string; estado: CEstado; nota?: string }[]
}
interface SaltoBanco {
  id: number
  fecha: string
  indice: number
  categoria: string
  confianza: string
  medibles: string[]
  imus: string[]
}

function Historial({ version }: { version: number }) {
  const nav = useNavigate()
  const [reps, setReps] = useState<Reporte[] | null>(null)
  const [saltos, setSaltos] = useState<SaltoBanco[] | null>(null)
  const [abierto, setAbierto] = useState<number | null>(null)
  useEffect(() => {
    api.get<Reporte[]>('/api/banco/reportes').then(setReps).catch(() => setReps([]))
    api.get<SaltoBanco[]>('/api/banco/saltos').then(setSaltos).catch(() => setSaltos([]))
  }, [version])
  const fecha = (s: string) => new Date(s).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="eyebrow mb-3">Reportes de la prueba guiada</h3>
        {reps?.length === 0 && <p className="text-muted">Todavía no hay reportes. Corre la prueba guiada y guárdala.</p>}
        <div className="grid gap-2">
          {reps?.map((r) => (
            <div key={r.id} className="rounded-2xl border border-line bg-surface p-3.5" data-testid="reporte">
              <button className="flex w-full items-center gap-3 text-left" onClick={() => setAbierto(abierto === r.id ? null : r.id)}>
                <span className={clsx('rounded-full px-2.5 py-1 text-xs font-bold', r.aprobado ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad')}>{r.aprobado ? 'Aprobado' : 'Por corregir'}</span>
                <span className="flex-1 leading-tight">
                  <span className="block font-semibold">{fecha(r.fecha)}</span>
                  <span className="font-mono text-xs text-muted">{r.fuente}</span>
                </span>
                <span className="flex gap-1">
                  {r.checks.map((c) => (
                    <span key={c.id} title={c.titulo} className={clsx('size-2.5 rounded-full', c.estado === 'ok' ? 'bg-ok' : c.estado === 'parcial' ? 'bg-mid' : c.estado === 'no' ? 'bg-bad' : 'bg-line-2')} />
                  ))}
                </span>
              </button>
              {abierto === r.id && (
                <ul className="mt-3 grid gap-1 border-t border-line pt-3 text-sm">
                  {r.checks.map((c) => (
                    <li key={c.id}>
                      <b className={clsx(c.estado === 'ok' ? 'text-ok' : c.estado === 'parcial' ? 'text-mid' : c.estado === 'no' ? 'text-bad' : 'text-muted')}>{c.titulo}</b> <span className="text-ink-2">{c.nota}</span>
                    </li>
                  ))}
                  {r.notas && <li className="mt-1 text-muted">Notas: {r.notas}</li>}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 className="eyebrow mb-3">Saltos de banco</h3>
        {saltos?.length === 0 && <p className="text-muted">Todavía no hay saltos de banco.</p>}
        <div className="grid gap-2">
          {saltos?.map((j) => (
            <button key={j.id} onClick={() => nav(`/salto/${j.id}`)} className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-3.5 text-left transition hover:border-line-2" data-testid="salto-banco">
              <span className="display tnum w-14 text-3xl" style={{ color: estadoVar(CAT_ESTADO[j.categoria] ?? 'no') }}>
                {j.indice}
              </span>
              <span className="flex-1 leading-tight">
                <span className="block font-semibold">
                  {j.categoria} <span className="font-normal text-muted">· {fecha(j.fecha)}</span>
                </span>
                <span className="text-sm text-muted">
                  {j.medibles.length} ítems medibles · {j.imus.length ? `IMU: ${j.imus.join(', ')}` : 'solo plantillas'} · confianza {j.confianza}
                </span>
              </span>
              <ArrowRight className="size-4 text-muted" />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

// ====================================================================== escena 3D
/** El atleta movido por el banco: ángulos del firmware, carga de las plantillas y el salto
 *  (desde el cajón o en el sitio, según el modo). Lleva puestos los sensores en su sitio. */
function BenchAthlete({ modo, sensores, xray, ejes }: { modo: ModoSalto; sensores: boolean; xray: boolean; ejes: boolean }) {
  const pose = useRef(emptyPose())
  const joints = useRef(newJoints())
  const loads = useRef<number[]>([0, 0, 0, 0])
  const raiz = useRef(new RootMotion())
  const shock = useRef<{ t: number; k: number; x: number; z: number } | null>(null)
  const { clock } = useThree()
  useEffect(() => raiz.current.reset(modo), [modo])
  useEffect(() => onContacto(() => void (shock.current = { t: clock.elapsedTime, k: 1, x: 0, z: 0.03 })), [clock])
  useFrame((st) => {
    const f = frame.current
    if (!f) return
    // en el banco las IMU no están sobre un cuerpo: el muslo se estima a partir de la rodilla
    poseFromFrame({ ...f, thigh: null, valgus: null, lateral: null }, pose.current)
    const hw = f.hw
    if (hw) {
      loads.current = hw.raw.map((r) => (r / 4095) * 2.6)
      pose.current.footL = f.air || (hw.raw[1] > PRESS_RAW && hw.raw[0] < PRESS_RAW) ? 22 : 0
      pose.current.footR = f.air || (hw.raw[3] > PRESS_RAW && hw.raw[2] < PRESS_RAW) ? 22 : 0
    }
    raiz.current.update(f, st.clock.elapsedTime, pose.current)
  })
  return (
    <>
      <Athlete pose={pose} joints={joints} smooth={20} xray={xray} acople={sensores ? (rig) => <SensoresCuerpo rig={rig} ejes={ejes} /> : undefined} />
      <FloorPressure loads={loads} joints={joints} />
      <Shockwave trigger={shock} />
    </>
  )
}

type VistaAtleta = 'lateral' | 'frontal' | 'libre'

function Pastilla({ on, onClick, children, testid, title }: { on: boolean; onClick: () => void; children: React.ReactNode; testid?: string; title?: string }) {
  return (
    <button onClick={onClick} title={title} aria-pressed={on} className={clsx('rounded-xl px-3 py-1.5 text-sm font-medium transition', on ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink')} data-testid={testid}>
      {children}
    </button>
  )
}
const grupo = 'flex gap-1 rounded-2xl border border-line bg-surface/80 p-1 backdrop-blur'

function Escena3D({ esVirtual, tab }: { esVirtual: boolean; tab: Tab }) {
  const [rep, setRep] = useState<Rep>('hardware')
  const [libre, setLibre] = useState(false)
  const [vistaAt, setVistaAt] = useState<VistaAtleta>('lateral')
  const [sensores, setSensores] = useState(true)
  const [xray, setXray] = useState(false)
  const [ejes, setEjes] = useState(true)
  const [recenter, setRecenter] = useState(0)
  const modo = useModoSalto()
  const sel = useExplora((s) => s.sel)
  const hw = useHw(4)
  useEffect(() => {
    setRep(tab === 'salto' ? 'atleta' : 'hardware')
  }, [tab])
  // cambiar de representación suelta la pieza elegida
  useEffect(() => useExplora.getState().soltar(), [rep])
  useEffect(() => () => useExplora.getState().soltar(), [])
  // hundir una pieza pasa a la vista libre (la cámara se acerca a ella)
  useEffect(() => {
    if (!sel) return
    if (rep === 'hardware') setLibre(true)
    else setVistaAt('libre')
  }, [sel, rep])
  const general = () => {
    useExplora.getState().soltar()
    if (rep === 'hardware') setLibre(false)
    else setVistaAt('lateral')
  }
  const sinImu = hw?.ok ? hw.ok.every((x) => !x) : false
  const vista = vistaAt === 'libre' ? 'orbital' : vistaAt
  return (
    <div className="relative min-h-[560px] overflow-hidden lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)]" data-testid="banco-escena" data-rep={rep}>
      {rep === 'hardware' ? (
        <Stage key="hw" vista={libre ? 'orbital' : 'banco'} zoom={0.8} cajon={false} orbitTarget={[0, 0.05, -0.05]} minDist={0.1}>
          <BenchRig interactive={esVirtual} recenterKey={recenter} />
        </Stage>
      ) : (
        <Stage key="at" vista={vista} zoom={vistaAt === 'frontal' ? 1.05 : 1.25} focusY={0.75} cajon={modo === 'cajon'} orbitTarget={[0, 0.85, modo === 'cajon' ? -0.3 : 0]} minDist={0.25}>
          <BenchAthlete modo={modo} sensores={sensores} xray={xray} ejes={ejes} />
        </Stage>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-bg to-transparent" />
      <div className="absolute right-6 top-6 flex flex-col items-end gap-2">
        <div className={grupo} role="group" aria-label="Representación">
          <Pastilla on={rep === 'hardware'} onClick={() => setRep('hardware')} testid="rep-hardware">
            Hardware
          </Pastilla>
          <Pastilla on={rep === 'atleta'} onClick={() => setRep('atleta')} testid="rep-atleta">
            Atleta
          </Pastilla>
        </div>
        {rep === 'hardware' ? (
          <div className={grupo}>
            <Pastilla on={libre} onClick={() => (libre ? general() : setLibre(true))} testid="vista-libre">
              Vista libre
            </Pastilla>
            <Pastilla on={false} onClick={() => setRecenter((x) => x + 1)} title="El rumbo de las IMU es libre (no se usa el magnetómetro): esto lo vuelve a cero">
              Recentrar IMU
            </Pastilla>
          </div>
        ) : (
          <>
            <div className={grupo} role="group" aria-label="Vista">
              {(['lateral', 'frontal', 'libre'] as const).map((v) => (
                <Pastilla key={v} on={vistaAt === v} onClick={() => (v === 'libre' ? setVistaAt('libre') : (useExplora.getState().soltar(), setVistaAt(v)))} testid={`vista-at-${v}`}>
                  {v === 'lateral' ? 'Lateral' : v === 'frontal' ? 'Frontal' : 'Libre'}
                </Pastilla>
              ))}
            </div>
            <div className={grupo} role="group" aria-label="Capas">
              <Pastilla on={sensores} onClick={() => setSensores((x) => !x)} testid="capa-sensores">
                Sensores
              </Pastilla>
              <Pastilla on={xray} onClick={() => setXray((x) => !x)} testid="capa-xray" title="Cuerpo translúcido: se ven las plantillas bajo los pies y el cinturón">
                Rayos X
              </Pastilla>
              <Pastilla on={ejes} onClick={() => setEjes((x) => !x)} title="Ejes de montaje de cada IMU: X rojo, Y verde, Z azul (sale de la piel)">
                Ejes
              </Pastilla>
            </div>
          </>
        )}
      </div>
      <FichaPanel modo={rep} className="absolute left-6 top-6 max-h-[calc(100%-7.5rem)]" />
      <div className="absolute bottom-6 left-6 right-6 flex flex-wrap items-center gap-2">
        {sel && (
          <button onClick={general} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:border-line-2" data-testid="vista-general">
            Vista general <span className="font-mono text-xs text-muted">Esc</span>
          </button>
        )}
        {rep === 'hardware' ? (
          <>
            <span className="rounded-full border border-line bg-surface/75 px-3 py-1.5 text-sm text-ink-2 backdrop-blur">Clic en cualquier pieza: qué es y para qué sirve · arrastra para girar, rueda para acercarte</span>
            {esVirtual && <span className="rounded-full border border-accent/50 bg-accent-soft px-3 py-1.5 text-sm text-ink backdrop-blur">Banco virtual: clic sostenido en un FSR = presionarlo · clic en una IMU = girarla · doble clic = ficha</span>}
          </>
        ) : (
          <span className="rounded-full border border-line bg-surface/75 px-3 py-1.5 text-sm text-ink-2 backdrop-blur">
            {sensores ? 'Clic en un sensor: dónde va y qué mide · ' : ''}
            {sinImu ? 'sin IMU: rodilla y tronco quedan en 0°; los pies y el salto vienen de las plantillas' : 'rodilla y tronco: ángulos del firmware (°) · muslo estimado'}
          </span>
        )}
      </div>
    </div>
  )
}

// ====================================================================== teclado del banco virtual
function useTecladoVirtual(on: boolean) {
  useEffect(() => {
    if (!on) return
    const map: Record<string, number[]> = { Space: [0, 1, 2, 3], KeyA: [0], KeyS: [1], KeyK: [2], KeyL: [3] }
    const held = new Set<string>()
    const send = (code: string, v: boolean) => {
      const f: (boolean | null)[] = [null, null, null, null]
      map[code].forEach((i) => (f[i] = v))
      virtual.fsr(f)
    }
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (!map[e.code] || e.repeat || /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return
      e.preventDefault()
      held.add(e.code)
      send(e.code, true)
    }
    const up = (e: KeyboardEvent) => {
      if (!held.has(e.code)) return
      held.delete(e.code)
      send(e.code, false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [on])
}

// ====================================================================== página
const TABS: { id: Tab; label: string }[] = [
  { id: 'vivo', label: 'Sensores en vivo' },
  { id: 'guiada', label: 'Prueba guiada' },
  { id: 'salto', label: 'Salto con las manos' },
  { id: 'historial', label: 'Historial' },
]

export default function Banco() {
  const st = useLive((s) => s.status)
  const [tab, setTab] = useState<Tab>('vivo')
  const [version, setVersion] = useState(0)
  const hw = useHw()
  const conectado = st?.estado === 'conectado' && st.tipo !== 'demo'
  const esVirtual = conectado && st?.tipo === 'virtual'
  useTecladoVirtual(esVirtual)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  // sesión del banco mientras la página está abierta y hay un dispositivo (no la demo con atleta)
  useEffect(() => {
    if (!conectado) return
    api.post('/api/banco/iniciar').catch(() => {})
  }, [conectado])
  useEffect(() => () => void api.post('/api/banco/fin').catch(() => {}), [])

  const resumen = useMemo(() => {
    if (!hw) return null
    const fsrOk = hw.raw.filter((r) => r < SAT_RAW).length
    const imuOk = hw.ok ? hw.ok.filter(Boolean).length : 0
    return { fsrOk, imuOk }
  }, [hw])

  return (
    <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]" data-testid="banco">
      <div className="px-6 py-10 lg:px-12">
        <p className="eyebrow">Banco de pruebas · sin atleta</p>
        <h1 className="display mt-3 text-5xl">Prueba el hardware</h1>
        <p className="mt-4 max-w-[52ch] text-lg text-ink-2">Revisa cada sensor, míralo en 3D y simula un aterrizaje con las manos. Lo que pase aquí no se mezcla con los atletas.</p>
        {resumen && (
          <p className="mt-3 font-mono text-sm text-muted" data-testid="banco-resumen">
            {resumen.fsrOk}/4 FSR sin saturar (&lt; {SAT_RAW} cuentas) · {resumen.imuOk}/3 IMU con señal
          </p>
        )}

        <div className="mt-8">
          <Conexion />
        </div>

        <div className="mt-8 flex flex-wrap gap-1 rounded-2xl border border-line bg-surface p-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={clsx('flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-[15px] font-medium transition', tab === t.id ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink')} data-testid={`tab-${t.id}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {!conectado && tab !== 'historial' ? (
            <p className="rounded-2xl border border-dashed border-line-2 p-6 text-center text-muted">Conecta tu ESP32 (o el banco virtual) para empezar.</p>
          ) : (
            <>
              {tab === 'vivo' && <Vivo hw={hw} />}
              {tab === 'guiada' && <Guiada esVirtual={esVirtual} onGuardado={bump} />}
              {tab === 'salto' && <SaltoManos esVirtual={esVirtual} hw={hw} onSalto={bump} />}
            </>
          )}
          {tab === 'historial' && <Historial version={version} />}
        </div>
      </div>
      <Escena3D esVirtual={esVirtual} tab={tab} />
    </div>
  )
}
