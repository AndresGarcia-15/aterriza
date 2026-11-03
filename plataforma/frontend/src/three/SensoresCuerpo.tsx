/**
 * Los sensores de Aterriza en su sitio sobre el atleta 3D, acoplados a los huesos
 * (se mueven con él al saltar):
 *   IMU muslo   cara anterolateral del muslo derecho, a media altura, con banda elástica
 *   IMU pierna  cara anterior de la tibia derecha, tercio medio
 *   IMU lumbar  L3–L5 sobre la columna, en un cinturón (pendiente de instalar)
 *   ESP32       en el mismo cinturón, atrás a la derecha
 *   Plantillas  bajo cada pie, con el FSR del talón y el del antepié
 * Las bandas se ajustan a la superficie real del cuerpo: se toma el contorno de la
 * malla en reposo (vértices del hueso correspondiente) a esa altura.
 * Todo es explorable: clic → ficha (Explorador.tsx).
 */
import { Line } from '@react-three/drei'
import { createPortal, useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Line2 } from 'three-stdlib'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { FOOT } from '../components/Footprints'
import { hwNow } from '../lib/banco'
import { sceneColors, type AthleteRig, type BoneName } from './Athlete'
import { sinRayos } from './BenchRig'
import { Pieza } from './Explorador'

// ------------------------------------------------------------------ geometría del cuerpo en reposo
interface Cuerpo {
  pos: Float32Array // posiciones en reposo (espacio del atleta)
  hueso: string[] // hueso dominante de cada vértice
}
const cache = new WeakMap<THREE.Group, Cuerpo>()

function cuerpoEnReposo(rig: AthleteRig): Cuerpo {
  const hit = cache.get(rig.root)
  if (hit) return hit
  const pos: number[] = []
  const hueso: string[] = []
  const v = new THREE.Vector3()
  // la pose actual puede no ser la de reposo: se mide con el esqueleto en su pose de enlace
  for (const m of rig.meshes) {
    const si = m.geometry.getAttribute('skinIndex')
    const sw = m.geometry.getAttribute('skinWeight')
    const p = m.geometry.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      // reposo = posición de enlace: bindMatrix · v (la malla se modeló en la pose T)
      v.fromBufferAttribute(p, i).applyMatrix4(m.bindMatrix)
      pos.push(v.x, v.y, v.z)
      let best = 0
      let bw = -1
      for (let c = 0; c < 4; c++) {
        const w = sw.getComponent(i, c)
        if (w > bw) {
          bw = w
          best = si.getComponent(i, c)
        }
      }
      hueso.push(m.skeleton.bones[best].name.replace('mixamorig', '').replace(':', ''))
    }
  }
  const c = { pos: new Float32Array(pos), hueso }
  cache.set(rig.root, c)
  return c
}

const N = 40 // puntos del contorno de una banda

/** Contorno de la superficie alrededor de un eje (centro c, dirección a) con los vértices
 *  de los huesos dados dentro de una franja de ±slab. Devuelve N puntos (uno por ángulo). */
function contorno(cu: Cuerpo, huesos: string[], c: THREE.Vector3, a: THREE.Vector3, slab = 0.014) {
  const u = new THREE.Vector3(0, 0, 1).cross(a)
  if (u.lengthSq() < 1e-4) u.set(1, 0, 0).cross(a)
  u.normalize()
  const w = a.clone().cross(u).normalize()
  const r = new Float32Array(N).fill(0)
  const d = new THREE.Vector3()
  for (let i = 0; i < cu.hueso.length; i++) {
    if (!huesos.includes(cu.hueso[i])) continue
    d.set(cu.pos[i * 3] - c.x, cu.pos[i * 3 + 1] - c.y, cu.pos[i * 3 + 2] - c.z)
    const ax = d.dot(a)
    if (Math.abs(ax) > slab) continue
    const x = d.dot(u)
    const y = d.dot(w)
    const rr = Math.hypot(x, y)
    if (rr > 0.25) continue
    const k = Math.round(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * N) % N
    if (rr > r[k]) r[k] = rr
  }
  // huecos: interpolar entre vecinos; luego suavizar
  const media = r.reduce((s, x) => s + x, 0) / Math.max(1, r.filter((x) => x > 0).length)
  for (let k = 0; k < N; k++) {
    if (r[k] > 0) continue
    let i = 1
    while (i < N && r[(k + i) % N] === 0 && r[(k - i + N) % N] === 0) i++
    r[k] = r[(k + i) % N] || r[(k - i + N) % N] || media
  }
  const rs = Array.from(r, (_, k) => (r[(k - 1 + N) % N] + 2 * r[k] + r[(k + 1) % N]) / 4)
  const punto = (ang: number, extra = 0) => {
    const k = Math.round(((ang + Math.PI) / (2 * Math.PI)) * N) % N
    const rr = rs[k] + extra
    return c.clone().addScaledVector(u, Math.cos(ang) * rr).addScaledVector(w, Math.sin(ang) * rr)
  }
  /** Ángulo (en el plano u-w) de una dirección del mundo. */
  const angulo = (dir: THREE.Vector3) => Math.atan2(dir.dot(w), dir.dot(u))
  const pts = Array.from({ length: N }, (_, k) => punto((k / N) * 2 * Math.PI - Math.PI, 0.0025))
  return { pts, punto, angulo, u, w }
}

