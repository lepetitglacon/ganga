import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import { Mesh, VertexData, StandardMaterial, Color3 } from '@babylonjs/core'
import { generateRockMesh } from '@/game/rocks.ts'
import { gameStore } from '@/game/gameStore.ts'

// Renders the procedural rock massif. The geometry (positions/indices/colors)
// comes from generateRockMesh(), which is memoized so Map.tsx reuses the exact
// same triangle soup for the physics trimesh collider.
export const Rocks = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return

    const { positions, indices, colors } = generateRockMesh()
    const normals: number[] = []
    VertexData.ComputeNormals(positions, indices, normals)

    const vd = new VertexData()
    vd.positions = positions as unknown as number[]
    vd.indices = indices as unknown as number[]
    vd.normals = normals
    vd.colors = colors as unknown as number[]

    const mesh = new Mesh('rocks', scene)
    vd.applyToMesh(mesh)
    // Albedo comes from baked vertex colors (ochre + slope tint + cavity AO).
    mesh.useVertexColors = true

    const mat = new StandardMaterial('rockMat', scene)
    mat.diffuseColor = new Color3(1, 1, 1) // multiplies the vertex colors
    mat.specularColor = new Color3(0.14, 0.1, 0.06)
    mat.specularPower = 32
    // Surface Nets winding isn't guaranteed outward-facing everywhere; drawing
    // both sides avoids holes from accidentally flipped triangles.
    mat.backFaceCulling = false
    mesh.material = mat
    mesh.receiveShadows = true

    // Keep the rock out of the SSAO prepass: its deep carved canyons saturated
    // the screen-space AO to an ugly near-black pattern. Depth shading now comes
    // from the baked vertex AO instead. (Same prepass-exclusion the wing trails
    // use in Player.tsx.) SSAO still applies to the rest of the scene.
    const prePass = scene.prePassRenderer
    if (prePass) prePass.excludedMaterials.push(mat)

    const sg = gameStore.shadowGenerator
    if (sg) sg.addShadowCaster(mesh)

    return () => {
      if (prePass) {
        const i = prePass.excludedMaterials.indexOf(mat)
        if (i >= 0) prePass.excludedMaterials.splice(i, 1)
      }
      mesh.dispose()
    }
  }, [scene])

  return null
}
