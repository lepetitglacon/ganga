import { useEffect, useState } from 'react'
import { useScene } from 'react-babylonjs'
import {
  SceneLoader,
  TransformNode,
  AbstractMesh,
  VertexBuffer,
  Vector3,
} from '@babylonjs/core'
import { TerrainStreamer } from './TerrainStreamer.tsx'
import { createSandMaterial, applyGroundSurface } from '@/game/terrain.ts'
import { Rocks } from './Rocks.tsx'
import { prepareMapGen, loadRocks, loadHeights, disposeMapGen } from '@/workers/mapgen.ts'
import { PLACES, resolvePlaceRadiusFromBBox, type Place } from '@/game/places.ts'
import { gameStore } from '@/game/gameStore.ts'
import { initRapier, PhysicsWorld } from '@/game/physics.ts'
import { createOasisWaterMaterial } from '@/game/oasisWaterMaterial.ts'
import { registerReservoirs, clearReservoirs } from '@/game/reservoir.ts'
import { registerWaterFiller, clearWaterFillers } from '@/game/waterFiller.ts'

type PlaceLoad = {
  place: Place
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
    let sandMat: ReturnType<typeof createSandMaterial> | null = null

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
          carrier.position.y = place.groundY + (place.yOffset ?? 0)
          if (place.rotationY != null) carrier.rotation.y = place.rotationY
          if (place.scale != null) carrier.scaling.setAll(place.scale)
          importedRoot.parent = carrier

          const sg = gameStore.shadowGenerator
          for (const m of result.meshes) {
            if (sg) sg.addShadowCaster(m)
            m.receiveShadows = true
          }

          roots.push(carrier)
          loaded.push({ place, meshes: result.meshes, carrier, root: importedRoot })
        })
      )

      if (cancelled) return

      // Place radii are now resolved from the GLB bounds: hand the flattening
      // footprints to the map generator. This mirrors them onto the main-thread
      // terrain module (so runtime getTerrainHeight matches) AND installs them on
      // every pool worker. Must finish before any chunk/heights job below.
      await prepareMapGen(
        PLACES.filter(
          (p): p is Place & { radius: number; flatRadius: number } =>
            p.radius != null && p.flatRadius != null,
        ).map((p) => ({
          x: p.position.x,
          z: p.position.z,
          radius: p.radius,
          flatRadius: p.flatRadius,
          groundY: p.groundY,
        })),
      )
      if (cancelled) return

      // Reservoirs: detach + shade the "water" level meshes (same material as
      // the oases) and register their trigger footprints for fill logic.
      waterMat = createOasisWaterMaterial(scene, { square: true })
      for (const { root } of loaded) registerReservoirs(root, waterMat)

      // Resolve a place's declared surface mesh names to the loaded meshes.
      const findSurfaces = (root: TransformNode, names?: string | string[]) => {
        if (!names) return []
        const list = Array.isArray(names) ? names : [names]
        const descendants = root.getDescendants(false)
        return list
          .map((n) => descendants.find((d) => d.name === n))
          .filter((m): m is AbstractMesh => m != null)
      }

      // Static water surfaces declared on a place (e.g. the source's Plan.001):
      // wear the same shader as the oases. Visual-only — flagged so the collider
      // bake below skips them.
      for (const { place, root } of loaded) {
        for (const surface of findSurfaces(root, place.waterSurface)) {
          surface.material = waterMat
          surface.isPickable = false
          surface.applyFog = false
        }
      }

      // Water-filler surfaces declared on a place (e.g. the source's Plan.001):
      // register their footprint so the bird refills + triggers wading audio
      // when standing in them, exactly like an oasis.
      for (const { place, root } of loaded) {
        for (const surface of findSurfaces(root, place.waterFiller)) {
          registerWaterFiller(surface)
        }
      }

      // Ground surfaces declared on a place (e.g. the source's Plan): get the
      // full terrain treatment (sand material + shadows + fog) via the shared
      // sand material.
      sandMat = createSandMaterial(scene)
      let sandUsed = false
      for (const { place, root } of loaded) {
        for (const surface of findSurfaces(root, place.groundSurface)) {
          applyGroundSurface(surface, sandMat)
          sandUsed = true
        }
      }
      if (!sandUsed) {
        sandMat.dispose()
        sandMat = null
      }

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

      // Source rising-water cutscene: locate the water surface (Plan.001) and
      // the "waterY" empty marking the height the water climbs to, plus the
      // footprint that triggers the cutscene when the player walks into it.
      for (const { place, root } of loaded) {
        if (place.name !== 'source') continue
        const descendants = root.getDescendants(false)
        const planeName = Array.isArray(place.waterSurface)
          ? place.waterSurface[0]
          : place.waterSurface
        const plane = descendants.find((d) => d.name === planeName) as
          | AbstractMesh
          | undefined
        const waterY = descendants.find((d) => /^watery$/i.test(d.name)) as
          | TransformNode
          | undefined
        if (plane) {
          plane.computeWorldMatrix(true)
          const startY = plane.getAbsolutePosition().y
          let targetY = startY
          if (waterY) {
            waterY.computeWorldMatrix(true)
            targetY = waterY.getAbsolutePosition().y
          } else {
            console.warn(
              '[source] no "waterY" empty found — water will not rise. Nodes:',
              descendants.map((d) => d.name),
            )
          }
          gameStore.sourceWater = { plane, startY, targetY }
        }
        const bbox = place.bbox
        if (bbox) {
          const cx = (bbox.minX + bbox.maxX) / 2
          const cz = (bbox.minZ + bbox.maxZ) / 2
          const extent = Math.max(bbox.maxX - bbox.minX, bbox.maxZ - bbox.minZ) / 2
          const cy =
            gameStore.sourceWater?.targetY ?? place.groundY + (place.yOffset ?? 0)
          gameStore.sourceZone = {
            center: new Vector3(cx, cy, cz),
            radius: extent,
          }
        }
      }

      setPlacesReady(true)

      // The physics heightfield is a single field over the whole map (the mesh
      // is streamed in chunks, but the collider is not). Build it off-thread via
      // the worker, then feed Rapier. terrainHeights is also read by PhysicsDebug.
      const heights = await loadHeights()
      if (cancelled) return
      gameStore.terrainHeights = heights

      const physics = new PhysicsWorld(heights)

      // Bake each place mesh into a world-space trimesh collider.
      for (const { meshes } of loaded) {
        for (const m of meshes) {
          // Water surfaces are visual-only — skip them. Reservoir "water"
          // meshes (detached by registerReservoirs) match by name; declared
          // place surfaces (e.g. Plan.001) are flagged by wearing waterMat.
          if (/^water/i.test(m.name) || m.material === waterMat) continue
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

      // Procedural rock massif — same triangle soup as the rendered mesh, built
      // once by the map worker (loadRocks is memoized) and shared with Rocks.tsx,
      // already in world space.
      const rock = await loadRocks()
      if (cancelled) return
      if (rock.indices.length > 0) {
        physics.addStaticTrimesh(rock.positions, rock.indices)
      }

      gameStore.physics = physics
    })()

    return () => {
      cancelled = true
      disposeMapGen()
      clearReservoirs()
      clearWaterFillers()
      waterMat?.dispose()
      sandMat?.dispose()
      roots.forEach((r) => r.dispose(false, true))
      gameStore.physics?.dispose()
      gameStore.physics = null
      gameStore.npcZone = null
      gameStore.sourceZone = null
      gameStore.sourceWater = null
    }
  }, [scene])

  return placesReady ? (
    <>
      <TerrainStreamer />
      <Rocks />
    </>
  ) : null
}
