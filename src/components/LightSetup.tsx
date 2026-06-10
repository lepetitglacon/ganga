import { useEffect, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import type { DirectionalLight } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'
import {
  aimShadowsAt,
  createHemiLight,
  createShadowGenerator,
  createSun,
} from '@/game/lighting.ts'

export const LightSetup = () => {
  const scene = useScene()
  const sunRef = useRef<DirectionalLight | null>(null)

  useEffect(() => {
    if (!scene) return

    const hemi = createHemiLight(scene)
    const sun = createSun(scene)
    const shadows = createShadowGenerator(sun)
    sunRef.current = sun
    gameStore.shadowGenerator = shadows
    // Exposed so BiomeController can lerp them per biome.
    gameStore.sun = sun
    gameStore.hemi = hemi

    return () => {
      shadows.dispose()
      sun.dispose()
      hemi.dispose()
      sunRef.current = null
      gameStore.shadowGenerator = null
      gameStore.sun = null
      gameStore.hemi = null
    }
  }, [scene])

  // Keep the tight shadow frustum centered on the bird so it gets sharp shadows
  // wherever it roams the 3000 m terrain. Until the bird loads, the frustum
  // stays at its initial up-sun spot.
  useBeforeRender(() => {
    const sun = sunRef.current
    const bird = gameStore.mesh
    if (sun && bird) aimShadowsAt(sun, bird.getAbsolutePosition())
  })

  return null
}
