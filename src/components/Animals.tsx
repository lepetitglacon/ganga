import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import {
  Material,
  SceneLoader,
  TransformNode,
  VertexBuffer,
  Vector3,
} from '@babylonjs/core'
import { getTerrainHeight } from '@/game/terrain.ts'
import { gameStore } from '@/game/gameStore.ts'
import { ANIMALS, type Animal } from '@/game/animals.ts'

// Loads one animal GLB: normalizes its size, drops it onto the terrain, shades
// it, and bakes a static trimesh body collider. Returns the carrier so it can
// be disposed on unmount. Meshes are static (no skeleton), so the trimesh is a
// faithful, fixed match for the body.
async function loadAnimal(
  animal: Animal,
  scene: Parameters<typeof SceneLoader.ImportMeshAsync>[3],
  isCancelled: () => boolean,
): Promise<TransformNode | null> {
  const result = await SceneLoader.ImportMeshAsync(
    '',
    '/gltf/animals/',
    animal.file,
    scene,
  )
  if (isCancelled()) {
    result.meshes.forEach((m) => m.dispose())
    return null
  }

  const importedRoot = result.meshes[0]

  // Normalize size from the imported bounding box, then drop its feet onto the
  // terrain at the configured XZ position.
  const { min, max } = importedRoot.getHierarchyBoundingVectors(true)
  const height = Math.max(max.y - min.y, 1e-3)
  const scale = animal.targetHeight / height

  const carrier = new TransformNode(`animal-${animal.name}`, scene)
  carrier.scaling.setAll(scale)
  carrier.rotation.y = animal.rotationY
  const groundY = getTerrainHeight(animal.position.x, animal.position.z)
  // min.y * scale is the offset from the carrier origin to the lowest point;
  // subtract it so the feet sit exactly on the ground.
  carrier.position.set(
    animal.position.x,
    groundY - min.y * scale,
    animal.position.z,
  )
  importedRoot.parent = carrier

  const sg = gameStore.shadowGenerator
  for (const m of result.meshes) {
    // Some GLBs (e.g. elephant) ship with alphaMode MASK + baseColor alpha 0,
    // which discards every fragment in the color pass (mesh invisible) while
    // still casting shadows. Force opaque so the body actually renders. None
    // of these animals use real transparency, so this is safe across the set.
    const mat = m.material
    if (mat) {
      mat.transparencyMode = Material.MATERIAL_OPAQUE
      mat.alpha = 1
    }
    if (sg) sg.addShadowCaster(m)
    m.receiveShadows = true
  }

  // Bake the body into a static world-space trimesh collider so the bird /
  // camera can't pass through it.
  const tmp = new Vector3()
  for (const m of result.meshes) {
    const positions = m.getVerticesData(VertexBuffer.PositionKind)
    const idx = m.getIndices()
    if (!positions || !idx || positions.length === 0 || idx.length === 0) continue

    m.computeWorldMatrix(true)
    const worldMat = m.getWorldMatrix()

    const worldPositions = new Float32Array(positions.length)
    for (let i = 0; i < positions.length; i += 3) {
      tmp.set(positions[i], positions[i + 1], positions[i + 2])
      const w = Vector3.TransformCoordinates(tmp, worldMat)
      worldPositions[i] = w.x
      worldPositions[i + 1] = w.y
      worldPositions[i + 2] = w.z
    }

    gameStore.physics?.addStaticTrimesh(worldPositions, new Uint32Array(idx))
  }

  return carrier
}

export const Animals = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return
    let cancelled = false
    const isCancelled = () => cancelled
    const carriers: TransformNode[] = []

    ;(async () => {
      // Map.tsx owns the physics world (built after the terrain heightfield);
      // wait for it so the trimesh colliders can be registered.
      while (!gameStore.physics) {
        await new Promise((r) => setTimeout(r, 16))
        if (cancelled) return
      }

      await Promise.all(
        ANIMALS.map(async (animal) => {
          const carrier = await loadAnimal(animal, scene, isCancelled)
          if (carrier) carriers.push(carrier)
        }),
      )
    })()

    return () => {
      cancelled = true
      carriers.forEach((c) => c.dispose(false, true))
    }
  }, [scene])

  return null
}
