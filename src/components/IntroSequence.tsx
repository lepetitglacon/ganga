import { useEffect, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import { UniversalCamera, Vector3, Scalar, type Scene } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'
import { getTerrainHeight } from '@/game/terrain.ts'
import { audio } from '@/game/audio.ts'

// Detach from every post-process pipeline (SSAO is shared across all cameras)
// before disposing, otherwise tearing down a shared camera leaves the pipeline
// in a broken state and the remaining (arc) camera renders white.
function releaseCamera(scene: Scene, cam: UniversalCamera): void {
  const mgr = scene.postProcessRenderPipelineManager
  for (const p of mgr.supportedPipelines) {
    mgr.detachCamerasFromRenderPipeline(p.name, cam)
  }
  cam.dispose()
}

const INTRO_MUSIC_URL = '/sound/ambiance/intro.mp3'
const INTRO_MUSIC_VOLUME = 0.55
const MUSIC_FADE_IN = 0.4 // volume/s while the cinematic plays
const MUSIC_FADE_OUT = 0.45 // volume/s once we land on the player

// Cinematic orbit: a slow, high pan circling the spawn so the dunes drift past.
const ORBIT_RADIUS = 170
const ORBIT_HEIGHT = 55 // meters above the look-at point
const ORBIT_SPEED = 0.05 // rad/s — barely moving, very calm
const LOOK_HEIGHT = 8 // raise the target a touch above the ground

// Slow, eased glide from the cinematic camera onto the player's chase camera.
const TRANSITION_DURATION = 3.6 // seconds
const INTRO_FOV = 0.8

// Cubic ease-in-out for a soft start and a gentle settle onto the bird.
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

type Mode = 'intro' | 'transition' | 'done'

export const IntroSequence = () => {
  const scene = useScene()
  const camRef = useRef<UniversalCamera | null>(null)
  const musicRef = useRef<{ setVolume: (v: number) => void } | null>(null)
  const musicVolRef = useRef(0)
  const lastTimeRef = useRef(performance.now())
  const angleRef = useRef(0)
  const modeRef = useRef<Mode>('intro')
  // Captured at the instant the player clicks "Jouer", so the lerp has a fixed
  // start pose to interpolate away from while the arc camera keeps tracking.
  const startRef = useRef<{ pos: Vector3; target: Vector3; fov: number } | null>(null)
  const elapsedRef = useRef(0)
  // Reused scratch so the per-frame lerp doesn't allocate.
  const centerRef = useRef(new Vector3(0, 0, 0))
  const tmpTargetRef = useRef(new Vector3(0, 0, 0))

  useEffect(() => {
    if (!scene) return
    const groundY = getTerrainHeight(0, 0)
    centerRef.current.set(0, groundY + LOOK_HEIGHT, 0)

    const cam = new UniversalCamera('introCam', new Vector3(0, groundY + ORBIT_HEIGHT, ORBIT_RADIUS), scene)
    cam.fov = INTRO_FOV
    cam.minZ = 0.1
    cam.setTarget(centerRef.current)
    camRef.current = cam
    // Mounts after CameraController, so this wins as the active camera for the
    // cinematic. The handoff back to the arc camera happens at the end of the
    // transition.
    scene.activeCamera = cam

    // Best-effort: the loop plays as soon as the audio engine unlocks (first
    // user gesture). It is guaranteed audible during the "Jouer" transition,
    // since that click unlocks the engine, then fades out on arrival.
    musicRef.current = audio.loop(INTRO_MUSIC_URL, { volume: 0 })

    return () => {
      musicRef.current?.setVolume(0)
      musicRef.current = null
      if (scene.activeCamera === cam) scene.activeCamera = gameStore.arcCam
      releaseCamera(scene, cam)
      camRef.current = null
    }
  }, [scene])

  useBeforeRender(() => {
    const cam = camRef.current
    if (!cam || !scene || modeRef.current === 'done') return

    const now = performance.now()
    const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05)
    lastTimeRef.current = now

    // Kick off the glide the first frame after the player clicks "Jouer".
    if (modeRef.current === 'intro' && gameStore.phase === 'playing') {
      modeRef.current = 'transition'
      elapsedRef.current = 0
      startRef.current = {
        pos: cam.position.clone(),
        target: cam.getTarget().clone(),
        fov: cam.fov,
      }
    }

    if (modeRef.current === 'intro') {
      // Slow cinematic orbit around the spawn.
      angleRef.current += dt * ORBIT_SPEED
      const c = centerRef.current
      cam.position.set(
        c.x + Math.cos(angleRef.current) * ORBIT_RADIUS,
        c.y + ORBIT_HEIGHT,
        c.z + Math.sin(angleRef.current) * ORBIT_RADIUS,
      )
      cam.setTarget(c)

      // Fade the music up to its bed level.
      musicVolRef.current = Math.min(INTRO_MUSIC_VOLUME, musicVolRef.current + MUSIC_FADE_IN * dt)
      musicRef.current?.setVolume(musicVolRef.current)
      return
    }

    // --- transition: ease from the cinematic pose onto the live arc camera ---
    const arc = gameStore.arcCam
    const start = startRef.current
    if (!arc || !start) return

    elapsedRef.current += dt
    const t = Math.min(1, elapsedRef.current / TRANSITION_DURATION)
    const k = easeInOut(t)

    // Arc camera target is updated each frame by CameraController. Derive its
    // world position analytically (it isn't the active camera, so its own
    // .position vector may be stale).
    const at = arc.target
    const ca = Math.cos(arc.alpha)
    const sa = Math.sin(arc.alpha)
    const sb = Math.sin(arc.beta)
    const cb = Math.cos(arc.beta)
    const arcX = at.x + arc.radius * ca * sb
    const arcY = at.y + arc.radius * cb
    const arcZ = at.z + arc.radius * sa * sb

    cam.position.set(
      Scalar.Lerp(start.pos.x, arcX, k),
      Scalar.Lerp(start.pos.y, arcY, k),
      Scalar.Lerp(start.pos.z, arcZ, k),
    )
    tmpTargetRef.current.set(
      Scalar.Lerp(start.target.x, at.x, k),
      Scalar.Lerp(start.target.y, at.y, k),
      Scalar.Lerp(start.target.z, at.z, k),
    )
    cam.setTarget(tmpTargetRef.current)
    cam.fov = Scalar.Lerp(start.fov, arc.fov, k)

    // Music holds through the move, then fades to 0.2 once we've arrived on the bird.
    if (t >= 1) {
      const targetVolume = 0.2
      musicVolRef.current = Math.max(targetVolume, musicVolRef.current - MUSIC_FADE_OUT * dt)
      musicRef.current?.setVolume(musicVolRef.current)
      if (musicVolRef.current <= targetVolume + 0.001) {
        // Hand the view over to the player's chase camera and step aside.
        scene.activeCamera = arc
        audio.attachListener(scene)
        modeRef.current = 'done'
        releaseCamera(scene, cam)
        camRef.current = null
      }
    }
  })

  return null
}
