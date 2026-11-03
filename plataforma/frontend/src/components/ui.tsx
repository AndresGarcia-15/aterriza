import * as Dialog from '@radix-ui/react-dialog'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { MarcaEstado } from './marks'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { Estado } from '../lib/types'

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <path d="M5 9c7 0 10.5 4 13 10.5S24 31 34 31" stroke="var(--accent)" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <circle cx="5" cy="9" r="2.6" fill="var(--accent)" />
      <rect x="4" y="33.5" width="32" height="2.8" rx="1.4" fill="currentColor" />
    </svg>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'quiet' | 'danger'; size?: 'md' | 'lg' | 'xl' }
export function Button({ variant = 'primary', size = 'md', className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={clsx(
        'group relative inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold transition-[transform,background,color,box-shadow] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        size === 'md' && 'h-11 px-5 text-[15px]',
        size === 'lg' && 'h-14 px-7 text-lg',
        size === 'xl' && 'h-[72px] px-10 text-xl',
        variant === 'primary' && 'bg-ink text-bg hover:shadow-[0_0_0_6px_var(--accent-soft)]',
        variant === 'ghost' && 'border border-line-2 bg-surface/60 text-ink backdrop-blur hover:border-ink/40',
        variant === 'quiet' && 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        variant === 'danger' && 'border border-bad/40 text-bad hover:bg-bad-soft',
        className,
      )}
    />
  )
}

type MarcaProps = { className?: string; strokeWidth?: number }
const marca = (e: Estado) => {
  const M = ({ className }: MarcaProps) => <MarcaEstado estado={e} className={className} />
  return M
}
export const ESTADO: Record<Estado, { label: string; color: string; soft: string; Icon: (p: MarcaProps) => React.ReactElement }> = {
  ok: { label: 'Cumple', color: 'text-ok', soft: 'bg-ok-soft', Icon: marca('ok') },
  parcial: { label: 'Parcial', color: 'text-mid', soft: 'bg-mid-soft', Icon: marca('parcial') },
  no: { label: 'A corregir', color: 'text-bad', soft: 'bg-bad-soft', Icon: marca('no') },
  no_disponible: { label: 'No disponible', color: 'text-muted', soft: 'bg-surface-2', Icon: marca('no_disponible') },
}

export function EstadoBadge({ estado, className }: { estado: Estado; className?: string }) {
  const e = ESTADO[estado]
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold', e.color, e.soft, className)}>
      <e.Icon className="size-4" />
      {e.label}
    </span>
  )
}

export const CAT_ESTADO: Record<string, Estado> = { Excelente: 'ok', Bien: 'ok', Mejorable: 'parcial', 'A corregir': 'no' }
export const estadoVar = (e: Estado) => (e === 'ok' ? 'var(--ok)' : e === 'parcial' ? 'var(--mid)' : e === 'no' ? 'var(--bad)' : 'var(--muted)')

/** Índice de técnica: anillo + número que cuenta hacia arriba. */
export function IndexRing({ value, estado, size = 260, delay = 0.2 }: { value: number; estado: Estado; size?: number; delay?: number }) {
  const mv = useMotionValue(0)
  const txt = useTransform(mv, (v) => Math.round(v).toString())
  const dash = useTransform(mv, (v) => `${(v / 100) * 289} 400`)
  useEffect(() => {
    const c = animate(mv, value, { duration: 1.6, delay, ease: [0.16, 1, 0.3, 1] })
    return () => c.stop()
  }, [value, delay, mv])
  const col = estadoVar(estado)
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`Índice de técnica ${value} de 100`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        <circle cx="50" cy="50" r="46" fill="none" stroke="var(--line)" strokeWidth="2.4" />
        {Array.from({ length: 50 }).map((_, i) => (
          <line key={i} x1="50" y1="1.5" x2="50" y2={i % 5 ? '3' : '4.5'} stroke="var(--line-2)" strokeWidth="0.5" transform={`rotate(${i * 7.2} 50 50)`} />
        ))}
        <motion.circle cx="50" cy="50" r="46" fill="none" stroke={col} strokeWidth="4.2" strokeLinecap="round" style={{ strokeDasharray: dash, filter: `drop-shadow(0 0 6px ${col})` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span className="display tnum" style={{ fontSize: size * 0.36, color: 'var(--ink)' }}>
          {txt}
        </motion.span>
        <span className="eyebrow mt-1">de 100</span>
      </div>
    </div>
  )
}

export function Sheet({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in" />
        <Dialog.Content className="fixed bottom-0 left-1/2 z-50 max-h-[85vh] w-full max-w-2xl -translate-x-1/2 overflow-auto rounded-t-3xl border border-line bg-surface p-8 shadow-2xl outline-none sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
          <Dialog.Title className="display-cond text-3xl">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          <div className="mt-4">{children}</div>
          <Dialog.Close asChild>
            <button className="absolute right-5 top-5 rounded-full p-2 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Cerrar">
              <X className="size-5" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function Disclaimer({ text, className }: { text: string; className?: string }) {
  return (
    <p className={clsx('flex items-center gap-2 text-sm text-muted', className)} data-testid="aviso-medico">
      <span className="inline-block size-1.5 rounded-full bg-muted" />
      {text}
    </p>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'h-12 rounded-xl border border-line-2 bg-surface px-4 text-[17px] text-ink outline-none transition placeholder:text-muted/60 focus:border-accent focus:shadow-[0_0_0_4px_var(--accent-soft)]'
