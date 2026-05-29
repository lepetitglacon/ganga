import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import type { StandardMaterial } from '@babylonjs/core'
import { wetnessMask, WetnessPlugin } from '@/game/wetness.ts'
import { gameStore } from '@/game/gameStore.ts'

// Seconds for the painted wet trail to dry out (fade to nothing).
const DRY_TIME = 10
// Brush radius in meters and per-frame deposit while wet feet touch the ground.
const PAINT_RADIUS = 1.3
const PAINT_STRENGTH = 0.5

export const WetnessMask = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return
    wetnessMask.init(scene)
    let plugin: WetnessPlugin | null = null

    const obs = scene.onBeforeRenderObservable.add(() => {
      // Attach the plugin to the terrain material once it has been created.
      if (!plugin) {
        const mat = scene.getMaterialByName('terrainMat') as StandardMaterial | null
        if (!mat) return
        plugin = new WetnessPlugin(mat)
        plugin.texture = wetnessMask.texture
        plugin.worldSize = wetnessMask.worldSize
        plugin.isEnabled = true
      }

      const dt = scene.getEngine().getDeltaTime() / 1000
      const mesh = gameStore.mesh
      if (mesh) wetnessMask.recenter(mesh.position.x, mesh.position.z)
      plugin.centerX = wetnessMask.centerX
      plugin.centerZ = wetnessMask.centerZ

      wetnessMask.decay(dt, DRY_TIME)
      // Paint whenever wet feet touch the ground — including while wading in the
      // pool. That way the wet patch is already laid at the shoreline, so the
      // in→out transition is seamless (no gap at the water's edge).
      if (mesh && gameStore.birdMode === 'grounded' && gameStore.feetWet > 0.02) {
        wetnessMask.paint(
          mesh.position.x,
          mesh.position.z,
          PAINT_STRENGTH * gameStore.feetWet,
          PAINT_RADIUS,
        )
      }
      wetnessMask.commit()
    })

    return () => {
      scene.onBeforeRenderObservable.remove(obs)
      if (plugin) plugin.isEnabled = false
      wetnessMask.dispose()
    }
  }, [scene])

  return null
}
