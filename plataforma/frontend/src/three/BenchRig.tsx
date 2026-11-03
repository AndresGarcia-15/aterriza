/**
 * Gemelo del banco de pruebas: el hardware tal como está sobre la mesa, vivo.
 *  - 2 plantillas con sus 4 FSR: se iluminan con la lectura cruda del ADC.
 *  - ESP32 y los cables a cada sensor (pulsos = datos que llegan).
 *  - 3 IMU MPU6050 sobre soportes, girando con la orientación REAL estimada por el filtro
 *    Mahony (sin magnetómetro el rumbo es libre: se recentra al conectar).
 * Cada pieza es explorable (Explorador.tsx): nombre al pasar el mouse y ficha al hacer
 * clic. Nada pasa por React en cada cuadro: todo se actualiza en useFrame leyendo el
 * último cuadro del WebSocket.
 */
import { RoundedBox } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { FOOT } from '../components/Footprints'
import { IMU_INFO, SAT_RAW, hwNow, virtual } from '../lib/banco'
import { useLive } from '../lib/store'
import { sceneColors } from './Athlete'
import { Pieza } from './Explorador'

const S = 0.00135 // unidades del contorno del pie → metros (plantilla ≈ 26 cm)
const MAT_Y = 0.01
const INS_Z = 0.05
const INSOLES = [
  { x: -0.115, flip: true, heel: 0, fore: 1 },
  { x: 0.115, flip: false, heel: 2, fore: 3 },
]
const padPos = (k: number) => {
  const ins = INSOLES.find((i) => i.heel === k || i.fore === k)!
  const isHeel = ins.heel === k
  return new THREE.Vector3(ins.x, MAT_Y + 0.0105, INS_Z + ((isHeel ? 158 : 52) - 96) * S)
}
const ESP = new THREE.Vector3(0, MAT_Y, -0.25)
const IMU_POS: Record<string, THREE.Vector3> = {
  T: new THREE.Vector3(0.32, 0.17, -0.14),
  P: new THREE.Vector3(0.32, 0.11, 0.08),
  L: new THREE.Vector3(-0.32, 0.2, -0.08),
}

function heat(v: number, out: THREE.Color) {
  const x = Math.max(0, Math.min(1, v))
  const stops: [number, number, number, number][] = [
    [0, 0.12, 0.35, 0.9],
    [0.35, 0.16, 0.88, 0.84],
    [0.75, 1.0, 0.75, 0.24],
    [1, 1.0, 0.27, 0.31],
  ]
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const a = stops[i - 1]
      const b = stops[i]
      const k = (x - a[0]) / (b[0] - a[0])
      return out.setRGB(a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k)
    }
  }
  return out.setRGB(1, 0.27, 0.31)
}

/** Las flechas de ejes no se pueden señalar (las líneas atrapan rayos a 1 m de distancia). */
export function sinRayos<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => (c.raycast = () => {}))
  return o
}

function useFresh() {
  const st = useLive((s) => s.status)
  return !!st && st.estado === 'conectado' && st.fresco
}

// ------------------------------------------------------------------ plantillas y FSR
function useFootGeometry() {
  return useMemo(() => {
    const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${FOOT}"/></svg>`)
    const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p))
    const g = new THREE.ExtrudeGeometry(shapes, { depth: 5, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.4, bevelSegments: 2, curveSegments: 28 })
    g.translate(-50, -96, 0)
    g.computeVertexNormals()
    return g
  }, [])
}

function Insole({ x, flip, dark }: { x: number; flip: boolean; dark: boolean }) {
  const geo = useFootGeometry()
  return (
    <mesh geometry={geo} position={[x, MAT_Y + 7.4 * S, INS_Z]} rotation-x={Math.PI / 2} scale={[S * (flip ? -1 : 1), S, S]} castShadow receiveShadow>
      <meshStandardMaterial color={dark ? '#262c34' : '#e2e5df'} roughness={0.92} side={THREE.DoubleSide} />
    </mesh>
  )
}

