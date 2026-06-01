import {
  Vector3,
  StandardMaterial,
  Color3,
  type AbstractMesh,
  type Scene,
} from '@babylonjs/core'
import { getTerrainNormalComponents } from './terrainGen.ts'

// Babylon glue around the pure terrain generation in terrainGen.ts. The heavy
// height/mesh generation lives there (Babylon-free, so it also runs in the map
// worker); this file only adds the bits that need Babylon types — materials and
// the Vector3 surface normal used by runtime gameplay queries.

// Re-export the pure helpers so existing imports of '@/game/terrain.ts' keep
// working unchanged.
export {
  getTerrainHeight,
  generateHeightData,
  ensureOasesResolved,
  setFlattenPlaces,
  generateTerrainData,
  TERRAIN_SIZE,
  TERRAIN_SUBDIVISIONS,
  type FlattenPlace,
  type TerrainData,
} from './terrainGen.ts'

// Sand material shared by the terrain mesh and any place surface that should
// blend into the ground (e.g. the source's flat base "Plan"). Warm, slightly
// desaturated sand so the fog/sky paints the distance.
export function createSandMaterial(scene: Scene): StandardMaterial {
  const mat = new StandardMaterial('terrainMat', scene)
  mat.diffuseColor = new Color3(0.86, 0.7, 0.46)
  mat.specularColor = new Color3(0.18, 0.14, 0.08)
  mat.specularPower = 48
  return mat
}

// Treats a place mesh as ground: gives it the sand material and the same
// shading the terrain gets — shadow reception and scene fog. Imported planes
// often carry inverted winding (GLB handedness flip), so we render AND light
// both sides; without twoSidedLighting the up-facing side gets a downward
// normal and looks flat/unlit with no sun shading or shadows.
//
// `mat` is shared across all ground surfaces — setting these flags on it is
// idempotent. To add a new ground object: name its mesh(es) and list them in
// the place's `groundSurface`; everything below is applied automatically.
export function applyGroundSurface(mesh: AbstractMesh, mat: StandardMaterial): void {
  mat.backFaceCulling = false
  mat.twoSidedLighting = true
  mesh.material = mat
  mesh.receiveShadows = true
  mesh.applyFog = true
}

// Analytical surface normal as a Babylon Vector3, for runtime gameplay queries
// (thermals, caravan/animal orientation, wading checks).
export function getTerrainNormal(x: number, z: number, eps = 2): Vector3 {
  const n = getTerrainNormalComponents(x, z, eps)
  return new Vector3(n.x, n.y, n.z)
}
