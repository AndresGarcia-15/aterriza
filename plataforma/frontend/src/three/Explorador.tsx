/**
 * Explorador 3D: cualquier pieza envuelta en <Pieza> se puede señalar (nombre al
 * pasar el mouse), hundir (clic → la cámara se acerca y se abre su ficha) y
 * soltar (Esc o «Vista general»). Lo usan el banco de hardware y el atleta con
 * sensores. Las fichas viven en lib/fichas.ts.
 */
import { Html } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { create } from 'zustand'
import { FICHAS } from '../lib/fichas'
import { sceneColors } from './Athlete'

interface Foco {
  target: THREE.Vector3
  dist: number
  n: number // cambia en cada clic (re-enfocar la misma pieza)
}
interface Explora {
  sel: string | null
  hover: string | null
  foco: Foco | null
  setHover: (id: string | null) => void
  elegir: (id: string, target: THREE.Vector3, dist: number) => void
  soltar: () => void
}
export const useExplora = create<Explora>((set, get) => ({
  sel: null,
  hover: null,
  foco: null,
  setHover: (hover) => set({ hover }),
  elegir: (sel, target, dist) => set({ sel, foco: { target: target.clone(), dist, n: (get().foco?.n ?? 0) + 1 } }),
  soltar: () => set({ sel: null, foco: null }),
}))

// ------------------------------------------------------------------ marco de selección
/** Esquinas de la caja que encierra la pieza (como las marcas de corte de un plano). */
function Esquinas({ of, activo, fuerte }: { of: React.RefObject<THREE.Group | null>; activo: boolean; fuerte: boolean }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3 * 2 * 3), 3))
    return g
  }, [])
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: sceneColors().accent, transparent: true, depthTest: false }), [])
  const line = useRef<THREE.LineSegments>(null)
  const box = useMemo(() => new THREE.Box3(), [])
  const inv = useMemo(() => new THREE.Matrix4(), [])
  useFrame(() => {
    const L = line.current
    const g = of.current
    if (!L || !g) return
    L.visible = activo
    if (!activo) return
    L.visible = false // que no se mida a sí mismo
    box.makeEmpty()
    g.updateWorldMatrix(true, true)
    g.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && m.visible && m.geometry && !m.userData.sinMarco) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
        box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld))
      }
    })
    L.visible = true
    if (box.isEmpty()) return
    box.expandByScalar(0.006)
    // coordenadas del marco en el espacio del grupo padre del LineSegments
    inv.copy(L.parent!.matrixWorld).invert()
    const { min, max } = box
    const sz = Math.min(max.x - min.x, max.y - min.y, max.z - min.z, 0.6)
    const k = Math.max(0.008, sz * 0.28)
    const a = geo.getAttribute('position') as THREE.BufferAttribute
    let i = 0
    const v = new THREE.Vector3()
    const push = (x: number, y: number, z: number) => {
      v.set(x, y, z).applyMatrix4(inv)
      a.setXYZ(i++, v.x, v.y, v.z)
    }
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) {
          const sx = x === min.x ? 1 : -1
          const sy = y === min.y ? 1 : -1
          const sz2 = z === min.z ? 1 : -1
          push(x, y, z)
          push(x + sx * k, y, z)
          push(x, y, z)
          push(x, y + sy * k, z)
          push(x, y, z)
          push(x, y, z + sz2 * k)
        }
    a.needsUpdate = true
    geo.computeBoundingSphere()
    mat.opacity = fuerte ? 1 : 0.55
  })
  return <lineSegments ref={line} geometry={geo} material={mat} renderOrder={20} frustumCulled={false} visible={false} raycast={() => null} />
}

// ------------------------------------------------------------------ pieza
/**
 * Envuelve una pieza explorable. `dist` = distancia de la cámara al enfocarla (m).
 * Si la pieza tiene una acción propia (presionar un FSR, girar una IMU en el banco
 * virtual), la ficha se abre con doble clic.
 */
export function Pieza({ id, dist = 0.3, conAccion = false, children }: { id: string; dist?: number; conAccion?: boolean; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  const sel = useExplora((s) => s.sel === id)
  const hover = useExplora((s) => s.hover === id)
  const [punto, setPunto] = useState<THREE.Vector3 | null>(null)
  const ficha = FICHAS[id]

  const centro = () => {
    const b = new THREE.Box3().setFromObject(ref.current!)
    return b.getCenter(new THREE.Vector3())
  }
  const abrir = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 6) return // fue un arrastre para girar la cámara
    useExplora.getState().elegir(id, centro(), dist)
  }
  return (
    <group
      ref={ref}
      onPointerOver={(e) => {
        e.stopPropagation()
        useExplora.getState().setHover(id)
        setPunto(e.point.clone())
        document.body.style.cursor = 'pointer'
      }}
      onPointerMove={(e) => {
        e.stopPropagation()
        if (useExplora.getState().hover === id) setPunto(e.point.clone())
      }}
      onPointerOut={() => {
        if (useExplora.getState().hover === id) useExplora.getState().setHover(null)
        setPunto(null)
        document.body.style.cursor = ''
      }}
      onClick={conAccion ? undefined : abrir}
      onDoubleClick={conAccion ? abrir : undefined}
    >
      {children}
      <Esquinas of={ref} activo={sel || hover} fuerte={sel} />
      {hover && !sel && punto && ficha && (
        <EtiquetaMundo punto={punto} texto={ficha.titulo} pista={conAccion ? 'doble clic: ficha' : 'clic: ficha'} padre={ref} />
      )}
    </group>
  )
}

