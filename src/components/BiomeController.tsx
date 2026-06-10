import { useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import { Color3 } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'
import { fog } from '@/game/fog.ts'
import {
  biomeAt,
  emitBiomeChange,
  DEFAULT_BIOME,
  type Biome,
} from '@/game/biomes.ts'

// Drives the per-frame "look" of the world from the biome under the BIRD: fog
// color + density, sun + hemispheric light. Values are lerped toward the current
// biome's targets so crossing a boundary is a smooth ~1.5 s blend, not a snap.
// The hard point-in-shape test only fires the biome-name toast (on id change).
//
// Centered on the bird, not the camera, so the free-fly cam doesn't change the
// ambiance.

// Exponential approach rate (1/s). ~0.8 ≈ 90% of the way in ~1.5 s.
const LERP_SPEED = 0.8

const tup = (c: [number, number, number]) => new Color3(c[0], c[1], c[2])

export const BiomeController = () => {
  const scene = useScene()
  // Current (smoothed) state, initialized to the base desert.
  const fogColor = useRef(tup(DEFAULT_BIOME.fogColor))
  const fogDensity = useRef(DEFAULT_BIOME.fogDensity)
  const sunColor = useRef(tup(DEFAULT_BIOME.sunColor))
  const sunI = useRef(DEFAULT_BIOME.sunIntensity)
  const hemiColor = useRef(tup(DEFAULT_BIOME.hemiColor))
  const hemiI = useRef(DEFAULT_BIOME.hemiIntensity)
  // Scratch target color to avoid per-frame allocation.
  const target = useRef(new Color3())

  useBeforeRender(() => {
    if (!scene) return
    const body = gameStore.physics?.playerBody
    const pos = body
      ? body.translation()
      : (gameStore.mesh?.position ?? null)
    if (!pos) return

    const b: Biome = biomeAt(pos.x, pos.z)

    // Biome-name toast on a hard boundary crossing.
    if (b.id !== gameStore.currentBiomeId) {
      gameStore.currentBiomeId = b.id
      emitBiomeChange(b)
    }

    const t = 1 - Math.exp(-LERP_SPEED * (scene.getEngine().getDeltaTime() / 1000))

    // Fog color + density.
    Color3.LerpToRef(fogColor.current, target.current.set(...b.fogColor), t, fogColor.current)
    fog.setColor(fogColor.current)
    fogDensity.current += (b.fogDensity - fogDensity.current) * t
    fog.setBaseDensity(fogDensity.current)

    // Sky horizon band tracks the fog so the terrain edge stays seamless.
    gameStore.skyMaterial?.setColor3('horizonColor', fogColor.current)

    // Sun.
    const sun = gameStore.sun
    if (sun) {
      Color3.LerpToRef(sunColor.current, target.current.set(...b.sunColor), t, sunColor.current)
      sun.diffuse.copyFrom(sunColor.current)
      sunI.current += (b.sunIntensity - sunI.current) * t
      sun.intensity = sunI.current
    }

    // Hemispheric ambient.
    const hemi = gameStore.hemi
    if (hemi) {
      Color3.LerpToRef(hemiColor.current, target.current.set(...b.hemiColor), t, hemiColor.current)
      hemi.diffuse.copyFrom(hemiColor.current)
      hemiI.current += (b.hemiIntensity - hemiI.current) * t
      hemi.intensity = hemiI.current
    }
  })

  return null
}
