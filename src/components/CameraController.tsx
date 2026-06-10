import { useEffect, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import { ArcRotateCamera, UniversalCamera, Vector3, Scalar } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'
import { getTerrainHeight } from '@/game/terrain.ts'

// Keep the camera at least this many meters above the terrain at its own
// (x, z), so it never clips underground when orbiting low.
const CAMERA_GROUND_MARGIN = 2

// Camera obstacle avoidance: cast from the look target out to the camera and,
// if a physics collider (rock walls, structures, dunes) is closer than the
// orbit radius, pull the camera in to sit just in front of it — so the bird is
// never hidden behind geometry. Pull-in is instant; pull-out eases back via the
// normal radius lerp.
const CAMERA_COLLISION_MARGIN = 0.5
const CAMERA_MIN_RADIUS = 1.2

const MOUSE_SENSITIVITY = 0.002
// Near-full vertical orbit; epsilons avoid gimbal lock at the poles.
const BETA_MIN = 0.05
const BETA_MAX = Math.PI - 0.05
// Higher = camera snaps faster to the bird. Lower in flight so the bird
// leads and the camera trails (Feather-style chase).
const FOLLOW_LAG_FLYING = 2.4
const FOLLOW_LAG_GROUNDED = 20

// --- Feather-style framing ---
// Wider FOV gives the open-sky, panoramic feel.
const BASE_FOV = 1.1 // ~63°
// FOV opens up a bit more as speed climbs → sense of acceleration.
const FOV_SPEED_BOOST = 0.18
const SPEED_FOR_FULL_BOOST = 28 // m/s

// Camera distance: wider on the ground (third-person-walk feel), closer in
// flight where the bird drives the framing. Speed adds extra pull-back.
const RADIUS_GROUNDED = 60
const RADIUS_FLYING_BASE = 8
const RADIUS_PER_SPEED = 0.45 // radius += speed * this
const RADIUS_MAX = 32
const RADIUS_LERP = 2.5

// Screen-space framing: instead of offsetting the target by a fixed world
// amount, we drive the bird's *NDC position* (Normalized Device Coords:
// (0,0) = center, (±1, ±1) = corners). The world offset that achieves
// this is derived each frame from radius + fov + aspect.
//
// Sign: mouse-left → alpha grows → yawRate > 0 → bird should be at +sx
// (right edge). Mouse-up → beta shrinks → pitchRate < 0 → bird at -sy
// (bottom). So sx = yawRate × gain, sy = pitchRate × gain (no flips).
const SCREEN_YAW_GAIN = 0.18 // (rad/s) → NDC
const SCREEN_PITCH_GAIN = 0.18
const SCREEN_MAX_X = 0.72 // 0..1 — clamp before the absolute edge
const SCREEN_MAX_Y = 0.6
const LEAD_LERP = 4.5

// How fast the camera lerps back behind the bird after free-look is released.
const RECENTER_LERP = 6
const RECENTER_EPS = 0.005

// On the ground, nudge the look-target a touch above the bird so it sits a
// little lower in frame (more headroom). Eased in/out so the transition to and
// from flight is smooth.
const GROUNDED_TARGET_LIFT = 3 // meters
const GROUNDED_LIFT_LERP = 4

export const CameraController = () => {
  const scene = useScene()
  const lastTimeRef = useRef(performance.now())
  const prevAlphaRef = useRef(gameStore.camAlpha)
  const prevBetaRef = useRef(gameStore.camBeta)
  // Base target before the look-ahead offset is applied — separating these
  // lets the screen-space lead slide independently of the body-follow lerp.
  const baseTargetRef = useRef(new Vector3(0, 0, 0))
  // Smoothed bird NDC position. Drives the world target offset each frame.
  const screenLeadRef = useRef({ sx: 0, sy: 0 })
  // Smoothed vertical look-target lift, eased in while grounded.
  const groundLiftRef = useRef(0)

  useEffect(() => {
    if (!scene) return
    const canvas = scene.getEngine().getRenderingCanvas()!

    const arcCam = new ArcRotateCamera(
      'arcCam',
      gameStore.camAlpha,
      gameStore.camBeta,
      RADIUS_GROUNDED,
      Vector3.Zero(),
      scene
    )
    // Low lower-limit so obstacle avoidance can squeeze the camera in close
    // inside narrow canyons without Babylon re-clamping the radius back out.
    arcCam.lowerRadiusLimit = CAMERA_MIN_RADIUS
    arcCam.upperRadiusLimit = RADIUS_MAX
    arcCam.lowerBetaLimit = BETA_MIN
    arcCam.upperBetaLimit = BETA_MAX
    arcCam.minZ = 0.1
    arcCam.fov = BASE_FOV
    gameStore.arcCam = arcCam

    // Detached free-fly camera (Ctrl+C), using Babylon's built-in keyboard
    // movement. keyCodes are physical-position (US-QWERTY) based, so 87/65/83/68
    // are the keys labelled Z/Q/S/D on AZERTY (W/A/S/D positions); both the
    // QWERTY letters and the AZERTY-letter codes are listed to be safe. Space
    // (32) climbs, Shift (16) descends. attachControl (on toggle) wires the mouse
    // look. The terrain stream stays centered on the bird while you fly around.
    const freeCam = new UniversalCamera('freeCam', new Vector3(0, 5, -10), scene)
    freeCam.setTarget(Vector3.Zero())
    // Disable Babylon's built-in keyboard movement: it matches on `keyCode`,
    // which is layout-broken on AZERTY (Z/Q/W/A swap). We move the camera
    // ourselves below from `e.code` — exactly the source the bird uses, so the
    // same ZQSD keys that fly the bird also fly this cam.
    freeCam.keysUp = []
    freeCam.keysDown = []
    freeCam.keysLeft = []
    freeCam.keysRight = []
    freeCam.keysUpward = []
    freeCam.keysDownward = []
    freeCam.minZ = 0.1

    // Currently-held keys (by e.code). Filled by the window handlers below.
    const freeKeys = new Set<string>()
    const FREE_SPEED = 60 // m/s

    scene.activeCamera = arcCam

    const requestLock = () => {
      if (!document.pointerLockElement) canvas.requestPointerLock()
    }
    canvas.addEventListener('click', requestLock)

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return
      if (gameStore.camMode !== 'third') return
      // A cinematic owns the camera — don't let the mouse steer the bird.
      if (gameStore.cutscene || gameStore.villageCelebration || gameStore.sourceCutscene) return
      // Mouse drives the camera directly
      gameStore.camAlpha -= e.movementX * MOUSE_SENSITIVITY
      gameStore.camBeta = Scalar.Clamp(
        gameStore.camBeta - e.movementY * MOUSE_SENSITIVITY,
        BETA_MIN,
        BETA_MAX
      )
      // Outside of free-look the bird's heading mirrors the camera. Mouse
      // input also cancels any in-progress recenter — the player is steering
      // again, so the camera shouldn't be pulled back to a stale target.
      if (!gameStore.freeLook) {
        gameStore.birdAlpha = gameStore.camAlpha
        gameStore.birdBeta = gameStore.camBeta
        gameStore.recentering = false
      }
    }
    document.addEventListener('mousemove', onMouseMove)

    const onKeyDown = (e: KeyboardEvent) => {
      freeKeys.add(e.code)
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (!gameStore.freeLook) {
          gameStore.freeLook = true
          gameStore.recentering = false
        }
        return
      }
      if (!e.ctrlKey || e.code !== 'KeyC') return
      e.preventDefault()
      freeKeys.clear()
      if (gameStore.camMode === 'third') {
        gameStore.camMode = 'first'
        // Start where the orbit camera was so the switch doesn't jump.
        freeCam.position.copyFrom(arcCam.position)
        freeCam.setTarget(arcCam.target.clone())
        freeCam.attachControl(canvas, true)
        scene.activeCamera = freeCam
      } else {
        gameStore.camMode = 'third'
        freeCam.detachControl()
        scene.activeCamera = arcCam
      }
    }
    window.addEventListener('keydown', onKeyDown)

    const onKeyUp = (e: KeyboardEvent) => {
      freeKeys.delete(e.code)
      if (e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') return
      if (gameStore.freeLook) {
        gameStore.freeLook = false
        gameStore.recentering = true
      }
    }
    window.addEventListener('keyup', onKeyUp)

    // Move the free-fly cam each frame from e.code keys (layout-independent),
    // only while it's the active camera. Forward/back/left/right are KeyW/S/A/D
    // (= the AZERTY keys labelled Z/S/Q/D, same as the bird); Space climbs,
    // Shift descends. Driven by a direct scene observer so there's no hook/ref
    // timing in play.
    let freeLastT = performance.now()
    const freeMover = scene.onBeforeRenderObservable.add(() => {
      if (scene.activeCamera !== freeCam) {
        freeLastT = performance.now()
        return
      }
      const t = performance.now()
      const fdt = Math.min((t - freeLastT) / 1000, 0.05)
      freeLastT = t
      const fwd = freeCam.getDirection(Vector3.Forward())
      const right = freeCam.getDirection(Vector3.Right())
      const move = new Vector3(0, 0, 0)
      if (freeKeys.has('KeyW')) move.addInPlace(fwd)
      if (freeKeys.has('KeyS')) move.subtractInPlace(fwd)
      if (freeKeys.has('KeyA')) move.subtractInPlace(right)
      if (freeKeys.has('KeyD')) move.addInPlace(right)
      if (freeKeys.has('Space')) move.y += 1
      if (freeKeys.has('ShiftLeft') || freeKeys.has('ShiftRight')) move.y -= 1
      if (move.lengthSquared() > 0) {
        freeCam.position.addInPlace(move.normalize().scale(FREE_SPEED * fdt))
      }
    })

    return () => {
      canvas.removeEventListener('click', requestLock)
      document.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      scene.onBeforeRenderObservable.remove(freeMover)
      arcCam.dispose()
      freeCam.dispose()
      gameStore.arcCam = null
    }
  }, [scene])

  useBeforeRender(() => {
    const now = performance.now()
    const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05)
    lastTimeRef.current = now

    // Free-fly camera (Ctrl+C) is driven by Babylon's own keyboard input; the
    // orbit-follow logic below only runs in third-person.
    const cam = gameStore.arcCam
    const mesh = gameStore.mesh
    if (!cam || gameStore.camMode !== 'third') return

    // Recenter the camera back behind the bird after free-look released.
    if (gameStore.recentering && !gameStore.freeLook) {
      const t = 1 - Math.exp(-RECENTER_LERP * dt)
      let da = gameStore.birdAlpha - gameStore.camAlpha
      if (da > Math.PI) da -= 2 * Math.PI
      else if (da < -Math.PI) da += 2 * Math.PI
      const db = gameStore.birdBeta - gameStore.camBeta
      gameStore.camAlpha += da * t
      gameStore.camBeta += db * t
      if (Math.abs(da) < RECENTER_EPS && Math.abs(db) < RECENTER_EPS) {
        gameStore.camAlpha = gameStore.birdAlpha
        gameStore.camBeta = gameStore.birdBeta
        gameStore.recentering = false
      }
    }

    // Apply mouse angles directly — camera owns its own rotation
    cam.alpha = gameStore.camAlpha
    cam.beta = gameStore.camBeta

    // --- Base target: follow physics body with lag ---
    const body = gameStore.physics?.playerBody
    const k = gameStore.birdMode !== 'grounded' ? FOLLOW_LAG_FLYING : FOLLOW_LAG_GROUNDED
    const tLag = 1 - Math.exp(-k * dt)
    if (body) {
      const bt = body.translation()
      baseTargetRef.current.set(
        baseTargetRef.current.x + (bt.x - baseTargetRef.current.x) * tLag,
        baseTargetRef.current.y + (bt.y - baseTargetRef.current.y) * tLag,
        baseTargetRef.current.z + (bt.z - baseTargetRef.current.z) * tLag,
      )
    } else if (mesh) {
      Vector3.LerpToRef(baseTargetRef.current, mesh.position, tLag, baseTargetRef.current)
    }

    // --- Speed-aware framing ---
    let speed = 0
    if (body) {
      const v = body.linvel()
      speed = Math.hypot(v.x, v.y, v.z)
    }
    const base = gameStore.birdMode !== 'grounded' ? RADIUS_FLYING_BASE : RADIUS_GROUNDED
    const targetRadius = Math.min(
      base + speed * RADIUS_PER_SPEED,
      RADIUS_MAX
    )
    cam.radius += (targetRadius - cam.radius) * (1 - Math.exp(-RADIUS_LERP * dt))

    const speedT = Math.min(speed / SPEED_FOR_FULL_BOOST, 1)
    cam.fov = BASE_FOV + speedT * FOV_SPEED_BOOST

    // --- Screen-space lead (Feather framing) ---
    // 1) Compute yaw/pitch rate from the mouse-driven camera angles.
    let alphaDelta = gameStore.camAlpha - prevAlphaRef.current
    if (alphaDelta > Math.PI) alphaDelta -= 2 * Math.PI
    else if (alphaDelta < -Math.PI) alphaDelta += 2 * Math.PI
    prevAlphaRef.current = gameStore.camAlpha
    const yawRate = dt > 0 ? alphaDelta / dt : 0

    const betaDelta = gameStore.camBeta - prevBetaRef.current
    prevBetaRef.current = gameStore.camBeta
    const pitchRate = dt > 0 ? betaDelta / dt : 0

    // 2) Target bird position in NDC, clamped to corner box.
    const leadActive = gameStore.birdMode !== 'grounded'
    const targetSx = leadActive
      ? Math.max(-SCREEN_MAX_X, Math.min(SCREEN_MAX_X, yawRate * SCREEN_YAW_GAIN))
      : 0
    const targetSy = leadActive
      ? Math.max(-SCREEN_MAX_Y, Math.min(SCREEN_MAX_Y, pitchRate * SCREEN_PITCH_GAIN))
      : 0

    const lerpT = 1 - Math.exp(-LEAD_LERP * dt)
    screenLeadRef.current.sx += (targetSx - screenLeadRef.current.sx) * lerpT
    screenLeadRef.current.sy += (targetSy - screenLeadRef.current.sy) * lerpT
    const sx = screenLeadRef.current.sx
    const sy = screenLeadRef.current.sy

    // 3) Convert NDC offset → world offset along camera right/up axes.
    //    Right and up derived analytically from alpha/beta (LH coords,
    //    world up = +Y). half-tan-fov × radius × NDC = world distance from
    //    target at which the bird would project to (sx, sy).
    const a = gameStore.camAlpha
    const b = gameStore.camBeta
    const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b)
    const rightX = -sa, rightZ = ca // rightY = 0
    const upX = -ca * cb, upY = sb, upZ = -sa * cb
    const aspect = scene?.getEngine().getAspectRatio(cam) ?? 16 / 9
    const halfTan = Math.tan(cam.fov / 2)
    // Bird should APPEAR at (sx, sy) → target must be offset OPPOSITE
    // (subtract right × sx and up × sy).
    const offR = sx * cam.radius * halfTan * aspect
    const offU = sy * cam.radius * halfTan

    // Lift the camera+target pair vertically when the orbit would dip below
    // the terrain. Moving both by the same Δy preserves the look direction
    // (so the player can still aim straight up) while sliding the camera
    // along the ground instead of clamping pitch.
    let liftY = 0
    {
      const tgt = baseTargetRef.current
      const camX = tgt.x + cam.radius * ca * sb
      const camZ = tgt.z + cam.radius * sa * sb
      const camY = tgt.y + cam.radius * cb
      const minY = getTerrainHeight(camX, camZ) + CAMERA_GROUND_MARGIN
      if (camY < minY) liftY = minY - camY
    }

    // Mini upward look-target offset while grounded, eased in/out.
    const targetGroundLift = gameStore.birdMode === 'grounded' ? GROUNDED_TARGET_LIFT : 0
    groundLiftRef.current +=
      (targetGroundLift - groundLiftRef.current) * (1 - Math.exp(-GROUNDED_LIFT_LERP * dt))

    cam.target.set(
      baseTargetRef.current.x - rightX * offR - upX * offU,
      baseTargetRef.current.y - upY * offU + liftY + groundLiftRef.current,
      baseTargetRef.current.z - rightZ * offR - upZ * offU,
    )

    // --- Obstacle avoidance: keep the camera in front of physics colliders ---
    // The camera sits at target + radius·dir, where dir points from the look
    // target out along the orbit. Cast that segment against the physics world
    // (the player body is filtered out) and, on a hit, pull the radius in so
    // the camera never ends up behind a rock wall with the bird occluded.
    const phys = gameStore.physics
    if (phys?.playerBody) {
      const dir = { x: ca * sb, y: cb, z: sa * sb } // unit (sb²+cb²=1)
      const origin = { x: cam.target.x, y: cam.target.y, z: cam.target.z }
      const hit = phys.raycast(origin, dir, cam.radius)
      if (hit != null) {
        cam.radius = Math.max(CAMERA_MIN_RADIUS, hit - CAMERA_COLLISION_MARGIN)
      }
    }
  })

  return null
}