/** Nombre de la pieza junto al puntero (coordenadas de mundo → locales del grupo). */
function EtiquetaMundo({ punto, texto, pista, padre }: { punto: THREE.Vector3; texto: string; pista: string; padre: React.RefObject<THREE.Group | null> }) {
  const local = useMemo(() => (padre.current ? padre.current.worldToLocal(punto.clone()) : punto), [punto, padre])
  return (
    <Html position={local} zIndexRange={[30, 20]} style={{ pointerEvents: 'none', transform: 'translate(14px, -50%)' }}>
      <div className="whitespace-nowrap border-l-2 border-accent bg-surface/90 py-1 pl-2 pr-2.5 leading-tight shadow-sm backdrop-blur">
        <span className="block text-[13px] font-semibold text-ink">{texto}</span>
        <span className="font-mono text-[10px] text-muted">{pista}</span>
      </div>
    </Html>
  )
}

// ------------------------------------------------------------------ cámara
/** Lleva la cámara orbital hacia la pieza elegida (sin quitarle el control al usuario). */
export function FocoCamara() {
  const foco = useExplora((s) => s.foco)
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null
  const camera = useThree((s) => s.camera)
  const anim = useRef<{ t: number; from: THREE.Vector3; fromT: THREE.Vector3; to: THREE.Vector3; toT: THREE.Vector3 } | null>(null)
  useEffect(() => {
    if (!foco || !controls) return
    const dir = camera.position.clone().sub(controls.target).normalize()
    // si la cámara está casi a ras del piso, que mire un poco desde arriba
    if (dir.y < 0.25) dir.y = 0.35
    dir.normalize()
    anim.current = { t: 0, from: camera.position.clone(), fromT: controls.target.clone(), toT: foco.target.clone(), to: foco.target.clone().add(dir.multiplyScalar(foco.dist)) }
  }, [foco, controls, camera])
  useFrame((_, dt) => {
    const a = anim.current
    if (!a || !controls) return
    a.t = Math.min(1, a.t + dt / 0.85)
    const e = 1 - Math.pow(1 - a.t, 3)
    camera.position.lerpVectors(a.from, a.to, e)
    controls.target.lerpVectors(a.fromT, a.toT, e)
    controls.update()
    if (a.t >= 1) anim.current = null
  })
  return null
}

// ------------------------------------------------------------------ ficha (DOM)
function useAhora(fn?: () => string | null) {
  const [v, setV] = useState<string | null>(() => fn?.() ?? null)
  useEffect(() => {
    if (!fn) return
    const id = setInterval(() => setV(fn()), 250)
    return () => clearInterval(id)
  }, [fn])
  return fn ? v : null
}

function Filas({ titulo, filas }: { titulo: string; filas: [string, string][] }) {
  return (
    <div>
      <p className="eyebrow mb-1.5">{titulo}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        {filas.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="font-mono text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Panel con la ficha de la pieza elegida, sobre la escena. `modo` decide si se muestra
 *  dónde va en el cuerpo (vista del atleta) o el cableado (vista del hardware). */
export function FichaPanel({ modo, className }: { modo: 'hardware' | 'atleta'; className?: string }) {
  const sel = useExplora((s) => s.sel)
  const f = sel ? FICHAS[sel] : null
  const ahora = useAhora(f?.ahora)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && useExplora.getState().soltar()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  if (!f) return null
  return (
    <aside className={clsx('w-[min(380px,calc(100%-2rem))] overflow-y-auto border border-line bg-surface/92 p-5 shadow-lg backdrop-blur', className)} data-testid="ficha" data-ficha={f.id}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{f.modelo}</p>
          <h3 className="display-cond mt-1 text-2xl leading-7">{f.titulo}</h3>
        </div>
        <button onClick={() => useExplora.getState().soltar()} className="-mr-1 -mt-1 grid size-8 place-items-center text-muted hover:text-ink" aria-label="Cerrar ficha" data-testid="ficha-cerrar">
          <X className="size-4" />
        </button>
      </div>
      {ahora && (
        <p className="mt-3 border-l-2 border-accent pl-2.5 font-mono text-xs text-ink" data-testid="ficha-ahora">
          <span className="text-muted">ahora · </span>
          {ahora}
        </p>
      )}
      {f.estado && <p className="mt-3 bg-mid-soft px-3 py-2 text-[13px] text-mid">{f.estado}</p>}
      <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{f.que}</p>
      <p className="mt-2 text-[14px] leading-relaxed text-ink">
        <b>En Aterriza: </b>
        {f.rol}
      </p>
      {modo === 'atleta' && f.donde && (
        <p className="mt-2 text-[14px] leading-relaxed text-ink">
          <b>Dónde va: </b>
          {f.donde}
        </p>
      )}
      <div className="mt-4 grid gap-4 border-t border-line pt-4">
        <Filas titulo="Especificaciones" filas={f.specs} />
        {f.conexion && <Filas titulo="Conexión" filas={f.conexion} />}
      </div>
    </aside>
  )
}