function Pad({ k, interactive }: { k: number; interactive: boolean }) {
  const pos = useMemo(() => padPos(k), [k])
  const disc = useRef<THREE.Mesh>(null)
  const glow = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const pressed = useRef(false)
  const col = useMemo(() => new THREE.Color(), [])
  const accent = useMemo(() => new THREE.Color(sceneColors().accent), [])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 0.4, roughness: 0.35, emissive: '#000000' }), [])
  const glowMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color() }, uA: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'varying vec2 vUv; uniform vec3 uColor; uniform float uA; void main(){ float r = length(vUv-0.5)*2.0; float a = exp(-r*r*4.0)*uA; if(r>1.0) discard; gl_FragColor = vec4(uColor*a, a); }',
      }),
    [],
  )
  const ins = INSOLES.find((i) => i.heel === k || i.fore === k)!
  const out = ins.flip ? -1 : 1 // la cola del FSR sale por el borde externo

  useFrame((st) => {
    const hw = hwNow()
    const raw = hw?.raw[k] ?? 0
    const v = raw / 4095
    heat(v * 1.25, col)
    mat.emissive.copy(col)
    mat.emissiveIntensity = hw ? 0.15 + 2.4 * v : 0
    mat.color.set(hw ? '#2b2f36' : '#3a3f47')
    if (disc.current) disc.current.scale.y = 1 - 0.45 * Math.min(1, v * 1.5)
    if (glow.current) {
      glowMat.uniforms.uColor.value.copy(col)
      glowMat.uniforms.uA.value = hw ? Math.min(1.3, 0.05 + v * 1.6) : 0
      const s = 1 + Math.min(1.6, v * 2.2)
      glow.current.scale.set(s, s, s)
    }
    if (ring.current) {
      const m = ring.current.material as THREE.MeshBasicMaterial
      m.color.copy(raw >= SAT_RAW ? new THREE.Color('#ff4d5e') : accent)
      m.opacity = interactive ? 0.35 + 0.25 * Math.sin(st.clock.elapsedTime * 3 + k) : raw >= SAT_RAW ? 0.9 : 0.25
    }
  })

  const down = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive) return
    e.stopPropagation()
    pressed.current = true
    const f: (boolean | null)[] = [null, null, null, null]
    f[k] = true
    virtual.fsr(f)
  }
  const up = () => {
    if (!pressed.current) return
    pressed.current = false
    const f: (boolean | null)[] = [null, null, null, null]
    f[k] = false
    virtual.fsr(f)
  }

  return (
    <group position={pos}>
      {/* cola del FSR 402 hacia el borde de la plantilla */}
      <mesh position={[out * 0.04, 0.0006, 0]} rotation-y={0}>
        <boxGeometry args={[0.05, 0.0008, 0.0065]} />
        <meshStandardMaterial color="#9aa1aa" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh ref={disc} material={mat} onPointerDown={down} onPointerUp={up} onPointerOut={up} castShadow>
        <cylinderGeometry args={[0.017, 0.017, 0.0026, 40]} />
      </mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, 0.0016, 0]}>
        <ringGeometry args={[0.0185, 0.0205, 48]} />
        <meshBasicMaterial transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <mesh ref={glow} rotation-x={-Math.PI / 2} position={[0, 0.0022, 0]} material={glowMat} renderOrder={3} userData={{ sinMarco: true }} raycast={() => null}>
        <planeGeometry args={[0.07, 0.07]} />
      </mesh>
    </group>
  )
}

// ------------------------------------------------------------------ cables con pulsos de datos
function Wire({ points, act, radius = 0.0022, pulses = 2 }: { points: THREE.Vector3[]; act: () => number | null; radius?: number; pulses?: number }) {
  const curve = useMemo(() => new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5), [points])
  const geo = useMemo(() => new THREE.TubeGeometry(curve, 80, radius, 8, false), [curve, radius])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3a414b', roughness: 0.6, emissive: '#000000' }), [])
  const dots = useRef<(THREE.Mesh | null)[]>([])
  const dotMat = useMemo(() => new THREE.MeshBasicMaterial({ color: sceneColors().accent, transparent: true }), [])
  const base = useMemo(() => new THREE.Color(sceneColors().dark ? '#3a414b' : '#a9b0a6'), [])
  const accent = useMemo(() => new THREE.Color(sceneColors().accent), [])
  const bad = useMemo(() => new THREE.Color('#ff4d5e'), [])
  const phase = useRef(Math.random())
  const p = useMemo(() => new THREE.Vector3(), [])

  useFrame((_, dt) => {
    const a = act()
    if (a === null) {
      mat.color.copy(base)
      mat.emissive.set('#000000')
    } else if (a < 0) {
      mat.color.copy(bad)
      mat.emissive.copy(bad).multiplyScalar(0.25)
    } else {
      mat.color.copy(base).lerp(accent, 0.25 + 0.6 * a)
      mat.emissive.copy(accent).multiplyScalar(0.12 + 0.5 * a)
    }
    phase.current = (phase.current + dt * (0.35 + 1.4 * Math.max(0, a ?? 0))) % 1
    dots.current.forEach((d, i) => {
      if (!d) return
      d.visible = a !== null && a >= 0
      const t = (phase.current + i / pulses) % 1
      curve.getPointAt(t, p)
      d.position.copy(p)
      const s = 0.7 + 0.8 * Math.max(0, a ?? 0)
      d.scale.setScalar(s)
    })
    dotMat.opacity = 0.55 + 0.45 * Math.max(0, a ?? 0)
  })

  return (
    <group>
      <mesh geometry={geo} material={mat} castShadow />
      {Array.from({ length: pulses }).map((_, i) => (
        <mesh key={i} ref={(m) => void (dots.current[i] = m)} material={dotMat} renderOrder={4}>
          <sphereGeometry args={[radius * 1.9, 10, 10]} />
        </mesh>
      ))}
    </group>
  )
}

