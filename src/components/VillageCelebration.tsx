import { useEffect, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import {
  Color4,
  DynamicTexture,
  ParticleSystem,
  UniversalCamera,
  Vector3,
  type Scene,
} from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'
import { PLACES } from '@/game/places.ts'
import { getTerrainHeight } from '@/game/terrain.ts'

// When the village reservoir first hits 100%, the camera lifts off the bird and
// does a slow lap around the village while water erupts from the ground — the
// land coming back to life. Auto-triggered off gameStore.reservoirJustFilled.

// Detach from every post-process pipeline (SSAO is shared across cameras) before
// disposing, or the remaining arc camera renders white. Same guard the intro
// and cutscene cameras use.
function releaseCamera(scene: Scene, cam: UniversalCamera): void {
  const mgr = scene.postProcessRenderPipelineManager
  for (const p of mgr.supportedPipelines) {
    mgr.detachCamerasFromRenderPipeline(p.name, cam)
  }
  cam.dispose()
}

// Soft round droplet sprite, generated so we don't ship an asset (mirrors the
// flap droplets).
function makeDropletTexture(scene: Scene): DynamicTexture {
  const size = 64
  const tex = new DynamicTexture('geyserTex', size, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.45, 'rgba(220,240,255,0.85)')
  g.addColorStop(1, 'rgba(180,215,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  tex.hasAlpha = true
  tex.update(false)
  return tex
}

const DURATION = 9 // seconds of camera tour
const ORBIT_SPEED = 0.6 // rad/s — ~0.86 of a full lap over DURATION
const FOV = 1.0
const GEYSER_COUNT = 14
const GEYSER_GRAVITY = -14 // arcs the jets back down like fountains

export const VillageCelebration = () => {
  const scene = useScene()
  const camRef = useRef<UniversalCamera | null>(null)
  const systemsRef = useRef<ParticleSystem[]>([])
  const texRef = useRef<DynamicTexture | null>(null)
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeRef = useRef(false)
  const elapsedRef = useRef(0)
  const angleRef = useRef(0)
  const lastTimeRef = useRef(performance.now())
  const centerRef = useRef(new Vector3())
  const radiusRef = useRef(120)
  const heightRef = useRef(60)

  const disposeParticles = () => {
    for (const ps of systemsRef.current) ps.dispose()
    systemsRef.current = []
    texRef.current?.dispose()
    texRef.current = null
  }

  const spawnGeysers = (s: Scene) => {
    const tex = makeDropletTexture(s)
    texRef.current = tex
    const c = centerRef.current
    const spread = radiusRef.current * 0.85
    for (let i = 0; i < GEYSER_COUNT; i++) {
      // Scatter the jets across the village footprint.
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * spread
      const x = c.x + Math.cos(a) * r
      const z = c.z + Math.sin(a) * r
      const y = getTerrainHeight(x, z)

      const ps = new ParticleSystem(`geyser${i}`, 600, s)
      ps.particleTexture = tex
      ps.emitter = new Vector3(x, y, z)
      ps.minEmitBox = new Vector3(-0.4, 0, -0.4)
      ps.maxEmitBox = new Vector3(0.4, 0.2, 0.4)
      ps.color1 = new Color4(0.72, 0.86, 1.0, 0.95)
      ps.color2 = new Color4(0.5, 0.72, 0.95, 0.85)
      ps.colorDead = new Color4(0.45, 0.6, 0.9, 0.0)
      ps.minSize = 0.12
      ps.maxSize = 0.45
      ps.minLifeTime = 1.1
      ps.maxLifeTime = 2.2
      ps.emitRate = 140
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD
      ps.gravity = new Vector3(0, GEYSER_GRAVITY, 0)
      // Mostly upward with a little outward spray. direction × emitPower = vel.
      ps.direction1 = new Vector3(-0.6, 1, -0.6)
      ps.direction2 = new Vector3(0.6, 1, 0.6)
      ps.minEmitPower = 7
      ps.maxEmitPower = 11
      ps.start()
      systemsRef.current.push(ps)
    }
  }

  const start = () => {
    if (!scene || activeRef.current) return

    // Village footprint → orbit center / radius / height.
    const place = PLACES.find((p) => p.name === 'village') ?? PLACES[0]
    const bbox = place?.bbox
    if (bbox) {
      const cx = (bbox.minX + bbox.maxX) / 2
      const cz = (bbox.minZ + bbox.maxZ) / 2
      const extent = Math.max(bbox.maxX - bbox.minX, bbox.maxZ - bbox.minZ) / 2
      centerRef.current.set(cx, (place?.groundY ?? 0) + extent * 0.25, cz)
      radiusRef.current = extent * 1.8
      heightRef.current = extent * 1.0 + 18
    }

    const cam = new UniversalCamera('celebrationCam', centerRef.current.clone(), scene)
    cam.fov = FOV
    cam.minZ = 0.1
    // Start the lap roughly where the player was already looking, for continuity.
    angleRef.current = gameStore.arcCam?.alpha ?? 0
    camRef.current = cam
    scene.activeCamera = cam

    spawnGeysers(scene)

    activeRef.current = true
    elapsedRef.current = 0
    gameStore.villageCelebration = true
    lastTimeRef.current = performance.now()
  }

  const end = () => {
    activeRef.current = false
    gameStore.villageCelebration = false
    const cam = camRef.current
    if (scene && cam) {
      if (scene.activeCamera === cam) scene.activeCamera = gameStore.arcCam
      releaseCamera(scene, cam)
    }
    camRef.current = null
    // Stop emitting and let the jets in flight fall + fade before disposing.
    for (const ps of systemsRef.current) ps.stop()
    fadeTimeoutRef.current = setTimeout(disposeParticles, 2600)
  }

  useEffect(() => {
    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current)
      const cam = camRef.current
      if (scene && cam) {
        if (scene.activeCamera === cam) scene.activeCamera = gameStore.arcCam
        releaseCamera(scene, cam)
      }
      camRef.current = null
      disposeParticles()
      if (gameStore.villageCelebration) gameStore.villageCelebration = false
    }
  }, [scene])

  useBeforeRender(() => {
    // Consume the one-shot trigger.
    if (gameStore.reservoirJustFilled && !activeRef.current) {
      gameStore.reservoirJustFilled = false
      start()
    }
    if (!activeRef.current) return

    const cam = camRef.current
    if (!cam) return

    const now = performance.now()
    const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05)
    lastTimeRef.current = now

    elapsedRef.current += dt
    angleRef.current += ORBIT_SPEED * dt

    const c = centerRef.current
    cam.position.set(
      c.x + Math.cos(angleRef.current) * radiusRef.current,
      c.y + heightRef.current,
      c.z + Math.sin(angleRef.current) * radiusRef.current,
    )
    cam.setTarget(c)

    if (elapsedRef.current >= DURATION) end()
  })

  return null
}
