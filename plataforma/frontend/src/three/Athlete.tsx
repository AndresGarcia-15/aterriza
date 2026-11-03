/**
 * Atleta 3D: Mixamo "X Bot" (rig humano estándar, ver docs/ATTRIBUTIONS.md).
 * Cada fotograma se fija la orientación ABSOLUTA (mundo) de cada segmento a partir
 * de los ángulos medidos, de la pelvis a los pies; el pie de apoyo queda clavado al
 * piso y la raíz se desplaza para respetarlo (como la cadena del gemelo digital, que
 * parte del tobillo). Las rotaciones se suavizan con slerp de cuaternios.
 */
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react'
import * as THREE from 'three'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { Pose } from './pose'

export const MODEL_URL = '/models/Xbot.glb'
useGLTF.preload(MODEL_URL)

const D2R = Math.PI / 180
const X = new THREE.Vector3(1, 0, 0)
const Z = new THREE.Vector3(0, 0, 1)

export interface Joints {
  hip: THREE.Vector3
  knee: THREE.Vector3
  ankle: THREE.Vector3
  pelvis: THREE.Vector3
  neck: THREE.Vector3
  toeR: THREE.Vector3
  ankleL: THREE.Vector3
  toeL: THREE.Vector3
  ready: boolean
}
export const newJoints = (): Joints => ({
  hip: new THREE.Vector3(), knee: new THREE.Vector3(), ankle: new THREE.Vector3(), pelvis: new THREE.Vector3(),
  neck: new THREE.Vector3(), toeR: new THREE.Vector3(), ankleL: new THREE.Vector3(), toeL: new THREE.Vector3(),
  ready: false,
})

const BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToe_End', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToe_End',
  'RightArm', 'LeftArm',
] as const
export type BoneName = (typeof BONES)[number]

/** Lo que el atleta expone para acoplarle objetos (sensores) a sus huesos. */
export interface AthleteRig {
  root: THREE.Group
  bones: Record<BoneName, THREE.Bone>
  restPos: Record<BoneName, THREE.Vector3>
  /** matrixWorld de cada hueso en la pose de reposo (raíz en el origen). */
  restMat: Record<BoneName, THREE.Matrix4>
  meshes: THREE.SkinnedMesh[]
}
const LEFT_LEG = ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End']

export const sceneColors = () => {
  const cs = getComputedStyle(document.documentElement)
  return {
    accent: cs.getPropertyValue('--accent').trim() || '#3ee0ff',
    dark: document.documentElement.dataset.theme !== 'light',
  }
}

// ---------------------------------------------------------------- materiales
function bodyMaterial(kind: 'surface' | 'joints', uniforms: Record<string, THREE.IUniform>) {
  const dark = document.documentElement.dataset.theme !== 'light'
  const m = new THREE.MeshPhysicalMaterial(
    kind === 'surface'
      ? { color: dark ? '#e7eaee' : '#f4f5f2', roughness: 0.38, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: new THREE.Color('#ffffff') }
      : { color: '#1b2027', roughness: 0.32, metalness: 0.35, clearcoat: 0.5 },
  )
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEst;\nvarying float vEst;\nvarying float vWY;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvEst = aEst;\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEst;\nvarying float vWY;\nuniform vec3 uAccent;\nuniform float uScan;\nuniform float uScanOn;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Pierna izquierda ESTIMADA (sin IMU): rayado translúcido + tinte del acento.
        if (vEst > 0.5) {
          float s = fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0);
          if (s < 0.42) discard;
          diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, 0.28);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Barrido de verificación de sensores
        float band = exp(-pow((vWY - uScan) * 22.0, 2.0)) * uScanOn;
        totalEmissiveRadiance += uAccent * band * 1.6;`,
      )
  }
  m.customProgramCacheKey = () => `athlete-${kind}`
  return m
}

function ghostMaterial(uniforms: Record<string, THREE.IUniform>) {
  const m = new THREE.MeshStandardMaterial({ color: '#000000', transparent: true, depthWrite: false, roughness: 1 })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uAccent;\nuniform float uOpacity;')
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
        float lines = 0.75 + 0.25 * sin(gl_FragCoord.y * 1.4);
        gl_FragColor = vec4(uAccent * (0.35 + 1.5 * fr) * lines, (0.06 + 0.62 * fr) * uOpacity);`,
      )
  }
  m.customProgramCacheKey = () => 'athlete-ghost'
  return m
}

// ---------------------------------------------------------------- componente
interface Props {
  pose: MutableRefObject<Pose>
  ghost?: boolean
  joints?: MutableRefObject<Joints>
  smooth?: number // constante de suavizado (1/s); 0 = sin suavizado (repetición exacta)
  scan?: MutableRefObject<number | null>
  idle?: boolean
  opacity?: number
  /** Cuerpo translúcido para ver lo que va debajo (plantillas, cinturón, sensores). */
  xray?: boolean
  /** Objetos acoplados a los huesos (p. ej. los sensores en su sitio). */
  acople?: (rig: AthleteRig) => ReactNode
}