// ------------------------------------------------------------------ ESP32
function Esp32({ dark }: { dark: boolean }) {
  const led = useRef<THREE.MeshStandardMaterial>(null)
  const fresh = useFresh()
  const pins = useMemo(() => {
    const a: [number, number][] = []
    for (let i = 0; i < 15; i++) {
      const x = -0.047 + i * 0.0067
      a.push([x, 0.027], [x, -0.027])
    }
    return a
  }, [])
  // LED rojo de alimentación de la placa: fijo mientras hay datos (como el real), apagado sin ellos
  useFrame(() => {
    if (led.current) led.current.emissiveIntensity = fresh ? 2.2 : 0
  })
  return (
    <group position={ESP}>
      <RoundedBox args={[0.118, 0.0035, 0.062]} radius={0.0012} smoothness={2} position={[0, 0.00175, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial color={dark ? '#101418' : '#1f2630'} roughness={0.45} clearcoat={0.6} />
      </RoundedBox>
      {/* módulo WROOM-32D con su blindaje metálico y la antena */}
      <mesh position={[0.024, 0.0068, 0]} castShadow>
        <boxGeometry args={[0.044, 0.0066, 0.036]} />
        <meshStandardMaterial color="#c3c9d0" metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[0.053, 0.0045, 0]}>
        <boxGeometry args={[0.014, 0.002, 0.036]} />
        <meshStandardMaterial color="#173a2b" roughness={0.6} />
      </mesh>
      {/* USB y botones */}
      <mesh position={[-0.056, 0.0065, 0]}>
        <boxGeometry args={[0.012, 0.006, 0.017]} />
        <meshStandardMaterial color="#d6dade" metalness={0.85} roughness={0.25} />
      </mesh>
      {[-0.012, 0.012].map((z) => (
        <mesh key={z} position={[-0.043, 0.0052, z * 1.6]}>
          <boxGeometry args={[0.0055, 0.003, 0.0055]} />
          <meshStandardMaterial color="#222" />
        </mesh>
      ))}
      {pins.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.0055, z]}>
          <boxGeometry args={[0.0052, 0.004, 0.0052]} />
          <meshStandardMaterial color="#0b0c0e" roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[-0.034, 0.0045, 0.012]}>
        <sphereGeometry args={[0.0022, 12, 12]} />
        <meshStandardMaterial ref={led} color="#1b1b1b" emissive="#ff3b3b" />
      </mesh>
    </group>
  )
}

// ------------------------------------------------------------------ IMU (módulo MPU6050)
const MAHONY_TO_THREE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2) // Z arriba → Y arriba

