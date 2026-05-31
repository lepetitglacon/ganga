import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import { Mesh, VertexData } from '@babylonjs/core'
import {
  generateHeightData,
  createSandMaterial,
  TERRAIN_SIZE,
  TERRAIN_SUBDIVISIONS,
} from '@/game/terrain.ts'
import { OASES } from '@/game/oasis.ts'
import { gameStore } from '@/game/gameStore.ts'

// Wet-sand vertex tint: a per-channel multiplier applied to the dry sand color
// where the ground is damp. Darker AND browner than dry sand (blue/green pulled
// down more than red) so the ring around each pool reads as wet earth, not just
// shadow. The wet-footprint decals in Player.tsx use the matching damp brown.
const WET_SAND_TINT = { r: 0.6, g: 0.42, b: 0.3 }
function sandWetness(x: number, z: number): number {
  let wet = 0
  for (const o of OASES) {
    const d = Math.hypot(x - o.x, z - o.z)
    const outer = Math.min(o.radius, o.waterRadius + 9)
    // 1 inside the water disc, fading to 0 at the outer damp edge.
    const w = 1 - Math.min(1, Math.max(0, (d - o.waterRadius) / (outer - o.waterRadius)))
    if (w > wet) wet = w
  }
  return wet
}

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
    const colors: number[] = []

    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = (i / N - 0.5) * S
        const z = (j / N - 0.5) * S
        const y = heights[i * (N + 1) + j]
        positions.push(x, y, z)
        uvs.push((i / N) * 12, (j / N) * 12)
        // Vertex color multiplies the sand diffuse; tint toward damp brown.
        const w = sandWetness(x, z)
        colors.push(
          1 - w * (1 - WET_SAND_TINT.r),
          1 - w * (1 - WET_SAND_TINT.g),
          1 - w * (1 - WET_SAND_TINT.b),
          1,
        )
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
    vd.colors = colors

    const mesh = new Mesh('terrain', scene)
    vd.applyToMesh(mesh)
    mesh.useVertexColors = true

    mesh.material = createSandMaterial(scene)
    mesh.receiveShadows = true

    return () => {
      mesh.dispose()
      gameStore.terrainHeights = null
    }
  }, [scene])

  return null
}
