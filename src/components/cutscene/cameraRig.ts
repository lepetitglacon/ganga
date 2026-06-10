import { UniversalCamera, Vector3, type Scene } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'

// Shared cutscene-camera lifecycle. Every cutscene takes over rendering with a
// fresh UniversalCamera seeded from the live arc camera's pose (smooth handoff
// — the first PanTo/Orbit then glides from there) and hands back to the arc
// camera when it ends.

export function createCutsceneCamera(scene: Scene, fov: number): UniversalCamera {
  const cam = new UniversalCamera('cutsceneCam', Vector3.Zero(), scene)
  cam.fov = fov
  cam.minZ = 0.1

  // Seed position/target from the arc camera's spherical pose. PostProcess
  // auto-attaches SSAO to new cameras.
  const arc = gameStore.arcCam
  if (arc) {
    const at = arc.target
    const sb = Math.sin(arc.beta)
    cam.position.set(
      at.x + arc.radius * Math.cos(arc.alpha) * sb,
      at.y + arc.radius * Math.cos(arc.beta),
      at.z + arc.radius * Math.sin(arc.alpha) * sb,
    )
    cam.setTarget(at.clone())
  }

  scene.activeCamera = cam
  return cam
}

// Detach from every post-process pipeline (SSAO is shared across all cameras)
// before disposing, otherwise tearing down the camera leaves the pipeline in a
// broken state and the remaining (arc) camera renders white.
export function releaseCutsceneCamera(scene: Scene, cam: UniversalCamera): void {
  if (scene.activeCamera === cam) scene.activeCamera = gameStore.arcCam
  const mgr = scene.postProcessRenderPipelineManager
  for (const p of mgr.supportedPipelines) {
    mgr.detachCamerasFromRenderPipeline(p.name, cam)
  }
  cam.dispose()
}
