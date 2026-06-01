import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import { Mesh, VertexData } from '@babylonjs/core'
import { createSandMaterial } from '@/game/terrain.ts'
import { loadTerrain } from '@/workers/mapgen.ts'
import { gameStore } from '@/game/gameStore.ts'

export const Terrain = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return
    let mesh: Mesh | null = null
    let cancelled = false

    // The height field + vertex buffers are built off-thread by the map worker
    // (see workers/mapgen.ts). Here we only wrap the returned typed arrays in a
    // Babylon mesh — the heavy noise/meshing never touches the main thread.
    loadTerrain().then((data) => {
      if (cancelled || !scene) return
      gameStore.terrainHeights = data.heights

      const vd = new VertexData()
      vd.positions = data.positions
      vd.indices = data.indices
      vd.normals = data.normals
      vd.uvs = data.uvs
      vd.colors = data.colors

      mesh = new Mesh('terrain', scene)
      vd.applyToMesh(mesh)
      mesh.useVertexColors = true
      mesh.material = createSandMaterial(scene)
      mesh.receiveShadows = true
    })

    return () => {
      cancelled = true
      mesh?.dispose()
      gameStore.terrainHeights = null
    }
  }, [scene])

  return null
}
