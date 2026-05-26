import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import { SSAO2RenderingPipeline } from '@babylonjs/core'

const PIPELINE_NAME = 'ssao'

export const PostProcess = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return
    const engine = scene.getEngine()
    if (!engine.getCaps().drawBuffersExtension) {
      console.warn('[PostProcess] SSAO2 requires WebGL2 / MRT, skipping.')
      return
    }

    const ssao = new SSAO2RenderingPipeline(
      PIPELINE_NAME,
      scene,
      { ssaoRatio: 0.5, blurRatio: 1 },
      []
    )
    ssao.radius = 2
    ssao.totalStrength = 1.3
    ssao.expensiveBlur = true
    ssao.samples = 16
    ssao.maxZ = 250
    ssao.minZAspect = 0.2

    const mgr = scene.postProcessRenderPipelineManager

    const attach = (cam: import('@babylonjs/core').Camera) => {
      mgr.attachCamerasToRenderPipeline(PIPELINE_NAME, cam)
    }
    scene.cameras.forEach(attach)
    const addObs = scene.onNewCameraAddedObservable.add(attach)

    return () => {
      scene.onNewCameraAddedObservable.remove(addObs)
      ssao.dispose()
    }
  }, [scene])

  return null
}
