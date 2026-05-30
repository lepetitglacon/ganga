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

    const { positions, indices } = generateRockMesh()
    const normals: number[] = []
    VertexData.ComputeNormals(positions, indices, normals)

    const vd = new VertexData()
    vd.positions = positions as unknown as number[]
    vd.indices = indices as unknown as number[]
    vd.normals = normals

    const mesh = new Mesh('rocks', scene)
    vd.applyToMesh(mesh)

    // Same flat, lit look as the sand terrain (Terrain.tsx) but ochre — so the
    // relief reads from lighting on the geometry, not a baked strata pattern.
    // No vertex colors: the old per-vertex strata looked like a static shader
    // and, being dark, dimmed the semi-transparent wing trails passing in front.
    const mat = new StandardMaterial('rockMat', scene)
    mat.diffuseColor = new Color3(0.82, 0.56, 0.32)
    mat.specularColor = new Color3(0.12, 0.09, 0.05)
    mat.specularPower = 48
    // Surface Nets winding isn't guaranteed outward-facing everywhere; drawing
    // both sides avoids holes from accidentally flipped triangles.
    mat.backFaceCulling = false
    mesh.material = mat
    mesh.receiveShadows = true

    // Exclude the rock from the SSAO prepass. The deep carved canyons/overhangs
    // generate huge screen-space ambient occlusion, which saturated the massif
    // to near-black with a screen-fixed AO pattern. Same trick the wing trails
    // use (Player.tsx). The rock still renders normally in the forward pass.
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