function cinta(pts: THREE.Vector3[], a: THREE.Vector3, ancho: number) {
  const pos: number[] = []
  const idx: number[] = []
  pts.forEach((p) => {
    pos.push(p.x - (a.x * ancho) / 2, p.y - (a.y * ancho) / 2, p.z - (a.z * ancho) / 2)
    pos.push(p.x + (a.x * ancho) / 2, p.y + (a.y * ancho) / 2, p.z + (a.z * ancho) / 2)
  })
  for (let k = 0; k < pts.length; k++) {
    const i = k * 2
    const j = ((k + 1) % pts.length) * 2
    idx.push(i, j, i + 1, j, j + 1, i + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Base ortonormal de un sensor sobre la piel: Z sale de la piel, X apunta a `haciaX`. */
function baseSensor(pos: THREE.Vector3, normal: THREE.Vector3, haciaX: THREE.Vector3) {
  const z = normal.clone().normalize()
  const x = haciaX.clone().addScaledVector(z, -haciaX.dot(z)).normalize()
  const y = z.clone().cross(x)
  const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(pos)
  const q = new THREE.Quaternion().setFromRotationMatrix(m)
  return { pos, q }
}

// ------------------------------------------------------------------ sitios
interface Banda {
  hueso: BoneName
  geo: THREE.BufferGeometry
}
interface Sitios {
  bandas: Banda[]
  imu: Record<'T' | 'P' | 'L', { hueso: BoneName; pos: THREE.Vector3; q: THREE.Quaternion }>
  esp: { hueso: BoneName; pos: THREE.Vector3; q: THREE.Quaternion }
  pies: { hueso: BoneName; izq: boolean; centro: THREE.Vector3; s: number }[]
}

function calcularSitios(rig: AthleteRig): Sitios {
  const cu = cuerpoEnReposo(rig)
  const R = rig.restPos
  const bandas: Banda[] = []
  const lerp = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t)

  // muslo derecho: banda a media altura, sensor anterolateral (la derecha del atleta es −X)
  const aT = R.RightLeg.clone().sub(R.RightUpLeg).normalize()
  const cT = lerp(R.RightUpLeg, R.RightLeg, 0.5)
  const kT = contorno(cu, ['RightUpLeg'], cT, aT)
  bandas.push({ hueso: 'RightUpLeg', geo: cinta(kT.pts, aT, 0.04) })
  const dT = new THREE.Vector3(-0.45, 0, 0.9).normalize()
  const angT = kT.angulo(dT)
  const pT = kT.punto(angT, 0.0065)
  const nT = pT.clone().sub(cT).addScaledVector(aT, -pT.clone().sub(cT).dot(aT)).normalize()

  // pierna derecha: tercio medio de la tibia, cara anterior (un poco medial, +X)
  const aP = R.RightFoot.clone().sub(R.RightLeg).normalize()
  const cP = lerp(R.RightLeg, R.RightFoot, 0.42)
  const kP = contorno(cu, ['RightLeg'], cP, aP)
  bandas.push({ hueso: 'RightLeg', geo: cinta(kP.pts, aP, 0.035) })
  const dP = new THREE.Vector3(0.2, 0, 1).normalize()
  const pP = kP.punto(kP.angulo(dP), 0.0065)
  const nP = pP.clone().sub(cP).addScaledVector(aP, -pP.clone().sub(cP).dot(aP)).normalize()

  // cinturón a la altura de L3–L5: sensor lumbar atrás al centro, ESP32 atrás a la derecha
  const aL = R.Spine.clone().sub(R.Hips).normalize()
  const cL = lerp(R.Hips, R.Spine, 0.55)
  const kL = contorno(cu, ['Hips', 'Spine'], cL, aL, 0.016)
  bandas.push({ hueso: 'Hips', geo: cinta(kL.pts, aL, 0.045) })
  const pL = kL.punto(kL.angulo(new THREE.Vector3(0, 0, -1)), 0.0065)
  const nL = pL.clone().sub(cL).addScaledVector(aL, -pL.clone().sub(cL).dot(aL)).normalize()
  const dE = new THREE.Vector3(-0.75, 0, -0.62).normalize()
  const pE = kL.punto(kL.angulo(dE), 0.012)
  const nE = pE.clone().sub(cL).addScaledVector(aL, -pE.clone().sub(cL).dot(aL)).normalize()

  // plantillas: largo del pie medido del talón a la punta; la suela es el vértice más bajo del pie
  let suela = Infinity
  cu.hueso.forEach((h, i) => /Foot|Toe/.test(h) && (suela = Math.min(suela, cu.pos[i * 3 + 1])))
  if (!Number.isFinite(suela)) suela = 0
  const pies = (['RightFoot', 'LeftFoot'] as const).map((h) => {
    const izq = h === 'LeftFoot'
    const toe = izq ? R.LeftToe_End : R.RightToe_End
    const ankle = R[h]
    const talon = ankle.z - 0.075
    const largo = toe.z + 0.008 - talon
    const s = largo / 180 // el contorno FOOT mide 180 unidades de punta a talón
    return { hueso: h as BoneName, izq, centro: new THREE.Vector3(ankle.x, suela + 0.002, (talon + toe.z + 0.008) / 2), s }
  })

  return {
    bandas,
    imu: {
      T: { hueso: 'RightUpLeg', ...baseSensor(pT, nT, aT.clone().negate()) },
      P: { hueso: 'RightLeg', ...baseSensor(pP, nP, aP.clone().negate()) },
      L: { hueso: 'Spine', ...baseSensor(pL, nL, aL) },
    },
    esp: { hueso: 'Hips', ...baseSensor(pE, nE, aL) },
    pies,
  }
}

// ------------------------------------------------------------------ piezas
const EJES: [THREE.Vector3, string][] = [
  [new THREE.Vector3(1, 0, 0), '#ff5a6a'],
  [new THREE.Vector3(0, 1, 0), '#3ddc84'],
  [new THREE.Vector3(0, 0, 1), '#4ea8ff'],
]

function ImuCuerpo({ n, ejes }: { n: number; ejes: boolean }) {
  const pcb = useRef<THREE.MeshStandardMaterial>(null)
  const flechas = useMemo(() => EJES.map(([d, c]) => sinRayos(new THREE.ArrowHelper(d, new THREE.Vector3(0, 0, 0.002), 0.032, c, 0.008, 0.005))), [])
  useFrame(() => {
    const hw = hwNow()
    const ok = hw?.ok ? !!hw.ok[n] : true
    if (pcb.current) {
      pcb.current.color.set(ok ? '#1f46b8' : '#5a6170')
      pcb.current.opacity = ok ? 1 : 0.55
      pcb.current.transparent = !ok
    }
  })
  return (
    <group>
      {/* carcasa impresa y placa */}
      <mesh castShadow>
        <boxGeometry args={[0.032, 0.026, 0.006]} />
        <meshStandardMaterial color="#14181d" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.0034]}>
        <boxGeometry args={[0.024, 0.018, 0.0012]} />
        <meshStandardMaterial ref={pcb} color="#1f46b8" roughness={0.5} />
      </mesh>
      <mesh position={[0.002, 0.001, 0.0045]}>
        <boxGeometry args={[0.006, 0.006, 0.001]} />
        <meshStandardMaterial color="#0d0f12" />
      </mesh>
      {ejes && flechas.map((f, i) => <primitive key={i} object={f} />)}
    </group>
  )
}

