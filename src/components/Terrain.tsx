import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import { Mesh, VertexData, StandardMaterial, Color3 } from '@babylonjs/core'
import {
  generateHeightData,
  TERRAIN_SIZE,
  TERRAIN_SUBDIVISIONS,
} from '@/game/terrain.ts'
import { gameStore } from '@/game/gameStore.ts'

export const Terrain = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return

    const heights = generateHeightData()
    gameStore.terrainHeights = heights

    const N = TERRAIN_SUBDIVISIONS
    const S = TERRAIN_SIZE
    const positions: number[] = []
    const indices: number[] = []
    const normals: number[] = []
    const uvs: number[] = []

    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = (i / N - 0.5) * S
        const z = (j / N - 0.5) * S
        const y = heights[i * (N + 1) + j]
        positions.push(x, y, z)
        uvs.push((i / N) * 12, (j / N) * 12)
      }
    }

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const a = i * (N + 1) + j
        const b = a + 1
        const c = (i + 1) * (N + 1) + j
        const d = c + 1
        indices.push(a, c, b)
        indices.push(b, c, d)
      }
    }

    VertexData.ComputeNormals(positions, indices, normals)

    const vd = new VertexData()
    vd.positions = positions
    vd.indices = indices
    vd.normals = normals
    vd.uvs = uvs

    const mesh = new Mesh('terrain', scene)
    vd.applyToMesh(mesh)

    const mat = new StandardMaterial('terrainMat', scene)
    // Warm sand — slightly desaturated so the fog/sky paints the distance.
    mat.diffuseColor = new Color3(0.86, 0.70, 0.46)
    mat.specularColor = new Color3(0.18, 0.14, 0.08)
    mat.specularPower = 48
    mesh.material = mat
    mesh.receiveShadows = true

    return () => {
      mesh.dispose()
      gameStore.terrainHeights = null
    }
  }, [scene])

  return null
}