function ImuBoard({ k, n, interactive, recenterKey }: { k: string; n: number; interactive: boolean; recenterKey: number }) {
  const pos = IMU_POS[k]
  const inner = useRef<THREE.Group>(null)
  const pcb = useRef<THREE.MeshStandardMaterial>(null)
  const halo = useRef<THREE.MeshBasicMaterial>(null)
  const yaw0 = useRef<number | null>(null)
  const tmp = useMemo(() => ({ q: new THREE.Quaternion(), z: new THREE.Quaternion(), sm: new THREE.Quaternion(), first: true }), [])
  const accent = useMemo(() => sceneColors().accent, [])
  const arrows = useMemo(
    () =>
      ([
        [new THREE.Vector3(1, 0, 0), '#ff5a6a'],
        [new THREE.Vector3(0, 1, 0), '#3ddc84'],
        [new THREE.Vector3(0, 0, 1), '#4ea8ff'],
      ] as const).map(([d, c]) => sinRayos(new THREE.ArrowHelper(d, new THREE.Vector3(0, 0, 0.003), 0.058, c, 0.012, 0.007))),
    [],
  )
  useEffect(() => {
    yaw0.current = null
  }, [recenterKey])

  useFrame((_, dt) => {
    const hw = hwNow()
    const ok = !!hw?.ok?.[n]
    const q = hw?.q?.[n]
    if (ok && q && inner.current) {
      tmp.q.set(q[1], q[2], q[3], q[0])
      // rumbo libre (sin magnetómetro): se recentra
      if (yaw0.current === null) {
        // rumbo del eje más horizontal del sensor (X si la placa está plana, Z si está de canto)
        const [w, x, y, z] = q
        const X = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)]
        const Z = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]
        const h = Math.abs(X[2]) < Math.abs(Z[2]) ? X : Z
        yaw0.current = Math.atan2(h[1], h[0]) - (h === X ? 0 : Math.PI / 2)
      }
      tmp.z.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -yaw0.current)
      tmp.q.premultiply(tmp.z)
      if (tmp.first) {
        tmp.sm.copy(tmp.q)
        tmp.first = false
      } else tmp.sm.slerp(tmp.q, 1 - Math.exp(-dt * 30))
      inner.current.quaternion.copy(tmp.sm)
    }
    if (pcb.current) {
      pcb.current.color.set(ok ? '#1f46b8' : '#4b5260')
      pcb.current.opacity = ok ? 1 : 0.5
      pcb.current.transparent = !ok
    }
    const g = hw?.g?.[n] ?? 0
    if (halo.current) halo.current.opacity = ok ? Math.min(0.9, g / 160) : 0
    arrows.forEach((a) => (a.visible = ok))
  })

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!interactive) return
    e.stopPropagation()
    virtual.giro(k)
  }

  return (
    <group position={pos}>
      {/* soporte de acrílico */}
      <mesh position={[0, (MAT_Y - pos.y) / 2 - 0.012, 0]}>
        <cylinderGeometry args={[0.0035, 0.0035, pos.y - MAT_Y - 0.024, 12]} />
        <meshPhysicalMaterial color="#cfe8ff" transparent opacity={0.35} roughness={0.1} transmission={0.6} />
      </mesh>
      <mesh position={[0, MAT_Y - pos.y + 0.003, 0]}>
        <cylinderGeometry args={[0.022, 0.024, 0.005, 32]} />
        <meshStandardMaterial color="#2c333c" roughness={0.6} />
      </mesh>
      <group quaternion={MAHONY_TO_THREE}>
        <group ref={inner}>
          <mesh onClick={click} castShadow>
            <boxGeometry args={[0.066, 0.051, 0.0035]} />
            <meshStandardMaterial ref={pcb} color="#1f46b8" roughness={0.5} />
          </mesh>
          {/* MPU6050 (centro) y magnetómetro QMC5883P */}
          {[
            [0.005, 0.002, 0.012],
            [-0.012, -0.012, 0.0055],
          ].map(([x, y, s], i) => (
            <mesh key={i} position={[x, y, 0.0028]}>
              <boxGeometry args={[s, s, 0.0018]} />
              <meshStandardMaterial color="#121418" roughness={0.4} />
            </mesh>
          ))}
          {/* tira de pines */}
          {Array.from({ length: 8 }).map((_, i) => (
            <mesh key={i} position={[-0.029, -0.021 + i * 0.006, 0.003]}>
              <cylinderGeometry args={[0.0011, 0.0011, 0.004, 8]} />
              <meshStandardMaterial color="#d4b24c" metalness={0.9} roughness={0.25} />
            </mesh>
          ))}
          <mesh rotation-x={0} userData={{ sinMarco: true }} raycast={() => null}>
            <torusGeometry args={[0.05, 0.0016, 8, 64]} />
            <meshBasicMaterial ref={halo} color={accent} transparent opacity={0} depthWrite={false} />
          </mesh>
          {arrows.map((a, i) => (
            <primitive key={i} object={a} />
          ))}
        </group>
      </group>
    </group>
  )
}