export function Athlete({ pose, ghost = false, joints, smooth = 26, scan, idle = true, opacity = 1, xray = false, acople }: Props) {
  const gltf = useGLTF(MODEL_URL)
  const group = useRef<THREE.Group>(null)
  const uniforms = useMemo(
    () => ({
      uAccent: { value: new THREE.Color(sceneColors().accent) },
      uScan: { value: -10 },
      uScanOn: { value: 0 },
      uOpacity: { value: opacity },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  uniforms.uOpacity.value = opacity

  const rig = useMemo(() => {
    const root = skeletonClone(gltf.scene) as THREE.Group
    const bones = {} as Record<BoneName, THREE.Bone>
    root.traverse((o) => {
      const n = o.name.replace('mixamorig', '').replace(':', '')
      if ((BONES as readonly string[]).includes(n) && (o as THREE.Bone).isBone) bones[n as BoneName] = o as THREE.Bone
      const mesh = o as THREE.SkinnedMesh
      if (mesh.isSkinnedMesh) {
        mesh.frustumCulled = false
        mesh.castShadow = !ghost
        const isJoints = /joint/i.test((mesh.material as THREE.Material).name)
        // atributo "estimado" = peso de los huesos de la pierna izquierda
        const idx = new Set(mesh.skeleton.bones.map((b, i) => (LEFT_LEG.some((l) => b.name.endsWith(l)) ? i : -1)).filter((i) => i >= 0))
        const si = mesh.geometry.getAttribute('skinIndex')
        const sw = mesh.geometry.getAttribute('skinWeight')
        const est = new Float32Array(si.count)
        for (let v = 0; v < si.count; v++) {
          let w = 0
          for (let c = 0; c < 4; c++) if (idx.has(si.getComponent(v, c))) w += sw.getComponent(v, c)
          est[v] = w
        }
        mesh.geometry = mesh.geometry.clone()
        mesh.geometry.setAttribute('aEst', new THREE.BufferAttribute(est, 1))
        mesh.material = ghost ? ghostMaterial(uniforms) : bodyMaterial(isJoints ? 'joints' : 'surface', uniforms)
        if (ghost) mesh.renderOrder = 2
      }
    })
    root.updateMatrixWorld(true)
    const rest = {} as Record<BoneName, THREE.Quaternion>
    const restPos = {} as Record<BoneName, THREE.Vector3>
    const restMat = {} as Record<BoneName, THREE.Matrix4>
    for (const n of BONES) {
      rest[n] = bones[n].getWorldQuaternion(new THREE.Quaternion())
      restPos[n] = bones[n].getWorldPosition(new THREE.Vector3())
      restMat[n] = bones[n].matrixWorld.clone()
    }
    const meshes: THREE.SkinnedMesh[] = []
    root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && meshes.push(o as THREE.SkinnedMesh))
    const hipsLocal = bones.Hips.position.clone()
    const box = new THREE.Box3().setFromObject(root)
    const floor = box.min.y
    const clearAnkle = restPos.RightFoot.y - floor
    const clearToe = restPos.RightToe_End.y - floor
    return { root, bones, rest, restPos, restMat, meshes, hipsLocal, clearAnkle, clearToe }
  }, [gltf, ghost, uniforms])

  // Rayos X: el cuerpo se vuelve un vidrio tenue y deja ver lo que lleva encima y debajo.
  useEffect(() => {
    if (ghost) return
    for (const m of rig.meshes) {
      const mat = m.material as THREE.MeshPhysicalMaterial
      mat.transparent = xray
      mat.opacity = xray ? 0.2 : 1
      mat.depthWrite = !xray
      mat.needsUpdate = true
      m.castShadow = !xray
    }
  }, [xray, rig, ghost])

  // Animación "idle" de Mixamo solo para brazos y cabeza (vida sutil).
  const mixer = useMemo(() => {
    if (ghost || !idle) return null
    const clip = gltf.animations.find((a) => a.name === 'idle')
    if (!clip) return null
    const keep = clip.tracks.filter((t) => /(Arm|ForeArm|Hand|Shoulder|Neck|Head)/.test(t.name))
    const mx = new THREE.AnimationMixer(rig.root)
    mx.clipAction(new THREE.AnimationClip('idle-upper', clip.duration, keep)).play()
    return mx
  }, [gltf, rig, ghost, idle])

  useEffect(() => () => void mixer?.stopAllAction(), [mixer])

  const tmp = useMemo(
    () => ({
      q: new THREE.Quaternion(), qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), pq: new THREE.Quaternion(),
      v: new THREE.Vector3(), v2: new THREE.Vector3(), smoothQ: new Map<THREE.Bone, THREE.Quaternion>(),
      root: new THREE.Vector3(), first: true,
    }),
    [],
  )

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const p = pose.current
    const { bones, rest } = rig
    mixer?.update(dt)
    const alpha = smooth > 0 && !tmp.first ? 1 - Math.exp(-dt * smooth) : 1

    // Orientación absoluta: q_mundo = R_frontal · R_sagital · q_reposo
    const setW = (b: BoneName, sag: number, front = 0) => {
      const bone = bones[b]
      tmp.qa.setFromAxisAngle(X, sag * D2R)
      tmp.qb.setFromAxisAngle(Z, front * D2R)
      tmp.q.copy(tmp.qb).multiply(tmp.qa).multiply(rest[b])
      bone.parent!.getWorldQuaternion(tmp.pq)
      const target = tmp.pq.invert().multiply(tmp.q)
      let sq = tmp.smoothQ.get(bone)
      if (!sq) {
        sq = target.clone()
        tmp.smoothQ.set(bone, sq)
      }
      sq.slerp(target, alpha)
      bone.quaternion.copy(sq)
      bone.updateMatrixWorld(true)
    }
    const addW = (b: BoneName, sag: number, front = 0) => {
      const bone = bones[b]
      bone.getWorldQuaternion(tmp.q)
      tmp.qa.setFromAxisAngle(X, sag * D2R)
      tmp.qb.setFromAxisAngle(Z, front * D2R)
      tmp.q.premultiply(tmp.qa).premultiply(tmp.qb)
      bone.parent!.getWorldQuaternion(tmp.pq)
      bone.quaternion.copy(tmp.pq.invert().multiply(tmp.q))
      bone.updateMatrixWorld(true)
    }

    const setArm = (b: BoneName, down: number) => {
      const bone = bones[b]
      tmp.qb.setFromAxisAngle(Z, down * D2R)
      tmp.qa.setFromAxisAngle(X, -p.arms * D2R)
      tmp.q.copy(tmp.qa).multiply(tmp.qb).multiply(rest[b])
      bone.parent!.getWorldQuaternion(tmp.pq)
      bone.quaternion.copy(tmp.pq.invert().multiply(tmp.q))
      bone.updateMatrixWorld(true)
    }

    const tr = p.trunk
    const lat = p.lateral
    const thighFwd = p.thigh // distal (rodilla) hacia adelante
    const shankFwd = thighFwd - p.knee // distal (tobillo) hacia adelante; rodilla = muslo − pierna
    rig.bones.Hips.position.copy(rig.hipsLocal)
    setW('Hips', 0.45 * tr, -0.25 * lat)
    setW('Spine', 0.68 * tr, -0.5 * lat)
    setW('Spine1', 0.86 * tr, -0.78 * lat)
    setW('Spine2', tr, -lat)
    setW('Neck', 0.55 * tr, -0.6 * lat)
    setW('Head', 0.25 * tr, -0.3 * lat)
    // Pierna derecha (medida): muslo y pierna en el plano sagital + valgo frontal
    setW('RightUpLeg', -thighFwd, 0.4 * p.valgus)
    setW('RightLeg', -shankFwd, -0.6 * p.valgus)
    setW('RightFoot', p.footR)
    // Pierna izquierda (estimada, en espejo, sin valgo)
    setW('LeftUpLeg', -thighFwd)
    setW('LeftLeg', -shankFwd)
    setW('LeftFoot', p.footL)
    // Brazos: equilibrio. Con "idle" se suma a la animación; sin ella, se bajan desde la pose T.
    if (mixer) {
      addW('RightArm', -p.arms, 6)
      addW('LeftArm', -p.arms, -6)
    } else {
      setArm('RightArm', 74)
      setArm('LeftArm', -74)
    }

    // Raíz: el punto más bajo del pie derecho toca el piso (o el cajón / la caída).
    const g = group.current!
    g.position.set(0, 0, 0)
    g.updateMatrixWorld(true)
    const ankle = bones.RightFoot.getWorldPosition(tmp.v)
    const toe = bones.RightToe_End.getWorldPosition(tmp.v2)
    const floor = p.y
    const dy = Math.max(floor + rig.clearAnkle - ankle.y, floor + rig.clearToe - toe.y)
    const dz = p.z - (ankle.z - rig.restPos.RightFoot.z)
    const dx = rig.restPos.RightFoot.x - ankle.x
    tmp.root.set(dx, dy, dz)
    g.position.copy(tmp.root)
    g.updateMatrixWorld(true)
    tmp.first = false

    if (scan) {
      uniforms.uScanOn.value = scan.current == null ? Math.max(0, uniforms.uScanOn.value - dt * 3) : 1
      if (scan.current != null) uniforms.uScan.value = scan.current
    }

    if (joints) {
      const J = joints.current
      bones.RightUpLeg.getWorldPosition(J.hip)
      bones.RightLeg.getWorldPosition(J.knee)
      bones.RightFoot.getWorldPosition(J.ankle)
      bones.Hips.getWorldPosition(J.pelvis)
      bones.Neck.getWorldPosition(J.neck)
      bones.RightToe_End.getWorldPosition(J.toeR)
      bones.LeftFoot.getWorldPosition(J.ankleL)
      bones.LeftToe_End.getWorldPosition(J.toeL)
      J.ready = true
    }
    void state
  })

  return (
    <group ref={group}>
      <primitive object={rig.root} />
      {acople?.(rig)}
    </group>
  )
}
