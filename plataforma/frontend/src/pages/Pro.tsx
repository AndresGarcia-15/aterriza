/**
 * Modo profesional: el laboratorio del equipo y la docente.
 *   Señales     lo que manda el ESP32, sin interpretar, con unidades y ejes de tiempo
 *   Dispositivo comandos del firmware con lo que hace cada uno y cuándo usarlo
 *   Datos       todos los saltos (atletas y banco por separado) con unidades y exportación
 *   Criterios   las reglas del motor: umbral, unidad, por qué y fuente; editarlas crea versión
 *   Ajustes     divisor, calibración de FSR, protocolo, modo de salto y PIN
 */
import clsx from 'clsx'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cargando, MarcaPro, TrazoSenal } from '../components/marks'
import { ModoSaltoToggle } from '../components/ModoSalto'
import { Button, Field, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { FLAGS, SAT_RAW } from '../lib/banco'
import { useApp, useLive } from '../lib/store'

type Tab = 'senales' | 'dispositivo' | 'datos' | 'criterios' | 'ajustes'
const TABS: [Tab, string, string][] = [
  ['senales', 'Señales', 'CSV del firmware en vivo'],
  ['dispositivo', 'Dispositivo', 'comandos y calibración'],
  ['datos', 'Datos', 'saltos y exportación'],
  ['criterios', 'Criterios', 'umbrales del motor'],
  ['ajustes', 'Ajustes', 'hardware y protocolo'],
]

interface Crudo {
  columnas: string[]
  filas: number[][]
  hz: number
  mensajes: string[]
  perdidas: number
}

/** Unidad de cada columna del CSV del firmware (App.cpp · formatSample). */
function unidadColumna(c: string): string {
  if (c === 'seq') return 'n.º'
  if (c === 't_us') return 'µs'
  if (/^P\d_[HF]$/.test(c)) return 'cuentas ADC'
  if (/_a[xyz]$/.test(c)) return 'g'
  if (/_g[xyz]$/.test(c)) return '°/s'
  if (/_m[xyz]$/.test(c)) return 'µT'
  if (c === 'knee_flex' || c === 'trunk_flex') return '°'
  if (c === 'flags') return 'bits'
  return ''
}

// ------------------------------------------------------------------ gráfico con ejes
interface Serie {
  label: string
  color: string
  valor: (r: number[], col: Record<string, number>) => number | null
}

function ticks(min: number, max: number, n = 4) {
  const paso = (max - min) / n
  return Array.from({ length: n + 1 }, (_, i) => min + i * paso)
}

function Grafico({ crudo, series, min, max, titulo, unidad, linea }: { crudo: Crudo; series: Serie[]; min: number; max: number; titulo: string; unidad: string; linea?: { v: number; label: string } }) {
  const W = 900
  const H = 190
  const PL = 54
  const PB = 26
  const col = useMemo(() => Object.fromEntries(crudo.columnas.map((c, i) => [c, i])), [crudo.columnas])
  const ti = col.t_us
  const rows = crudo.filas
  if (!rows.length || ti === undefined) return null
  const t1 = rows[rows.length - 1][ti]
  const t0 = t1 - 6e6
  const x = (t: number) => PL + ((t - t0) / (t1 - t0)) * (W - PL - 8)
  const y = (v: number) => 8 + (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min)) * (H - PB - 8)
  const fmt = (v: number) => (Math.abs(max - min) >= 20 ? Math.round(v).toLocaleString('es-CO') : v.toFixed(1).replace('.', ','))
  return (
    <figure className="rounded-2xl border border-line bg-surface p-4" data-testid="pro-grafico">
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-semibold">{titulo}</span>
        <span className="font-mono text-xs text-muted">{unidad}</span>
        <span className="ml-auto flex flex-wrap gap-3">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5 font-mono text-xs text-ink-2">
              <span className="h-0.5 w-4" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${titulo} en ${unidad}, últimos 6 s`}>
        {ticks(min, max).map((v) => (
          <g key={v}>
            <line x1={PL} x2={W - 8} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={PL - 8} y={y(v) + 4} textAnchor="end" className="fill-[var(--muted)] font-mono text-[11px]">
              {fmt(v)}
            </text>
          </g>
        ))}
        {[-6, -5, -4, -3, -2, -1, 0].map((s) => (
          <text key={s} x={x(t1 + s * 1e6)} y={H - 6} textAnchor="middle" className="fill-[var(--muted)] font-mono text-[11px]">
            {s === 0 ? '0 s' : `${s}`}
          </text>
        ))}
        {linea && (
          <g>
            <line x1={PL} x2={W - 8} y1={y(linea.v)} y2={y(linea.v)} stroke="var(--bad)" strokeDasharray="4 4" strokeWidth="1" />
            <text x={W - 10} y={y(linea.v) - 5} textAnchor="end" className="fill-[var(--bad)] font-mono text-[10px]">
              {linea.label}
            </text>
          </g>
        )}
        {series.map((s) => {
          let d = ''
          for (const r of rows) {
            if (r[ti] < t0) continue
            const v = s.valor(r, col)
            if (v === null || !Number.isFinite(v)) continue
            d += `${d ? 'L' : 'M'}${x(r[ti]).toFixed(1)},${y(v).toFixed(1)}`
          }
          return <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth="1.6" strokeLinejoin="round" />
        })}
      </svg>
    </figure>
  )
}

const C = (name: string) => (r: number[], col: Record<string, number>) => (col[name] === undefined ? null : r[col[name]])
const mag = (p: string, k: 'a' | 'g') => (r: number[], col: Record<string, number>) => {
  const i = col[`${p}_${k}x`]
  if (i === undefined) return null
  const v = Math.hypot(r[i], r[i + 1], r[i + 2])
  return v === 0 ? null : v
}
const IMU_COL = [
  ['T', 'Muslo', 'var(--accent)'],
  ['P', 'Pierna', '#ff8f6b'],
  ['L', 'Lumbar', '#b49cff'],
] as const

function Senales({ crudo }: { crudo: Crudo | null }) {
  const [grupo, setGrupo] = useState<'angulos' | 'fsr' | 'acel' | 'giro'>('angulos')
  if (!crudo) return <p className="mt-8 flex items-center gap-2 text-muted"><Cargando /> Esperando datos del dispositivo…</p>
  if (!crudo.filas.length) return <p className="mt-8 text-muted">No hay muestras en los últimos 6 s. Conecta el ESP32 desde Preparar o el Banco de pruebas.</p>
  const last = crudo.filas[crudo.filas.length - 1]
  const fi = crudo.columnas.indexOf('flags')
  const banderas = fi >= 0 ? FLAGS.filter((f) => last[fi] & (1 << f.bit)) : []
  return (
    <div className="mt-6 grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['angulos', 'Ángulos (°)'],
            ['fsr', 'Plantillas (cuentas ADC)'],
            ['acel', 'Aceleración |a| (g)'],
            ['giro', 'Velocidad angular |ω| (°/s)'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setGrupo(k)} className={clsx('rounded-full px-3 py-1.5 text-sm font-medium transition', grupo === k ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-surface-2')}>
            {l}
          </button>
        ))}
        <span className="ml-auto font-mono text-xs text-muted">
          {crudo.hz.toFixed(1).replace('.', ',')} Hz · {crudo.perdidas} muestras perdidas · ventana 6 s (1 de cada 2 muestras)
        </span>
      </div>
      {grupo === 'angulos' && (
        <Grafico
          crudo={crudo}
          titulo="Ángulos calculados en el ESP32"
          unidad="grados (°), relativos a la tara"
          min={-20}
          max={100}
          series={[
            { label: 'rodilla · knee_flex', color: 'var(--accent)', valor: C('knee_flex') },
            { label: 'tronco · trunk_flex', color: 'var(--mid)', valor: C('trunk_flex') },
          ]}
        />
      )}
      {grupo === 'fsr' && (
        <Grafico
          crudo={crudo}
          titulo="FSR sin procesar"
          unidad="cuentas del ADC de 12 bits (0 – 4095 ≈ 0 – 3,3 V)"
          min={0}
          max={4095}
          linea={{ v: SAT_RAW, label: `saturación · ${SAT_RAW} cuentas` }}
          series={[
            { label: 'talón izq. · P1_H', color: '#7aa2ff', valor: C('P1_H') },
            { label: 'antepié izq. · P1_F', color: '#3ee0ff', valor: C('P1_F') },
            { label: 'talón der. · P2_H', color: '#ff8f6b', valor: C('P2_H') },
            { label: 'antepié der. · P2_F', color: '#ffd166', valor: C('P2_F') },
          ]}
        />
      )}
      {grupo === 'acel' && (
        <Grafico crudo={crudo} titulo="Módulo de la aceleración por IMU" unidad="g (1 g = 9,81 m/s²) · quieta ≈ 1,00 g" min={0} max={4} linea={{ v: 1, label: '1 g' }} series={IMU_COL.map(([k, l, c]) => ({ label: `${l} · ${k}`, color: c, valor: mag(k, 'a') }))} />
      )}
      {grupo === 'giro' && <Grafico crudo={crudo} titulo="Módulo de la velocidad angular por IMU" unidad="grados por segundo (°/s) · quieta ≈ 0 °/s" min={0} max={600} series={IMU_COL.map(([k, l, c]) => ({ label: `${l} · ${k}`, color: c, valor: mag(k, 'g') }))} />}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface">
          <p className="eyebrow border-b border-line px-4 py-2.5">Última muestra · {crudo.columnas.length} columnas</p>
          <div className="max-h-80 overflow-auto px-4 py-2 font-mono text-xs">
            {crudo.columnas.map((c, i) => (
              <div key={c} className="grid grid-cols-[1fr_auto_6.5rem] gap-3 border-b border-line/50 py-0.5">
                <span className="text-ink-2">{c}</span>
                <span className="tnum text-right">{c === 'flags' ? `0b${(last[i] >>> 0).toString(2).padStart(11, '0')}` : last[i]}</span>
                <span className="text-muted">{unidadColumna(c)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-line px-4 py-2.5 text-xs">
            <span className="text-muted">Banderas: </span>
            {banderas.length ? banderas.map((b) => <span key={b.bit} className={clsx('mr-2', b.grave ? 'text-bad' : 'text-mid')}>bit {b.bit} · {b.texto}</span>) : <span className="text-ok">ninguna</span>}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface">
          <p className="eyebrow border-b border-line px-4 py-2.5">Mensajes del firmware</p>
          <div className="max-h-[22rem] overflow-auto px-4 py-2 font-mono text-xs leading-relaxed text-ink-2">
            {crudo.mensajes.length ? crudo.mensajes.map((m, i) => <div key={i}>{m}</div>) : '—'}
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ dispositivo
const COMANDOS = [
  { c: 'i', t: 'Estado', d: 'Versión de firmware, frecuencia (Hz), velocidad (baud) y qué IMU detectó en qué dirección I2C.', cuando: 'Al conectar o si algo no responde.' },
  { c: 't', t: 'Tara', d: 'Toma la postura actual como cero de rodilla y tronco (°). Exige 1 s de quietud.', cuando: 'Con el atleta de pie, erguido y quieto, antes de cada sesión.' },
  { c: 'g', t: 'Calibrar giroscopio', d: 'Mide durante 2 s el sesgo de cada giroscopio (°/s) y lo resta; sin esto la orientación deriva.', cuando: 'Con las IMU quietas sobre la mesa. Una vez por día o si los ángulos se van solos.' },
  { c: 'a', t: 'Calibrar acelerómetro', d: 'Corrige el desfase para que quieta lea 1,00 g.', cuando: 'Con cada IMU plana, eje Z hacia arriba. Si la prueba guiada marca |a| ≠ 1,00 g.' },
  { c: 'm', t: 'Calibrar magnetómetro', d: 'Hierro duro (offset en µT). El campo magnético todavía no entra en la fusión.', cuando: '20 s girando la IMU en forma de 8. Opcional.' },
  { c: 'c', t: 'Ver calibraciones', d: 'Imprime los valores guardados en la memoria del ESP32 (sobreviven al apagado).', cuando: 'Para revisar o documentar.' },
  { c: 's', t: 'Iniciar transmisión', d: 'Reenvía el encabezado #COLS y retoma el envío de muestras.', cuando: 'Si la plataforma dejó de recibir datos.' },
  { c: 'x', t: 'Detener transmisión', d: 'Pausa el envío de muestras (el muestreo sigue).', cuando: 'Para leer mensajes sin el flujo de datos.' },
]

const TIPOS: Record<string, string> = { usb: 'ESP32 por USB', virtual: 'Banco virtual', wokwi: 'Wokwi', demo: 'Demostración' }

function Dispositivo() {
  const st = useLive((s) => s.status)
  const [enviado, setEnviado] = useState('')
  const enviar = async (c: string) => {
    await api.post('/api/pro/comando', { cmd: c })
    setEnviado(c)
    setTimeout(() => setEnviado(''), 1500)
  }
  const conectado = st?.estado === 'conectado'
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid gap-2">
        {COMANDOS.map((k) => (
          <div key={k.c} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-start gap-4 rounded-2xl border border-line bg-surface p-4">
            <span className="display-cond text-center text-3xl leading-none text-accent">{k.c}</span>
            <span className="leading-snug">
              <span className="block font-semibold">{k.t}</span>
              <span className="text-[14px] text-ink-2">{k.d}</span>
              <span className="mt-1 block text-[13px] text-muted">Cuándo: {k.cuando}</span>
            </span>
            <Button variant="ghost" onClick={() => enviar(k.c)} disabled={!conectado} data-testid={`cmd-${k.c}`}>
              {enviado === k.c ? 'Enviado' : 'Enviar'}
            </Button>
          </div>
        ))}
      </div>
      <aside className="flex flex-col gap-4">
        <div className={clsx('rounded-2xl border border-line border-l-2 bg-surface p-4', conectado && st?.fresco ? 'border-l-accent' : 'border-l-line-2')}>
          <p className="eyebrow mb-2">Enlace</p>
          <div className="flex items-center gap-3">
            <TrazoSenal className="h-6 w-14" />
            <span className="leading-tight">
              <span className="block font-semibold">{conectado ? (TIPOS[st?.tipo ?? ''] ?? 'Conectado') : 'Sin dispositivo'}</span>
              <span className="font-mono text-xs text-muted">{conectado ? `${Math.round(st?.hz ?? 0)} Hz · ${st?.perdidas ?? 0} perdidas · ${st?.fuente}` : 'conéctalo en Preparar o en el Banco'}</span>
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-muted">Tara</dt>
            <dd>{st?.tara ? 'aplicada' : 'pendiente'}</dd>
            <dt className="text-muted">Calibrando</dt>
            <dd>{st?.calibrando ? 'sí' : 'no'}</dd>
            {st?.imu.map((m) => (
              <div key={m.id} className="contents">
                <dt className="text-muted">IMU {m.id}</dt>
                <dd>{m.ok ? 'con señal' : m.ausente ? 'no conectada' : 'sin señal'}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4 text-[14px] text-ink-2">
          <p className="eyebrow mb-2">Revisión sensor por sensor</p>
          <p>La prueba guiada del Banco de pruebas detecta pines flotantes, cables cruzados, divisores que saturan e IMU sin señal, y guarda un reporte.</p>
          <Link to="/banco" className="mt-3 inline-block font-semibold text-accent">
            Ir al Banco de pruebas
          </Link>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="eyebrow mb-2">Últimos mensajes</p>
          <pre className="max-h-48 overflow-auto font-mono text-[11px] leading-relaxed text-ink-2">{(st?.mensajes ?? []).slice(-12).join('\n') || '—'}</pre>
        </div>
      </aside>
    </div>
  )
}

// ------------------------------------------------------------------ datos
interface FilaSalto {
  id: number
  atleta: string
  banco: boolean
  fecha: string
  indice: number
  categoria: string
  confianza: string
  escenario: string | null
  modo_salto: string
  metricas: Record<string, unknown>
}
const COLS_M: [string, string, string][] = [
  ['vuelo_ms', 'Vuelo', 'ms'],
  ['rodilla_contacto', 'Rodilla al contacto', '°'],
  ['rodilla_desplazamiento', 'Recorrido rodilla', '°'],
  ['tronco_contacto', 'Tronco al contacto', '°'],
  ['antepie_a_talon_ms', 'Antepié → talón', 'ms'],
  ['diferencia_contacto_ms', 'Dif. contacto', 'ms'],
  ['lsi_carga_pct', 'Simetría carga (LSI)', '%'],
  ['valgo_der_max', 'Valgo der. máx.', '°'],
  ['carga_pico_rel', 'Carga pico', '× de pie'],
  ['saturado_pct', 'FSR saturado', '%'],
]

function Datos({ token }: { token: string }) {
  const [filas, setFilas] = useState<FilaSalto[] | null>(null)
  const [ver, setVer] = useState<'atletas' | 'banco'>('atletas')
  useEffect(() => {
    api.get<FilaSalto[]>('/api/pro/saltos').then(setFilas).catch(() => setFilas([]))
  }, [token])
  const lista = (filas ?? []).filter((j) => (ver === 'banco' ? j.banco : !j.banco))
  const exportar = () => {
    const head = ['id', 'atleta', 'fecha', 'modo_salto', 'indice_0_100', 'categoria', 'confianza', ...COLS_M.map(([k, , u]) => `${k} (${u})`)]
    const body = lista.map((j) => [j.id, j.atleta, j.fecha, j.modo_salto, j.indice, j.categoria, j.confianza, ...COLS_M.map(([k]) => j.metricas[k] ?? '')])
    const csv = [head, ...body].map((r) => r.map((v) => (typeof v === 'string' && /[",;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v))).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `aterriza-saltos-${ver}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['atletas', 'Atletas'],
            ['banco', 'Banco de pruebas'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setVer(k)} className={clsx('rounded-full px-3 py-1.5 text-sm font-medium transition', ver === k ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-surface-2')}>
            {l} <span className="font-mono text-xs opacity-70">{(filas ?? []).filter((j) => (k === 'banco' ? j.banco : !j.banco)).length}</span>
          </button>
        ))}
        <Button variant="ghost" className="ml-auto" onClick={exportar} disabled={!lista.length} data-testid="pro-exportar">
          Exportar tabla (CSV)
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted">Índice de técnica 0 – 100 (no es riesgo de lesión). Ángulos en grados relativos a la tara; la carga es relativa a la de pie mientras los FSR no estén calibrados contra una plataforma de fuerza.</p>
      {filas === null ? (
        <p className="mt-6 flex items-center gap-2 text-muted"><Cargando /> Cargando…</p>
      ) : !lista.length ? (
        <p className="mt-6 text-muted">{ver === 'banco' ? 'Sin saltos de banco todavía.' : 'Sin saltos de atletas todavía.'}</p>
      ) : (
        <div className="mt-4 overflow-auto rounded-2xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 align-bottom">
              <tr>
                {['#', 'Atleta', 'Fecha', 'Modo', 'Índice'].map((h) => (
                  <th key={h} className="eyebrow px-3 py-2 font-normal">
                    {h}
                  </th>
                ))}
                {COLS_M.map(([k, l, u]) => (
                  <th key={k} className="px-3 py-2 text-right font-normal leading-tight">
                    <span className="eyebrow block">{l}</span>
                    <span className="font-mono text-[10px] text-muted">{u}</span>
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="font-mono">
              {lista.map((j) => (
                <tr key={j.id} className="border-t border-line">
                  <td className="px-3 py-2 text-muted">{j.id}</td>
                  <td className="px-3 font-sans">{j.atleta}</td>
                  <td className="whitespace-nowrap px-3">{j.fecha.replace('T', ' ').slice(0, 16)}</td>
                  <td className="px-3 font-sans text-ink-2">{j.modo_salto === 'sitio' ? 'en el sitio' : 'cajón'}</td>
                  <td className="px-3">
                    {j.indice} <span className="font-sans text-xs text-muted">{j.categoria}</span>
                  </td>
                  {COLS_M.map(([k]) => (
                    <td key={k} className="tnum px-3 text-right">
                      {j.metricas[k] === undefined || j.metricas[k] === null ? <span className="text-muted">—</span> : String(j.metricas[k]).replace('.', ',')}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3">
                    <a className="mr-3 text-accent" href={`/api/saltos/${j.id}/crudo.csv?token=${token}`}>
                      CSV crudo
                    </a>
                    <Link className="text-accent" to={`/salto/${j.id}`}>
                      Informe
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ criterios
type Regla = Record<string, unknown> & { id: string; nombre: string; item: number; tipo: string; umbral_ok: number; umbral_parcial: number; peso: number; unidad: string; porque?: string; fuente?: string; variable: string }
type Rules = { version: number; actualizado: string; reglas: Regla[] }

function Criterios({ token }: { token: string }) {
  const [rules, setRules] = useState<Rules | null>(null)
  const [edit, setEdit] = useState<Record<string, Record<string, number>>>({})
  const [abierto, setAbierto] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api.get<Rules>('/api/pro/reglas').then(setRules).catch(() => {})
  }, [token])
  if (!rules) return <p className="mt-8 flex items-center gap-2 text-muted"><Cargando /> Cargando…</p>
  const guardar = async () => {
    const r = await api.put<Rules>('/api/pro/reglas', edit)
    setRules(r)
    setEdit({})
    setMsg(`Guardado como versión ${r.version}. La anterior quedó en feedback/historial/.`)
  }
  const pesoTotal = rules.reglas.reduce((s, r) => s + (edit[r.id]?.peso ?? r.peso), 0)
  return (
    <div className="mt-6">
      <p className="max-w-[80ch] text-ink-2">
        Versión <b>{rules.version}</b> · {rules.actualizado}. Cada ítem compara una métrica del aterrizaje con dos umbrales: cumple, parcial o a corregir. El índice 0 – 100 es la suma de pesos de lo que cumple (la mitad si es parcial), sobre los ítems que se pudieron medir. Cambiar un valor crea una versión nueva de <code className="font-mono text-sm">feedback/rules.yaml</code>.
      </p>
      <div className="mt-4 overflow-auto rounded-2xl border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th className="eyebrow px-3 py-2 font-normal">LESS</th>
              <th className="eyebrow px-3 py-2 font-normal">Criterio</th>
              <th className="eyebrow px-3 py-2 font-normal">Cumple si</th>
              <th className="eyebrow px-3 py-2 font-normal">Parcial si</th>
              <th className="eyebrow px-3 py-2 font-normal">Peso · de {pesoTotal}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rules.reglas.map((r) => {
              const val = (k: string) => edit[r.id]?.[k] ?? (r[k] as number)
              const set = (k: string, v: string) => setEdit({ ...edit, [r.id]: { ...edit[r.id], [k]: Number(v) } })
              const u = String(r.unidad ?? '').trim() || 'puntaje 0 – 1'
              const op = r.tipo === 'menor' ? '≤' : '≥'
              const num = (k: string) => (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="font-mono text-muted">{op}</span>
                  <input type="number" step="any" className={clsx(inputCls, 'h-9 w-20 px-2 font-mono text-sm')} value={val(k)} onChange={(e) => set(k, e.target.value)} aria-label={`${r.nombre} · ${k}`} />
                  <span className="font-mono text-xs text-muted">{u}</span>
                </span>
              )
              return (
                <Fragment key={r.id}>
                  <tr className="border-t border-line align-middle">
                    <td className="px-3 py-2 font-mono text-muted">{r.item}</td>
                    <td className="px-3 leading-tight">
                      <span className="block font-medium">{r.nombre}</span>
                      <span className="font-mono text-[11px] text-muted">
                        {r.variable}
                        {r.tipo === 'doble' ? ' y desplazamiento (ambas)' : ''}
                      </span>
                    </td>
                    <td className="px-3">{num('umbral_ok')}</td>
                    <td className="px-3">{num('umbral_parcial')}</td>
                    <td className="px-3">
                      <input type="number" step="1" className={clsx(inputCls, 'h-9 w-20 px-2 font-mono text-sm')} value={val('peso')} onChange={(e) => set('peso', e.target.value)} aria-label={`${r.nombre} · peso`} />
                    </td>
                    <td className="px-3">
                      <button onClick={() => setAbierto(abierto === r.id ? null : r.id)} className="text-sm font-medium text-accent">
                        {abierto === r.id ? 'Cerrar' : 'Por qué'}
                      </button>
                    </td>
                  </tr>
                  {abierto === r.id && (
                    <tr className="bg-surface-2/50">
                      <td />
                      <td colSpan={5} className="px-3 pb-4 pt-1 text-[14px] leading-relaxed text-ink-2">
                        {r.porque}
                        <span className="mt-2 block font-mono text-xs text-muted">Fuente: {r.fuente}</span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={guardar} disabled={!Object.keys(edit).length}>
          Guardar nueva versión
        </Button>
        {Object.keys(edit).length > 0 && (
          <Button variant="quiet" onClick={() => setEdit({})}>
            Descartar cambios
          </Button>
        )}
        {msg && <p className="text-ok">{msg}</p>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ ajustes
function Ajustes({ token }: { token: string }) {
  const [cfg, setCfg] = useState<Record<string, unknown> | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api.get<Record<string, unknown>>('/api/pro/config').then(setCfg).catch(() => {})
  }, [token])
  if (!cfg) return <p className="mt-8 flex items-center gap-2 text-muted"><Cargando /> Cargando…</p>
  return (
    <form
      className="mt-6 grid max-w-2xl gap-6"
      onSubmit={async (e) => {
        e.preventDefault()
        setCfg(await api.put('/api/pro/config', cfg))
        setMsg('Ajustes guardados.')
      }}
    >
      <section className="grid gap-4 rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow">Plantillas</p>
        <Field label="Resistencia del divisor de los FSR · Ω" hint="Con FSR 402 se recomienda 1 000 Ω: con 10 000 Ω el sensor satura (≥ 4000 cuentas) con poca fuerza.">
          <input type="number" className={clsx(inputCls, 'font-mono')} value={Number(cfg.r_div)} onChange={(e) => setCfg({ ...cfg, r_div: Number(e.target.value) })} />
        </Field>
        <label className="flex items-start gap-3 text-[15px]">
          <input type="checkbox" checked={Boolean(cfg.fsr_calibrado)} onChange={(e) => setCfg({ ...cfg, fsr_calibrado: e.target.checked })} className="mt-1 size-5 accent-[var(--accent)]" />
          <span>
            FSR calibrados contra plataforma de fuerza
            <span className="block text-sm text-muted">Habilita la carga en % del peso corporal. Sin calibrar se reporta en «× carga de pie».</span>
          </span>
        </label>
      </section>
      <section className="grid gap-4 rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow">Protocolo</p>
        <Field label="Saltos por sesión · n.º">
          <input type="number" min={1} className={clsx(inputCls, 'font-mono')} value={Number(cfg.objetivo_saltos)} onChange={(e) => setCfg({ ...cfg, objetivo_saltos: Number(e.target.value) })} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow">Tipo de salto</span>
          <ModoSaltoToggle className="self-start !bg-surface-2" />
          <span className="text-xs text-muted">Se guarda al instante. Desde cajón es el protocolo LESS (caída de 35 cm); en el sitio es un salto vertical sin cajón.</span>
        </div>
      </section>
      <section className="grid gap-4 rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow">Acceso</p>
        <Field label="PIN del modo profesional">
          <input className={clsx(inputCls, 'font-mono')} value={String(cfg.pin)} onChange={(e) => setCfg({ ...cfg, pin: e.target.value })} />
        </Field>
      </section>
      <div className="flex items-center gap-3">
        <Button type="submit">Guardar ajustes</Button>
        {msg && <p className="text-ok">{msg}</p>}
      </div>
    </form>
  )
}

// ------------------------------------------------------------------ página
export default function Pro() {
  const { proToken, setProToken } = useApp()
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('senales')
  const [crudo, setCrudo] = useState<Crudo | null>(null)

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const r = await api.post<{ token: string }>('/api/pro/entrar', { pin })
      setProToken(r.token)
      setErr('')
    } catch (x) {
      setErr((x as Error).message)
    }
  }

  useEffect(() => {
    if (!proToken || tab !== 'senales') return
    const fail = (e: Error) => /401|bloqueado|token/i.test(e.message) && setProToken(null)
    const id = setInterval(() => api.get<Crudo>('/api/pro/crudo?segundos=6').then(setCrudo).catch(fail), 250)
    return () => clearInterval(id)
  }, [tab, proToken, setProToken])

  if (!proToken)
    return (
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center px-6">
        <form onSubmit={entrar} className="w-full max-w-sm rounded-[28px] border border-line bg-surface p-8 text-center">
          <MarcaPro abierto={false} className="mx-auto size-10 text-accent" />
          <h1 className="display-cond mt-4 text-3xl">Modo profesional</h1>
          <p className="mt-2 text-ink-2">Señales crudas con sus unidades, comandos del firmware, criterios del motor y exportación. Para el equipo y la docente.</p>
          <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} className={clsx(inputCls, 'mt-6 w-full text-center font-mono text-2xl tracking-[0.5em]')} placeholder="PIN" aria-label="PIN" data-testid="pin" />
          {err && <p className="mt-3 text-bad">{err}</p>}
          <Button type="submit" size="lg" className="mt-5 w-full">
            Entrar
          </Button>
        </form>
      </div>
    )

  return (
    <div className="mx-auto max-w-[1300px] px-6 pb-20 pt-8 lg:px-10" data-testid="pro">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="eyebrow">Para el equipo y la docente</p>
          <h1 className="display mt-2 text-4xl">Modo profesional</h1>
        </div>
        <Button variant="quiet" className="ml-auto" onClick={() => setProToken(null)}>
          Salir
        </Button>
      </div>
      <nav className="mt-6 grid grid-cols-2 gap-1 border-b border-line sm:grid-cols-5" role="tablist">
        {TABS.map(([k, l, sub]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx('-mb-px border-b-2 px-3 py-3 text-left transition', tab === k ? 'border-accent' : 'border-transparent hover:border-line-2')} data-testid={`pro-tab-${k}`}>
            <span className={clsx('block font-semibold', tab === k ? 'text-ink' : 'text-ink-2')}>{l}</span>
            <span className="font-mono text-[11px] text-muted">{sub}</span>
          </button>
        ))}
      </nav>
      {tab === 'senales' && <Senales crudo={crudo} />}
      {tab === 'dispositivo' && <Dispositivo />}
      {tab === 'datos' && <Datos token={proToken} />}
      {tab === 'criterios' && <Criterios token={proToken} />}
      {tab === 'ajustes' && <Ajustes token={proToken} />}
    </div>
  )
}
