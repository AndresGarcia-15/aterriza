import clsx from 'clsx'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useApp, useLive } from '../lib/store'
import { MarcaPro, MarcaTema, TrazoSenal } from './marks'
import { TareButton } from './TareButton'
import { Logo } from './ui'

function Conexion() {
  const st = useLive((s) => s.status)
  const ws = useLive((s) => s.conectadoWs)
  const tipo = st?.tipo === 'demo' ? 'Demo' : st?.tipo === 'wokwi' ? 'Wokwi' : st?.tipo === 'virtual' ? 'Banco virtual' : 'ESP32'
  const conectado = ws && st?.estado === 'conectado'
  return (
    <span className={clsx('inline-flex items-center gap-2.5 whitespace-nowrap border-l-2 py-1 pl-3 pr-1 font-mono text-xs', !ws ? 'border-bad text-bad' : conectado && st?.fresco ? 'border-accent text-ink-2' : 'border-line-2 text-muted')} data-testid="estado-conexion">
      <TrazoSenal />
      {!ws ? (
        'servidor sin conexión'
      ) : conectado ? (
        <span className="leading-tight">
          <span className="block text-ink">{tipo}</span>
          <span className="tnum">{st?.fresco ? `${Math.round(st.hz)} Hz` : 'sin datos'}</span>
        </span>
      ) : (
        'sin dispositivo'
      )}
    </span>
  )
}

const NAV = [
  { to: '/', label: 'Atleta' },
  { to: '/preparar', label: 'Preparación' },
  { to: '/evaluar', label: 'Evaluación' },
  { to: '/progreso', label: 'Progreso' },
]

export function Shell() {
  const { tema, toggleTema, atleta, proToken } = useApp()
  const loc = useLocation()
  const immersive = loc.pathname.startsWith('/evaluar')
  return (
    <div className="relative flex min-h-full flex-col">
      <header className={clsx('no-print z-30 flex h-16 items-center gap-6 px-6 lg:px-10', immersive ? 'absolute inset-x-0 top-0' : 'sticky top-0 border-b border-line/70 bg-bg/80 backdrop-blur-xl')}>
        <NavLink to="/" className="flex items-center gap-2.5 text-ink" aria-label="Inicio">
          <Logo className="size-8" />
          <span className="display text-[22px] tracking-tight">aterriza</span>
          <span className="eyebrow hidden pl-1 pt-1 xl:inline">UTB · técnica de aterrizaje</span>
        </NavLink>
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Principal">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => clsx('rounded-full px-4 py-2 text-[15px] font-medium transition', isActive ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink')}
            >
              {n.label}
            </NavLink>
          ))}
          <span className="mx-2 h-5 w-px bg-line-2" aria-hidden />
          <NavLink
            to="/banco"
            className={({ isActive }) => clsx('rounded-full px-4 py-2 text-[15px] font-medium transition', isActive ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink')}
            title="Probar el hardware sin atleta"
            data-testid="nav-banco"
          >
            Banco
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {atleta && (
            <span className="hidden items-center gap-2 whitespace-nowrap rounded-full bg-surface-2 py-1 pl-1 pr-3 text-sm font-medium 2xl:inline-flex">
              <span className="grid size-7 place-items-center rounded-full bg-accent text-[13px] font-bold text-accent-ink">{atleta.nombre.slice(0, 1).toUpperCase()}</span>
              {atleta.nombre}
            </span>
          )}
          <TareButton />
          <Conexion />
          <button onClick={toggleTema} className="rounded-full p-2.5 text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>
            <MarcaTema oscuro={tema === 'dark'} />
          </button>
          <NavLink to="/pro" className="rounded-full p-2.5 text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Modo profesional" title="Modo profesional">
            <MarcaPro abierto={!!proToken} />
          </NavLink>
        </div>
      </header>
      <main className="relative flex-1">
        <Outlet />
      </main>
    </div>
  )
}