function EspCuerpo() {
  const led = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(() => {
    if (led.current) led.current.emissiveIntensity = hwNow() ? 2.2 : 0
  })
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[0.062, 0.034, 0.016]} />
        <meshStandardMaterial color="#14181d" roughness={0.6} />
      </mesh>
      <mesh position={[0.005, 0, 0.0085]}>
        <boxGeometry args={[0.03, 0.022, 0.002]} />
        <meshStandardMaterial color="#c3c9d0" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[-0.026, 0.01, 0.0085]}>
        <sphereGeometry args={[0.0018, 10, 10]} />
        <meshStandardMaterial ref={led} color="#1b1b1b" emissive="#ff3b3b" />
      </mesh>
    </group>
  )
}

function heat(v: number, out: THREE.Color) {
  const x = Math.max(0, Math.min(1, v))
  return x < 0.5 ? out.setRGB(0.12 + 0.08 * x, 0.35 + 1.1 * x, 0.9 - 0.1 * x) : out.setRGB(0.16 + 1.68 * (x - 0.5), 0.9 - 0.9 * (x - 0.5), 0.84 - 1.0 * (x - 0.5))
}

function PadCuerpo({ k, s }: { k: number; s: number }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b2f36', metalness: 0.3, roughness: 0.4, emissive: '#000000' }), [])
  const col = useMemo(() => new THREE.Color(), [])
  useFrame(() => {
    const raw = hwNow()?.raw[k] ?? 0
    heat((raw / 4095) * 1.25, col)
    mat.emissive.copy(col)
    mat.emissiveIntensity = raw > 50 ? 0.4 + 2.2 * (raw / 4095) : 0.12
  })
  const talon = k % 2 === 0
  return (
    <mesh material={mat} position={[0, 0.0045, ((talon ? 158 : 52) - 96) * s]}>
      <cylinderGeometry args={[0.0127 / 2 + 0.003, 0.0127 / 2 + 0.003, 0.0012, 28]} />
    </mesh>
  )
}

