/**
 * Escena de laboratorio sobria: piso con grilla métrica (1 m / 10 cm), cajón de
 * caída de 35 cm, iluminación de estudio procedural (Lightformers, sin descargas)
 * y cámara lateral (plano sagital) con vistas frontal y orbital.
 */
import { ContactShadows, Environment, Grid, Html, Lightformer, OrbitControls, RoundedBox } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react'
import * as THREE from 'three'
import { useApp } from '../lib/store'
import type { Joints } from './Athlete'
import { FocoCamara } from './Explorador'
import { BOX_H, BOX_Z } from './pose'

export type Vista = 'lateral' | 'frontal' | 'orbital' | 'banco'

const VIEWS: Record<Exclude<Vista, 'orbital'>, { pos: [number, number, number]; target: [number, number, number] }> = {
  // La cámara mira el lado DERECHO del atleta (el de las IMU): el atleta mira hacia la derecha de la pantalla.
  lateral: { pos: [-3.7, 1.15, -0.25], target: [0, 0.82, -0.25] },
  frontal: { pos: [0.2, 1.15, 3.6], target: [0, 0.82, 0] },
  // Banco de pruebas: la mesa vista desde arriba y adelante
  banco: { pos: [0, 1.05, 1.02], target: [0, 0.04, -0.06] },
}

function CameraRig({ vista, zoom = 1, focusY, orbitTarget, minDist }: { vista: Vista; zoom?: number; focusY?: number; orbitTarget?: [number, number, number]; minDist?: number }) {
  const { camera, size } = useThree()
  const target = useRef(new THREE.Vector3(0, 0.85, 0))
  // en lienzos angostos (retrato) la cámara se aleja para que el atleta y el cajón quepan
  const aspect = size.width / Math.max(1, size.height)
  const fit = aspect < 1.45 ? 1.45 / aspect : 1
  const goal = useMemo(() => {
    if (vista === 'orbital') return null
    const v = VIEWS[vista]
    const t = new THREE.Vector3(...v.target)
    if (focusY !== undefined) t.y = focusY
    const p = new THREE.Vector3(...v.pos).sub(new THREE.Vector3(...v.target)).multiplyScalar(zoom * fit).add(t)
    return { p, t }
  }, [vista, zoom, focusY, fit])
  useFrame((_, dt) => {
    if (!goal) return
    const a = 1 - Math.exp(-dt * 4)
    camera.position.lerp(goal.p, a)
    target.current.lerp(goal.t, a)
    camera.lookAt(target.current)
  })
  return vista === 'orbital' ? (
    <>
      <OrbitControls target={orbitTarget ?? [0, 0.8, -0.2]} enableDamping makeDefault minDistance={minDist ?? (orbitTarget ? 0.5 : 1.5)} maxDistance={7} maxPolarAngle={Math.PI * 0.49} zoomToCursor />
      <FocoCamara />
    </>
  ) : null
}

