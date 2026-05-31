import { useEffect, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import { UniversalCamera, Vector3, type Scene } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'

// When the player first walks into the source's footprint, the camera lifts off
// the bird and laps once around the spring while its water surface (Plan.001)
// rises up to the "waterY" empty — the source filling back up. Auto-triggered
// off proximity to gameStore.sourceZone, plays once per load.

// Detach from every post-process pipeline (SSAO is shared across cameras) before
// disposing, or the remaining arc camera renders white. Same guard the intro,
// cutscene and celebration cameras use.
function releaseCamera(scene: Scene, cam: UniversalCamera): void {
  const mgr = scene.postProcessRenderPipelineManager
  for (const p of mgr.supportedPipelines) {
    mgr.detachCamerasFromRenderPipeline(p.name, cam)
  }
  cam.dispose()
}

const DURATION = 11 // seconds — total camera tour
const ORBIT_SPEED = 0.32 // rad/s — slow, gentle pan (~200° over DURATION)
// The water climbs to "waterY" early in the tour, then the camera keeps circling
// the now-full source for the rest.
const WATER_RISE_DURATION = 3.5 // seconds
const FOV = 0.9
// Orbit framing derived from the footprint radius.
const RADIUS_MUL = 2.0
const HEIGHT_MUL = 1.0
const HEIGHT_PAD = 16

export const SourceCutscene = () => {
  const scene = useScene()
  const camRef = useRef<UniversalCamera | null>(null)

  const activeRef = useRef(false)
  const elapsedRef = useRef(0)
  const angleRef = useRef(0)
  const lastTimeRef = useRef(performance.now())
  const centerRef = useRef(new Vector3())
  const radiusRef = useRef(60)
  const heightRef = useRef(40)
  // Absolute XZ of the water plane, captured at start so we only drive its Y.
  const waterXZRef = useRef(new Vector3())

  const start = () => {
    if (!scene || activeRef.current) return
    const zone = gameStore.sourceZone
    if (!zone) return

    centerRef.current.copyFrom(zone.center)
    radiusRef.current = zone.radius * RADIUS_MUL
    heightRef.current = zone.radius * HEIGHT_MUL + HEIGHT_PAD

    const water = gameStore.sourceWater
    if (water) {
      water.plane.computeWorldMatrix(true)
      waterXZRef.current.copyFrom(water.plane.getAbsolutePosition())
    }

    const cam = new UniversalCamera(
      'sourceCutsceneCam',
      centerRef.current.clone(),
      scene,
    )
    cam.fov = FOV
    cam.minZ = 0.1
    // Begin the lap roughly where the player was already looking, for continuity.
    angleRef.current = gameStore.arcCam?.alpha ?? 0
    camRef.current = cam
    scene.activeCamera = cam

    activeRef.current = true
    elapsedRef.current = 0
    gameStore.sourceCutscene = true
    lastTimeRef.current = performance.now()
  }

  const end = () => {
    activeRef.current = false
    gameStore.sourceCutscene = false
    gameStore.sourceCutsceneDone = true
    // Snap the water to its final level so it stays full after the camera leaves.
    const water = gameStore.sourceWater
    if (water) {
      const xz = waterXZRef.current
      water.plane.setAbsolutePosition(new Vector3(xz.x, water.targetY, xz.z))
    }
    const cam = camRef.current
    if (scene && cam) {
      if (scene.activeCamera === cam) scene.activeCamera = gameStore.arcCam
      releaseCamera(scene, cam)
    }
    camRef.current = null
  }

  useEffect(() => {
    return () => {
      const cam = camRef.current
      if (scene && cam) {
        if (scene.activeCamera === cam) scene.activeCamera = gameStore.arcCam
        releaseCamera(scene, cam)
      }
      camRef.current = null
      if (gameStore.sourceCutscene) gameStore.sourceCutscene = false
    }
  }, [scene])

  useBeforeRender(() => {
    // Auto-trigger: player walks into the source footprint, once.
    if (
      !activeRef.current &&
      !gameStore.sourceCutsceneDone &&
      gameStore.phase === 'playing' &&
      !gameStore.cutscene &&
      !gameStore.villageCelebration
    ) {
      const zone = gameStore.sourceZone
      const body = gameStore.physics?.playerBody
      if (zone && body) {
        const t = body.translation()
        const dx = t.x - zone.center.x
        const dz = t.z - zone.center.z
        if (dx * dx + dz * dz <= zone.radius * zone.radius) start()
      }
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

    // Raise the water surface from its modeled level up to "waterY" over the
    // lap (smoothstep ease so it settles gently).
    const water = gameStore.sourceWater
    if (water) {
      const t = Math.min(elapsedRef.current / WATER_RISE_DURATION, 1)
      const e = t * t * (3 - 2 * t)
      const y = water.startY + (water.targetY - water.startY) * e
      const xz = waterXZRef.current
      water.plane.setAbsolutePosition(new Vector3(xz.x, y, xz.z))
    }

    if (elapsedRef.current >= DURATION) end()
  })

  return null
}
