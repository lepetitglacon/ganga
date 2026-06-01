import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import { Mesh, VertexData, StandardMaterial, Color3 } from '@babylonjs/core'
import { loadRocks } from '@/workers/mapgen.ts'
import { gameStore } from '@/game/gameStore.ts'

// Renders the procedural rock massif. The geometry (positions/indices/colors/
// normals) is built off-thread by the map worker and memoized in mapgen.ts, so
// Map.tsx reuses the exact same triangle soup for the physics trimesh collider.
export const Rocks = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return
    let mesh: Mesh | null = null
    let mat: StandardMaterial | null = null
    let cancelled = false

    loadRocks().then(({ positions, indices, colors, normals }) => {
      if (cancelled || !scene) return

      const vd = new VertexData()
      vd.positions = positions
      vd.indices = indices
      vd.normals = normals
      vd.colors = colors

      mesh = new Mesh('rocks', scene)
      vd.applyToMesh(mesh)
      // Albedo comes from baked vertex colors (ochre + slope tint + cavity AO).
      mesh.useVertexColors = true

      mat = new StandardMaterial('rockMat', scene)
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
    })

    return () => {
      cancelled = true
      if (mat) {
        const prePass = scene.prePassRenderer
        if (prePass) {
          const i = prePass.excludedMaterials.indexOf(mat)
          if (i >= 0) prePass.excludedMaterials.splice(i, 1)
        }
      }
      mesh?.dispose()
    }
  }, [scene])

  return null
}
