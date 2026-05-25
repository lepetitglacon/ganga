import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import {
  Color3,
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
    hemi.intensity = 0.6
    // Warm sky bounce / cool ground bounce — Journey-ish ambient.
    hemi.diffuse = new Color3(1.0, 0.85, 0.65)
    hemi.groundColor = new Color3(0.45, 0.3, 0.22)

    // Sun direction must match Environment.tsx SUN_DIR (negated, since the
    // directional light points "toward" -SUN_DIR from its position).
    const sun = new DirectionalLight('sun', new Vector3(-1, -2, -1).normalize(), scene)
    sun.position = new Vector3(80, 160, 80)
    sun.intensity = 1.6
    sun.diffuse = new Color3(1.0, 0.88, 0.7)
    sun.specular = new Color3(1.0, 0.9, 0.75)

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