// ------------------------------------------------------------------ conjunto
export function BenchRig({ interactive = false, recenterKey = 0 }: { interactive?: boolean; recenterKey?: number }) {
  const dark = sceneColors().dark
  const fresh = useFresh()
  const freshRef = useRef(fresh)
  freshRef.current = fresh

  const fsrWires = useMemo(
    () =>
      [0, 1, 2, 3].map((k) => {
        const p = padPos(k)
        const ins = INSOLES.find((i) => i.heel === k || i.fore === k)!
        const out = ins.flip ? -1 : 1
        const tail = new THREE.Vector3(p.x + out * 0.066, MAT_Y + 0.004, p.z)
        const pinX = -0.03 + k * 0.0134
        return [
          tail,
          new THREE.Vector3(p.x + out * 0.1, MAT_Y + 0.012, p.z - 0.02),
          new THREE.Vector3(p.x + out * 0.08, MAT_Y + 0.02, -0.17 + k * 0.004),
          new THREE.Vector3(pinX, MAT_Y + 0.03, ESP.z + 0.05),
          new THREE.Vector3(pinX, MAT_Y + 0.009, ESP.z + 0.027),
        ]
      }),
    [],
  )
  const imuWires = useMemo(
    () =>
      IMU_INFO.map((m, n) => {
        const p = IMU_POS[m.id]
        const pinX = [0.03, 0.017, -0.03][n]
        const side = Math.sign(p.x)
        return [
          new THREE.Vector3(p.x, MAT_Y + 0.006, p.z),
          new THREE.Vector3(p.x - side * 0.04, MAT_Y + 0.008, p.z - 0.04),
          new THREE.Vector3(pinX + side * 0.09, MAT_Y + 0.025, ESP.z - 0.07),
          new THREE.Vector3(pinX, MAT_Y + 0.03, ESP.z - 0.05),
          new THREE.Vector3(pinX, MAT_Y + 0.009, ESP.z - 0.027),
        ]
      }),
    [],
  )
  const usb = useMemo(
    () => [
      new THREE.Vector3(ESP.x - 0.062, MAT_Y + 0.0065, ESP.z),
      new THREE.Vector3(ESP.x - 0.12, MAT_Y + 0.004, ESP.z - 0.02),
      new THREE.Vector3(-0.3, MAT_Y + 0.003, ESP.z - 0.14),
      new THREE.Vector3(-0.62, 0.004, -0.6),
    ],
    [],
  )

  return (
    <group>
      {/* tapete antiestático */}
      <RoundedBox args={[1.04, 0.01, 0.74]} radius={0.004} smoothness={2} position={[0, MAT_Y / 2, -0.05]} receiveShadow>
        <meshStandardMaterial color={dark ? '#10232a' : '#c9d6d1'} roughness={0.95} />
      </RoundedBox>
      {INSOLES.map((i) => (
        <Pieza key={i.x} id={i.flip ? 'plantilla-izq' : 'plantilla-der'} dist={0.55}>
          <Insole x={i.x} flip={i.flip} dark={dark} />
        </Pieza>
      ))}
      {[0, 1, 2, 3].map((k) => (
        <Pieza key={k} id={`fsr${k}`} dist={0.2} conAccion={interactive}>
          <Pad k={k} interactive={interactive} />
        </Pieza>
      ))}
      <Pieza id="cable-fsr" dist={0.6}>
        {fsrWires.map((pts, k) => (
          <Wire key={k} points={pts} act={() => (freshRef.current ? Math.min(1, (hwNow()?.raw[k] ?? 0) / 3000) : null)} />
        ))}
      </Pieza>
      {imuWires.map((pts, n) => (
        <Pieza key={n} id={`bus-${IMU_INFO[n].id}`} dist={0.55}>
          <Wire
            points={pts}
            radius={0.003}
            pulses={3}
            act={() => {
              const hw = hwNow()
              if (!freshRef.current || !hw) return null
              if (hw.ok && !hw.ok[n]) return IMU_INFO[n].opcional && (hw.a?.[n] ?? 0) < 0.05 ? null : -1 // pendiente = gris, falla = rojo
              return Math.min(1, 0.3 + (hw.g?.[n] ?? 0) / 150)
            }}
          />
        </Pieza>
      ))}
      <Pieza id="usb" dist={0.6}>
        <Wire points={usb} radius={0.0032} pulses={4} act={() => (freshRef.current ? 0.7 : null)} />
      </Pieza>
      <Pieza id="esp32" dist={0.28}>
        <Esp32 dark={dark} />
      </Pieza>
      {IMU_INFO.map((m, n) => (
        <Pieza key={m.id} id={`imu-${m.id}`} dist={0.26} conAccion={interactive}>
          <ImuBoard k={m.id} n={n} interactive={interactive} recenterKey={recenterKey} />
        </Pieza>
      ))}
    </group>
  )
}
