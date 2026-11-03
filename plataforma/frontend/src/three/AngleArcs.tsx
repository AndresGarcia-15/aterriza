/**
 * Arcos de ángulo en rodilla y tronco, dibujados sobre las articulaciones reales
 * del modelo. La etiqueta muestra el DATO medido y la meta (no el ángulo
 * geométrico), para que lo que se lee sea exactamente lo que se evaluó.
 */
import { Html, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import type { Line2 } from 'three-stdlib'
import type { Joints } from './Athlete'
import type { Pose } from './pose'

const N = 28
const UP = new THREE.Vector3(0, 1, 0)

function arcPoints(center: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, r: number, out: number[]) {
  const ang = u.angleTo(v)
  const axis = new THREE.Vector3().crossVectors(u, v)
  if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0)
  axis.normalize()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  for (let i = 0; i < N; i++) {
    q.setFromAxisAngle(axis, (ang * i) / (N - 1))
    p.copy(u).applyQuaternion(q).multiplyScalar(r).add(center)
    out[i * 3] = p.x
    out[i * 3 + 1] = p.y
    out[i * 3 + 2] = p.z
  }
  return ang
}

interface Props {
  joints: MutableRefObject<Joints>
  pose: MutableRefObject<Pose>
  metas?: { rodilla?: number; tronco?: number }
  color?: string
  dashed?: boolean
  labels?: boolean
}

export function AngleArcs({ joints, pose, metas, color = '#ffffff', dashed = false, labels = true }: Props) {
  const knee = useRef<Line2>(null)
  const trunk = useRef<Line2>(null)
  const kneeRay = useRef<Line2>(null)
  const trunkRay = useRef<Line2>(null)
  const kLabel = useRef<THREE.Group>(null)
  const tLabel = useRef<THREE.Group>(null)
  const kTxt = useRef<HTMLSpanElement>(null)
  const tTxt = useRef<HTMLSpanElement>(null)
  const buf = useMemo(() => ({ k: new Array(N * 3).fill(0), t: new Array(N * 3).fill(0), u: new THREE.Vector3(), v: new THREE.Vector3(), m: new THREE.Vector3() }), [])
  const init = useMemo(() => Array.from({ length: N }, () => new THREE.Vector3()), [])

  useFrame(() => {
    const J = joints.current
    if (!J.ready) return
    // Rodilla: prolongación del muslo vs. pierna
    buf.u.subVectors(J.knee, J.hip).normalize()
    buf.v.subVectors(J.ankle, J.knee).normalize()
    arcPoints(J.knee, buf.u, buf.v, 0.17, buf.k)
    knee.current?.geometry.setPositions(buf.k)
    kneeRay.current?.geometry.setPositions([J.knee.x, J.knee.y, J.knee.z, J.knee.x + buf.u.x * 0.26, J.knee.y + buf.u.y * 0.26, J.knee.z + buf.u.z * 0.26])
    buf.m.set(buf.k[(N >> 1) * 3], buf.k[(N >> 1) * 3 + 1], buf.k[(N >> 1) * 3 + 2])
    kLabel.current?.position.copy(buf.m).sub(J.knee).multiplyScalar(1.9).add(J.knee)
    // Tronco: vertical vs. pelvis → cuello
    buf.u.copy(UP)
    buf.v.subVectors(J.neck, J.pelvis).normalize()
    arcPoints(J.pelvis, buf.u, buf.v, 0.3, buf.t)
    trunk.current?.geometry.setPositions(buf.t)
    trunkRay.current?.geometry.setPositions([J.pelvis.x, J.pelvis.y, J.pelvis.z, J.pelvis.x, J.pelvis.y + 0.42, J.pelvis.z])
    buf.m.set(buf.t[(N >> 1) * 3], buf.t[(N >> 1) * 3 + 1], buf.t[(N >> 1) * 3 + 2])
    tLabel.current?.position.copy(buf.m).sub(J.pelvis).multiplyScalar(1.45).add(J.pelvis)
    const p = pose.current
    if (kTxt.current) kTxt.current.textContent = `${Math.round(p.knee)}°`
    if (tTxt.current) tTxt.current.textContent = `${Math.round(p.trunk)}°`
  })

  const common = { color, lineWidth: dashed ? 2.5 : 4.5, dashed, dashSize: 0.025, gapSize: 0.018, transparent: true, depthTest: false, renderOrder: 10 }
  return (
    <group>
      <Line ref={knee} points={init} {...common} />
      <Line ref={trunk} points={init} {...common} />
      <Line ref={kneeRay} points={[init[0], init[1]]} {...common} lineWidth={1.2} opacity={0.5} dashed />
      <Line ref={trunkRay} points={[init[0], init[1]]} {...common} lineWidth={1.2} opacity={0.5} dashed />
      {labels && (
        <>
          <group ref={kLabel}>
            <Html center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
              <div className="flex flex-col items-start whitespace-nowrap rounded-lg border border-white/10 bg-black/70 px-2.5 py-1 text-white shadow-xl backdrop-blur-md">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">Rodilla</span>
                <span ref={kTxt} className="display tnum text-2xl" />
                {metas?.rodilla !== undefined && <span className="font-mono text-[10px] text-white/60">meta {metas.rodilla}°</span>}
              </div>
            </Html>
          </group>
          <group ref={tLabel}>
            <Html center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
              <div className="flex flex-col items-start whitespace-nowrap rounded-lg border border-white/10 bg-black/70 px-2.5 py-1 text-white shadow-xl backdrop-blur-md">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">Tronco</span>
                <span ref={tTxt} className="display tnum text-2xl" />
                {metas?.tronco !== undefined && <span className="font-mono text-[10px] text-white/60">meta {metas.tronco}°</span>}
              </div>
            </Html>
          </group>
        </>
      )}
    </group>
  )
}
