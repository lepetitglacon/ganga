import { useEffect, useState } from 'react'
import { useScene } from 'react-babylonjs'
import { SceneLoader, TransformNode } from '@babylonjs/core'
import { Terrain } from './Terrain.tsx'
import { PLACES, resolvePlaceRadiusFromBBox } from '@/game/places.ts'
import { gameStore } from '@/game/gameStore.ts'

export const Map = () => {
  const scene = useScene()
  // Terrain is mounted only after places are loaded so that flattening can
  // use radii derived from each GLB's bounding box.
  const [placesReady, setPlacesReady] = useState(false)

  useEffect(() => {
    if (!scene) return
    let cancelled = false
    const roots: TransformNode[] = []

    ;(async () => {
      await Promise.all(
        PLACES.map(async (place) => {
          const result = await SceneLoader.ImportMeshAsync(
            '',
            '/gltf/places/',
            place.file,
            scene
          )
          if (cancelled) {
            result.meshes.forEach((m) => m.dispose())
            return
          }

          const importedRoot = result.meshes[0]
          // Bounds at origin, before parenting, so XZ extent is local-space.
          const { min, max } = importedRoot.getHierarchyBoundingVectors(true)
          resolvePlaceRadiusFromBBox(place, min, max)

          const carrier = new TransformNode(`place-${place.name}`, scene)
          carrier.position.copyFrom(place.position)
          carrier.position.y = place.groundY
          if (place.rotationY != null) carrier.rotation.y = place.rotationY
          if (place.scale != null) carrier.scaling.setAll(place.scale)
          importedRoot.parent = carrier

          const sg = gameStore.shadowGenerator
          for (const m of result.meshes) {
            if (sg) sg.addShadowCaster(m)
            m.receiveShadows = true
          }

          roots.push(carrier)
        })
      )

      if (!cancelled) setPlacesReady(true)
    })()

    return () => {
      cancelled = true
      roots.forEach((r) => r.dispose(false, true))
    }
  }, [scene])

  return placesReady ? <Terrain /> : null
}
