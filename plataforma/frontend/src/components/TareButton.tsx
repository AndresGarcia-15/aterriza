import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useLive } from '../lib/store'
import { Cargando, MarcaCero } from './marks'

/**
 * Tara rápida, siempre a mano en la barra superior mientras hay un dispositivo:
 * la postura actual pasa a ser el cero (rodilla, tronco y muslo = 0°). Necesita
 * 1 s de quietud de las IMU.
 */
export function TareButton({ className }: { className?: string }) {
  const st = useLive((s) => s.status)
  const [estado, setEstado] = useState<'' | 'esperando' | 'ok' | 'error'>('')
  useEffect(() => {
    if (estado !== 'ok' && estado !== 'error') return
    const t = setTimeout(() => setEstado(''), estado === 'ok' ? 2500 : 4000)
    return () => clearTimeout(t)
  }, [estado])
  if (!st || st.estado !== 'conectado') return null

  const tarar = async () => {
    setEstado('esperando')
    try {
      const r = await api.post<{ ok: boolean }>('/api/tara')
      setEstado(r.ok ? 'ok' : 'error')
    } catch {
      setEstado('error')
    }
  }
  const sinTara = !st.tara && estado === ''
  const label = estado === 'esperando' ? 'Quieto…' : estado === 'ok' ? 'Cero listo' : estado === 'error' ? 'Sin quietud' : 'Tarar'
  const title =
    estado === 'error'
      ? 'No hubo 1 s de quietud. Deja las IMU (o al atleta) quietas y vuelve a tarar.'
      : 'Pone en 0 los ángulos con la postura actual: atleta de pie y quieto, o las IMU en su posición de referencia (X hacia arriba).'
  return (
    <button
      onClick={tarar}
      disabled={estado === 'esperando'}
      title={title}
      className={clsx(
        'inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold transition',
        estado === 'ok' ? 'border-ok/50 bg-ok-soft text-ok' : estado === 'error' ? 'border-bad/50 bg-bad-soft text-bad' : sinTara ? 'border-mid/60 bg-mid-soft text-mid hover:border-mid' : 'border-line text-ink-2 hover:border-line-2 hover:text-ink',
        className,
      )}
      data-testid="tarar"
    >
      {estado === 'esperando' ? <Cargando /> : <MarcaCero />}
      {label}
    </button>
  )
}