function useFoot() {
  return useMemo(() => {
    const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${FOOT}"/></svg>`)
    const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p))
    const g = new THREE.ExtrudeGeometry(shapes, { depth: 3, bevelEnabled: false, curveSegments: 24 })
    g.translate(-50, -96, 0)
    g.computeVertexNormals()
    return g
  }, [])
}

/** Plantilla bajo el pie (misma orientación que en el banco, girada para mirar a +Z). */
function PlantillaCuerpo({ izq, s, dark }: { izq: boolean; s: number; dark: boolean }) {
  const geo = useFoot()
  return (
    <group rotation-y={Math.PI}>
      <mesh geometry={geo} rotation-x={Math.PI / 2} position={[0, 0.0035, 0]} scale={[s * (izq ? -1 : 1), s, s]}>
        <meshStandardMaterial color={dark ? '#30363f' : '#d5d8d2'} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// ------------------------------------------------------------------ cables
/** Cables del cinturón a cada sensor: se recalculan en cada cuadro siguiendo al cuerpo. */
function Cable({ de, a, centro, color }: { de: React.RefObject<THREE.Object3D | null>; a: React.RefObject<THREE.Object3D | null>; centro: () => THREE.Vector3; color: string }) {
  const line = useRef<Line2>(null)
  const tmp = useMemo(() => ({ p0: new THREE.Vector3(), p1: new THREE.Vector3(), m: new THREE.Vector3(), out: new THREE.Vector3(), arr: new Float32Array(25 * 3) }), [])
  useFrame(() => {
    if (!de.current || !a.current || !line.current) return
    const padre = line.current.parent
    de.current.getWorldPosition(tmp.p0)
    a.current.getWorldPosition(tmp.p1)
    const c = centro()
    if (padre) {
      padre.worldToLocal(tmp.p0)
      padre.worldToLocal(tmp.p1)
      padre.worldToLocal(c)
    }
    tmp.m.copy(tmp.p0).add(tmp.p1).multiplyScalar(0.5)
    tmp.out.set(tmp.m.x - c.x, 0, tmp.m.z - c.z)
    if (tmp.out.lengthSq() < 1e-6) tmp.out.set(-1, 0, 0)
    tmp.out.normalize()
    tmp.m.addScaledVector(tmp.out, 0.07)
    for (let i = 0; i < 25; i++) {
      const t = i / 24
      const a1 = (1 - t) * (1 - t)
      const b1 = 2 * (1 - t) * t
      const c1 = t * t
      tmp.arr[i * 3] = a1 * tmp.p0.x + b1 * tmp.m.x + c1 * tmp.p1.x
      tmp.arr[i * 3 + 1] = a1 * tmp.p0.y + b1 * tmp.m.y + c1 * tmp.p1.y
      tmp.arr[i * 3 + 2] = a1 * tmp.p0.z + b1 * tmp.m.z + c1 * tmp.p1.z
    }
    line.current.geometry.setPositions(tmp.arr)
  })
  // los puntos iniciales se reemplazan en el primer cuadro (en coordenadas del grupo del atleta)
  return <Line ref={line} points={[[0, 0, 0], [0, 0.001, 0]]} color={color} lineWidth={1.6} transparent opacity={0.85} frustumCulled={false} raycast={() => null} />
}

// ------------------------------------------------------------------ conjunto
/** En el espacio de reposo del atleta: se monta como hijo del hueso con la inversa de su
 *  matriz de reposo, así todo se describe en coordenadas de reposo y se mueve con él. */
function EnHueso({ rig, hueso, children }: { rig: AthleteRig; hueso: BoneName; children: ReactNode }) {
  const m = useMemo(() => rig.restMat[hueso].clone().invert(), [rig, hueso])
  return createPortal(
    <group matrixAutoUpdate={false} matrix={m}>
      {children}
    </group>,
    rig.bones[hueso],
  )
}

export function SensoresCuerpo({ rig, ejes = true, cables = true }: { rig: AthleteRig; ejes?: boolean; cables?: boolean }) {
  const sitios = useMemo(() => calcularSitios(rig), [rig])
  const dark = sceneColors().dark
  const banda = useMemo(() => new THREE.MeshStandardMaterial({ color: dark ? '#262b33' : '#3a4049', roughness: 0.95, side: THREE.DoubleSide }), [dark])
  const anclas = {
    esp: useRef<THREE.Group>(null),
    T: useRef<THREE.Group>(null),
    P: useRef<THREE.Group>(null),
    L: useRef<THREE.Group>(null),
    izq: useRef<THREE.Group>(null),
    der: useRef<THREE.Group>(null),
  }
  const pelvis = useMemo(() => new THREE.Vector3(), [])
  const centro = () => rig.bones.Hips.getWorldPosition(pelvis)
  const accent = sceneColors().accent
  const S = sitios.imu

  return (
    <>
      {sitios.bandas.map((b) => (
        <EnHueso key={b.hueso} rig={rig} hueso={b.hueso}>
          <mesh geometry={b.geo} material={banda} userData={{ sinMarco: true }} />
        </EnHueso>
      ))}
      {(['T', 'P', 'L'] as const).map((k, n) => (
        <EnHueso key={k} rig={rig} hueso={S[k].hueso}>
          <group position={S[k].pos} quaternion={S[k].q} ref={anclas[k]}>
            <Pieza id={`imu-${k}`} dist={0.32}>
              <ImuCuerpo n={n} ejes={ejes} />
            </Pieza>
          </group>
        </EnHueso>
      ))}
      <EnHueso rig={rig} hueso={sitios.esp.hueso}>
        <group position={sitios.esp.pos} quaternion={sitios.esp.q} ref={anclas.esp}>
          <Pieza id="esp32" dist={0.34}>
            <EspCuerpo />
          </Pieza>
        </group>
      </EnHueso>
      {sitios.pies.map((p) => (
        <EnHueso key={p.hueso} rig={rig} hueso={p.hueso}>
          <group position={p.centro} ref={p.izq ? anclas.izq : anclas.der}>
            <Pieza id={p.izq ? 'plantilla-izq' : 'plantilla-der'} dist={0.5}>
              <PlantillaCuerpo izq={p.izq} s={p.s} dark={dark} />
            </Pieza>
            <group rotation-y={Math.PI}>
              {(p.izq ? [0, 1] : [2, 3]).map((k) => (
                <Pieza key={k} id={`fsr${k}`} dist={0.28}>
                  <PadCuerpo k={k} s={p.s} />
                </Pieza>
              ))}
            </group>
          </group>
        </EnHueso>
      ))}
      {cables && (
        <>
          <Cable de={anclas.esp} a={anclas.T} centro={centro} color={accent} />
          <Cable de={anclas.esp} a={anclas.P} centro={centro} color={accent} />
          <Cable de={anclas.esp} a={anclas.L} centro={centro} color={accent} />
          <Cable de={anclas.esp} a={anclas.der} centro={centro} color="#c9a227" />
          <Cable de={anclas.esp} a={anclas.izq} centro={centro} color="#c9a227" />
        </>
      )}
    </>
  )
}
