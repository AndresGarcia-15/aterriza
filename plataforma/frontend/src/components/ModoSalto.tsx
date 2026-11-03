import clsx from 'clsx'
import { api } from '../lib/api'
import { useLive } from '../lib/store'
import type { ModoSalto } from '../three/pose'

/** Modo de salto vigente (lo guarda el servidor: todas las pantallas lo comparten). */
export function useModoSalto(): ModoSalto {
  return useLive((s) => s.status?.modo_salto) ?? 'cajon'
}

export async function cambiarModo(modo: ModoSalto) {
  await api.put('/api/modo', { modo })
  const s = useLive.getState().status
  if (s) useLive.getState().set({ status: { ...s, modo_salto: modo } })
}

/** Selector "Desde cajón · En el sitio". */
export function ModoSaltoToggle({ className, compacto }: { className?: string; compacto?: boolean }) {
  const modo = useModoSalto()
  const op: [ModoSalto, string, string][] = [
    ['cajon', 'Desde cajón', 'caída de 35 cm · protocolo LESS'],
    ['sitio', 'En el sitio', 'salto vertical, sin cajón'],
  ]
  return (
    <div className={clsx('flex gap-1 rounded-2xl border border-line bg-surface/75 p-1 backdrop-blur', className)} role="radiogroup" aria-label="Modo de salto">
      {op.map(([v, l, sub]) => (
        <button key={v} role="radio" aria-checked={modo === v} onClick={() => cambiarModo(v)} title={sub} className={clsx('rounded-xl px-3 py-1.5 text-left text-sm font-medium transition', modo === v ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink')} data-testid={`modo-${v}`}>
          <span className="block leading-tight">{l}</span>
          {!compacto && <span className={clsx('block font-mono text-[10px] leading-tight', modo === v ? 'text-bg/70' : 'text-muted')}>{sub}</span>}
        </button>
      ))}
    </div>
  )
}
