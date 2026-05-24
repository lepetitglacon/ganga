import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import {
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
  Vector3,
} from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'

export const LightSetup = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return

    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
    hemi.intensity = 0.5

    const sun = new DirectionalLight('sun', new Vector3(-1, -2, -1).normalize(), scene)
    sun.position = new Vector3(50, 80, 50)
    sun.intensity = 1.4

    const shadows = new ShadowGenerator(2048, sun)
    shadows.useBlurExponentialShadowMap = true
    shadows.blurKernel = 16
    gameStore.shadowGenerator = shadows

    return () => {
      shadows.dispose()
      sun.dispose()
      hemi.dispose()
      gameStore.shadowGenerator = null
    }
  }, [scene])

  return null
}
