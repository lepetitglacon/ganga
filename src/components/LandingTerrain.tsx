import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import { Mesh, VertexData } from '@babylonjs/core'
import { createSandMaterial, getDuneHeight, getTerrainNormal } from '@/game/terrain.ts'

// Static sand-dune backdrop for the LandingScene (the intro/menu).
//
// Unlike the in-game Map, this does NOT stream chunks, load places/rocks, build
// physics, or apply biome tints. It's a single mesh of bare dune noise
// (getDuneHeight) wearing the shared sand material — "juste du sable comme au
// début". The whole patch is generated once on the main thread since the camera
// is fixed; no workers needed.

// World size of the dune patch and grid resolution. Big enough to fill the
// frame out to the fog, fine enough that the dunes read smoothly.
const PATCH_SIZE = 1400
const PATCH_CELLS = 140
// Texture/UV tiling in metres per repeat (matches the in-game UV_TILE feel).
const UV_TILE = 25

export const LandingTerrain = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return

    const N = PATCH_CELLS
    const cols = N + 1
    const cell = PATCH_SIZE / N
    const half = PATCH_SIZE / 2
    const vertCount = cols * cols

    const positions = new Float32Array(vertCount * 3)
    const normals = new Float32Array(vertCount * 3)
    const uvs = new Float32Array(vertCount * 2)
    const indices = new Uint32Array(N * N * 6)

    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = -half + i * cell
        const z = -half + j * cell
        const y = getDuneHeight(x, z)
        const k = i * cols + j
        const p = k * 3
        positions[p] = x
        positions[p + 1] = y
        positions[p + 2] = z
        const n = getTerrainNormal(x, z)
        normals[p] = n.x
        normals[p + 1] = n.y
        normals[p + 2] = n.z
        const u = k * 2
        uvs[u] = x / UV_TILE
        uvs[u + 1] = z / UV_TILE
      }
    }

    let t = 0
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const a = i * cols + j
        const b = a + 1
        const c = (i + 1) * cols + j
        const d = c + 1
        indices[t++] = a; indices[t++] = c; indices[t++] = b
        indices[t++] = b; indices[t++] = c; indices[t++] = d
      }
    }

    const vd = new VertexData()
    vd.positions = positions
    vd.indices = indices
    vd.normals = normals
    vd.uvs = uvs

    const mesh = new Mesh('landing-terrain', scene)
    vd.applyToMesh(mesh)
    mesh.receiveShadows = true

    const mat = createSandMaterial(scene)
    mesh.material = mat

    return () => {
      mesh.dispose()
      mat.dispose()
    }
  }, [scene])

  return null
}
