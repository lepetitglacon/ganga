import { useEffect, useState } from 'react'
import { useScene } from 'react-babylonjs'
import {
  SceneLoader,
  TransformNode,
  AbstractMesh,
  VertexBuffer,
  Vector3,
} from '@babylonjs/core'
import { Terrain } from './Terrain.tsx'
import { PLACES, resolvePlaceRadiusFromBBox } from '@/game/places.ts'
import { gameStore } from '@/game/gameStore.ts'
import { initRapier, PhysicsWorld } from '@/game/physics.ts'
import { createOasisWaterMaterial } from '@/game/oasisWaterMaterial.ts'
import { registerReservoirs, clearReservoirs } from '@/game/reservoir.ts'

type PlaceLoad = {
  meshes: AbstractMesh[]
  carrier: TransformNode
  root: TransformNode
}

// How far from the talking bird the player can stand and still get the
// "F pour parler" prompt. PAD is added to the bird's own bounding radius; the
// fallback RADIUS is used when the node has no meshes to measure.
const NPC_TRIGGER_PAD = 13
const NPC_TRIGGER_RADIUS = 15

export const Map = () => {
  const scene = useScene()
  // Terrain is mounted only after places are loaded so that flattening can
  // use radii derived from each GLB's bounding box.
  const [placesReady, setPlacesReady] = useState(false)

  useEffect(() => {
    if (!scene) return
    let cancelled = false
    const roots: TransformNode[] = []
    const loaded: PlaceLoad[] = []
    let waterMat: ReturnType<typeof createOasisWaterMaterial> | null = null

    ;(async () => {
      await initRapier()
      if (cancelled) return

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
          loaded.push({ meshes: result.meshes, carrier, root: importedRoot })
        })
      )

      if (cancelled) return

      // Reservoirs: detach + shade the "water" level meshes (same material as
      // the oases) and register their trigger footprints for fill logic.
      waterMat = createOasisWaterMaterial(scene, { square: true })
      for (const { root } of loaded) registerReservoirs(root, waterMat)

      // Talking bird ("Armature"): build a proximity trigger from its meshes'
      // world bounds so the cutscene can be started with F when the player
      // stands nearby, and the cutscene camera knows where to frame it.
      for (const { root } of loaded) {
        const armature = root
          .getDescendants(false)
          .find((n) => /armature/i.test(n.name)) as TransformNode | undefined
        if (!armature) continue
        const childMeshes = armature.getChildMeshes(false)
        if (childMeshes.length === 0) {
          armature.computeWorldMatrix(true)
          gameStore.npcZone = {
            center: armature.getAbsolutePosition().clone(),
            radius: NPC_TRIGGER_RADIUS,
          }
          break
        }
        const min = new Vector3(Infinity, Infinity, Infinity)
        const max = new Vector3(-Infinity, -Infinity, -Infinity)
        for (const m of childMeshes) {
          m.computeWorldMatrix(true)
          const bb = m.getBoundingInfo().boundingBox
          min.minimizeInPlace(bb.minimumWorld)
          max.maximizeInPlace(bb.maximumWorld)
        }
        const center = min.add(max).scale(0.5)
        const radius = Vector3.Distance(min, max) * 0.5 + NPC_TRIGGER_PAD
        gameStore.npcZone = { center, radius }
        break
      }

      setPlacesReady(true)

      // Wait for Terrain to mount and populate terrainHeights before
      // building the physics world (which needs the heightfield data).
      while (!gameStore.terrainHeights) {
        await new Promise((r) => setTimeout(r, 16))
        if (cancelled) return
      }

      const physics = new PhysicsWorld(gameStore.terrainHeights)

      // Bake each place mesh into a world-space trimesh collider.
      for (const { meshes } of loaded) {
        for (const m of meshes) {
          // The reservoir "water" surface is visual-only — skip it (it's also
          // been detached from the hierarchy by registerReservoirs).
          if (/^water/i.test(m.name)) continue
          const positions = m.getVerticesData(VertexBuffer.PositionKind)
          const idx = m.getIndices()
          if (!positions || !idx || positions.length === 0 || idx.length === 0) continue

          m.computeWorldMatrix(true)
          const worldMat = m.getWorldMatrix()

          const worldPositions = new Float32Array(positions.length)
          const tmp = new Vector3()
          for (let i = 0; i < positions.length; i += 3) {
            tmp.set(positions[i], positions[i + 1], positions[i + 2])
            const w = Vector3.TransformCoordinates(tmp, worldMat)
            worldPositions[i] = w.x
            worldPositions[i + 1] = w.y
            worldPositions[i + 2] = w.z
          }

          physics.addStaticTrimesh(worldPositions, new Uint32Array(idx))
        }
      }

      gameStore.physics = physics
    })()

    return () => {
      cancelled = true
      clearReservoirs()
      waterMat?.dispose()
      roots.forEach((r) => r.dispose(false, true))
      gameStore.physics?.dispose()
      gameStore.physics = null
      gameStore.npcZone = null
      gameStore.nearNpc = false
    }
  }, [scene])

  return placesReady ? <Terrain /> : null
}
