import { useEffect, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import { UniversalCamera, Vector3, type Scene } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'
import { RESERVOIRS } from '@/game/reservoir.ts'
import {
  VILLAGE_INTRO_CUTSCENE,
  type CutsceneFocus,
} from '@/game/cutscene.ts'

// Detach from every post-process pipeline (SSAO is shared across all cameras)
// before disposing, otherwise tearing down the camera leaves the pipeline in a
// broken state and the remaining (arc) camera renders white. Same hazard the
// intro camera guards against.
function releaseCamera(scene: Scene, cam: UniversalCamera): void {
  const mgr = scene.postProcessRenderPipelineManager
  for (const p of mgr.supportedPipelines) {
    mgr.detachCamerasFromRenderPipeline(p.name, cam)
  }
  cam.dispose()
}

// How fast the camera glides between focus points (1/s, exponential). Kept slow
// so the travel from the NPC over to the reservoir reads as a deliberate pan.
const FOCUS_LERP = 1.4
// Camera offset relative to the focus point (world space). The NPC is framed
// from a few steps back; the reservoir from higher up and further out so its
// empty bowl reads.
const NPC_CAM_OFFSET = new Vector3(9, 5, 9)
const RES_CAM_OFFSET = new Vector3(-15, 17, -15)
const CUTSCENE_FOV = 0.9

export const Cutscene = () => {
  const scene = useScene()
  const camRef = useRef<UniversalCamera | null>(null)
  const lastTimeRef = useRef(performance.now())
  // Smoothed camera pose, lerped toward the current step's framing each frame.
  const posRef = useRef(new Vector3())
  const targetRef = useRef(new Vector3())

  const focusPoint = (focus: CutsceneFocus): Vector3 => {
    if (focus === 'reservoir' && RESERVOIRS.length > 0) {
      const r = RESERVOIRS[0]
      return r.min.add(r.max).scale(0.5)
    }
    return gameStore.npcZone?.center.clone() ?? Vector3.Zero()
  }
  const focusOffset = (focus: CutsceneFocus): Vector3 =>
    focus === 'reservoir' ? RES_CAM_OFFSET : NPC_CAM_OFFSET

  const startCutscene = () => {
    if (!scene || camRef.current) return
    const cam = new UniversalCamera('cutsceneCam', Vector3.Zero(), scene)
    cam.fov = CUTSCENE_FOV
    cam.minZ = 0.1

    // Seed the pose from the live arc camera for a smooth handoff, then it
    // glides to frame the NPC. PostProcess auto-attaches SSAO to new cameras.
    const arc = gameStore.arcCam
    if (arc) {
      const at = arc.target
      const ca = Math.cos(arc.alpha)
      const sa = Math.sin(arc.alpha)
      const sb = Math.sin(arc.beta)
      const cb = Math.cos(arc.beta)
      posRef.current.set(
        at.x + arc.radius * ca * sb,
        at.y + arc.radius * cb,
        at.z + arc.radius * sa * sb,
      )
      targetRef.current.copyFrom(at)
    }
    cam.position.copyFrom(posRef.current)
    cam.setTarget(targetRef.current)

    camRef.current = cam
    scene.activeCamera = cam
    gameStore.cutscene = { step: 0 }
    gameStore.nearNpc = false
    lastTimeRef.current = performance.now()
  }

  const endCutscene = () => {
    gameStore.cutscene = null
    const cam = camRef.current
    if (scene && cam) {
      if (scene.activeCamera === cam) scene.activeCamera = gameStore.arcCam
      releaseCamera(scene, cam)
    }
    camRef.current = null
  }

  const advance = () => {
    if (!gameStore.cutscene) return
    const next = gameStore.cutscene.step + 1
    if (next >= VILLAGE_INTRO_CUTSCENE.length) endCutscene()
    else gameStore.cutscene = { step: next }
  }

  useEffect(() => {
    if (!scene) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyF' && e.code !== 'Space' && e.code !== 'Enter') return
      if (!gameStore.cutscene) {
        // Start only with F, on the ground, inside the NPC zone.
        if (
          e.code === 'KeyF' &&
          gameStore.nearNpc &&
          gameStore.birdMode === 'grounded' &&
          gameStore.phase === 'playing'
        ) {
          e.preventDefault()
          startCutscene()
        }
        return
      }
      e.preventDefault()
      advance()
    }
    const onClick = () => {
      if (gameStore.cutscene) advance()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('click', onClick)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('click', onClick)
      if (gameStore.cutscene) endCutscene()
    }
  }, [scene])

  useBeforeRender(() => {
    const now = performance.now()
    const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05)
    lastTimeRef.current = now

    // Proximity: flag when the grounded player stands inside the NPC zone.
    const body = gameStore.physics?.playerBody
    const zone = gameStore.npcZone
    if (!gameStore.cutscene) {
      if (zone && body && gameStore.birdMode === 'grounded') {
        const t = body.translation()
        const dx = t.x - zone.center.x
        const dz = t.z - zone.center.z
        gameStore.nearNpc = dx * dx + dz * dz <= zone.radius * zone.radius
      } else {
        gameStore.nearNpc = false
      }
    }

    const cam = camRef.current
    if (!cam || !gameStore.cutscene) return

    const step = VILLAGE_INTRO_CUTSCENE[gameStore.cutscene.step]
    const fp = focusPoint(step.focus)
    const desiredPos = fp.add(focusOffset(step.focus))
    const k = 1 - Math.exp(-FOCUS_LERP * dt)
    Vector3.LerpToRef(posRef.current, desiredPos, k, posRef.current)
    Vector3.LerpToRef(targetRef.current, fp, k, targetRef.current)
    cam.position.copyFrom(posRef.current)
    cam.setTarget(targetRef.current)
  })

  return null
}