function Lab({ dark, cajon = true }: { dark: boolean; cajon?: boolean }) {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  return (
    <>
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={dark ? 2.2 : 3} position={[0, 4, 0]} rotation-x={Math.PI / 2} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={dark ? 1.6 : 2} position={[-4, 1.5, 1]} rotation-y={Math.PI / 2} scale={[3, 2, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[4, 1.5, -1]} rotation-y={-Math.PI / 2} scale={[3, 2, 1]} />
        <Lightformer form="ring" color={accent} intensity={dark ? 1.4 : 0.6} position={[0, 2, -4]} scale={2} />
      </Environment>
      <directionalLight position={[-3, 5, 2]} intensity={dark ? 1.1 : 1.5} />
      <ambientLight intensity={dark ? 0.15 : 0.35} />
      <Grid
        position={[0, 0.003, 0]}
        args={[12, 12]}
        cellSize={0.1}
        cellThickness={0.6}
        sectionSize={1}
        sectionThickness={1.1}
        cellColor={dark ? '#252c36' : '#c2c8bd'}
        sectionColor={dark ? '#3d4757' : '#97a093'}
        fadeDistance={9}
        fadeStrength={1.6}
        infiniteGrid
      />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color={dark ? '#0b0d10' : '#e6e8e3'} roughness={0.95} />
      </mesh>
      {cajon && (
        <>
      {/* Cajón de caída (30-40 cm) */}
      <group position={[0, BOX_H / 2, BOX_Z - 0.06]}>
        <RoundedBox args={[0.62, BOX_H, 0.46]} radius={0.018} smoothness={3} castShadow receiveShadow>
          <meshPhysicalMaterial color={dark ? '#2b323c' : '#d8dcd4'} roughness={0.5} clearcoat={0.4} />
        </RoundedBox>
        <mesh position={[0, BOX_H / 2 + 0.001, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.58, 0.42]} />
          <meshStandardMaterial color={dark ? '#3a4350' : '#c9cec4'} roughness={0.9} />
        </mesh>
      </group>
      <Html position={[-0.33, BOX_H * 0.55, BOX_Z - 0.06]} center distanceFactor={3} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className="eyebrow whitespace-nowrap rounded-full border border-line bg-surface/80 px-2 py-0.5 !text-[10px] backdrop-blur">
          cajón 35 cm
        </div>
      </Html>
        </>
      )}
      <ContactShadows position={[0, 0.002, -0.2]} scale={4} resolution={512} blur={2.4} opacity={dark ? 0.75 : 0.45} far={1.6} frames={Infinity} />
    </>
  )
}

/** Onda de choque en el piso al tocar (intensidad ∝ carga relativa). */
export function Shockwave({ trigger }: { trigger: MutableRefObject<{ t: number; k: number; x: number; z: number } | null> }) {
  const mesh = useRef<THREE.Mesh>(null)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uT: { value: 10 }, uK: { value: 1 }, uColor: { value: new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()) } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
          varying vec2 vUv; uniform float uT; uniform float uK; uniform vec3 uColor;
          void main(){
            float r = length(vUv - 0.5) * 2.0;
            float life = clamp(uT / 0.9, 0.0, 1.0);
            float R = 0.05 + life * 0.95;
            float ring = exp(-pow((r - R) * 18.0, 2.0)) + 0.45 * exp(-pow((r - R * 0.62) * 26.0, 2.0));
            float core = exp(-r * 9.0) * (1.0 - life) * 0.8;
            float a = (ring + core) * (1.0 - life) * uK;
            if (r > 1.0) discard;
            gl_FragColor = vec4(uColor * a, a);
          }`,
      }),
    [],
  )
  useFrame((st) => {
    const tr = trigger.current
    if (!tr || !mesh.current) return
    const age = st.clock.elapsedTime - tr.t
    mat.uniforms.uT.value = age
    mat.uniforms.uK.value = tr.k
    mesh.current.position.set(tr.x, 0.004, tr.z)
    mesh.current.visible = age < 1
  })
  return (
    <mesh ref={mesh} rotation-x={-Math.PI / 2} material={mat} visible={false} renderOrder={3}>
      <planeGeometry args={[2.6, 2.6]} />
    </mesh>
  )
}

/** Huellas de presión en el piso bajo cada pie: calor en talón y antepié. */
export function FloorPressure({ loads, joints }: { loads: MutableRefObject<number[]>; joints: MutableRefObject<Joints> }) {
  const mk = () =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uHeel: { value: 0 }, uFore: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec2 vUv; uniform float uHeel; uniform float uFore;
        vec3 heat(float x){ x = clamp(x,0.0,1.0);
          return mix(mix(vec3(0.05,0.35,0.9), vec3(0.1,0.9,0.85), smoothstep(0.0,0.35,x)), mix(vec3(1.0,0.75,0.2), vec3(1.0,0.25,0.3), smoothstep(0.7,1.0,x)), smoothstep(0.35,0.75,x)); }
        void main(){
          vec2 p = vUv - 0.5; p.x *= 2.4;
          float h = exp(-dot(p - vec2(0.0,-0.28), p - vec2(0.0,-0.28)) * 70.0);
          float f = exp(-dot(p - vec2(0.0, 0.22), p - vec2(0.0, 0.22)) * 55.0);
          float lh = clamp(uHeel / 3.0, 0.0, 1.0); float lf = clamp(uFore / 3.0, 0.0, 1.0);
          float a = h * smoothstep(0.02,0.2,lh) + f * smoothstep(0.02,0.2,lf);
          vec3 c = heat(lh) * h + heat(lf) * f;
          gl_FragColor = vec4(c * 1.4, a * 0.9);
        }`,
    })
  const mats = useMemo(() => [mk(), mk()], [])
  const refs = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)]
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const F = joints.current
    if (!F.ready) return
    const l = loads.current
    const pairs: [THREE.Vector3, THREE.Vector3, number, number][] = [
      [F.ankleL, F.toeL, l[0] ?? 0, l[1] ?? 0],
      [F.ankle, F.toeR, l[2] ?? 0, l[3] ?? 0],
    ]
    pairs.forEach(([a, t, heel, fore], i) => {
      const m = refs[i].current
      if (!m) return
      v.copy(a).add(t).multiplyScalar(0.5)
      m.position.set(v.x, 0.003, v.z - 0.02)
      mats[i].uniforms.uHeel.value = heel
      mats[i].uniforms.uFore.value = fore
      m.visible = a.y < 0.2
    })
  })
  return (
    <>
      {mats.map((m, i) => (
        <mesh key={i} ref={refs[i]} rotation-x={-Math.PI / 2} material={m} renderOrder={2}>
          <planeGeometry args={[0.2, 0.36]} />
        </mesh>
      ))}
    </>
  )
}

export function Stage({ children, vista = 'lateral', zoom = 1, focusY, className, cajon = true, orbitTarget, minDist }: { children: ReactNode; vista?: Vista; zoom?: number; focusY?: number; className?: string; cajon?: boolean; orbitTarget?: [number, number, number]; minDist?: number }) {
  const tema = useApp((s) => s.tema)
  const dark = tema === 'dark'
  const bg = dark ? '#0b0d10' : '#e6e8e3'
  return (
    <div className={className ?? 'absolute inset-0'} data-testid="escena-3d">
      <Canvas
        key={tema}
        shadows
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [-3.7, 1.15, -0.25], fov: 32, near: 0.05, far: 60 }}
        onCreated={({ gl, scene, camera }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = dark ? 1.0 : 1.1
          scene.fog = new THREE.Fog(bg, 7, 16)
          ;(window as unknown as { __three: unknown }).__three = { scene, THREE, camera }
        }}
      >
        <color attach="background" args={[bg]} />
        <Suspense fallback={null}>
          <Lab dark={dark} cajon={cajon} />
          {children}
        </Suspense>
        <CameraRig vista={vista} zoom={zoom} focusY={focusY} orbitTarget={orbitTarget} minDist={minDist} />
        <FpsProbe />
      </Canvas>
    </div>
  )
}

/** Expone los fps reales en window.__fps (pruebas E2E del criterio ≥ 30 fps). */
function FpsProbe() {
  const acc = useRef({ n: 0, t: 0 })
  useFrame((_, dt) => {
    acc.current.n++
    acc.current.t += dt
    if (acc.current.t > 1) {
      ;(window as unknown as { __fps: number }).__fps = Math.round(acc.current.n / acc.current.t)
      acc.current = { n: 0, t: 0 }
    }
  })
  useEffect(() => () => void 0, [])
  return null
}
