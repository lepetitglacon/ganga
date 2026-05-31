// "Water filler" surfaces: flat planes declared on a place (e.g. the source's
// Plan.001) that the bird can drink/wade from like an oasis. Standing in their
// footprint refills hydration and triggers the splash/wading audio — same path
// the oases use, since Player keys all of that off the single `inWater` flag.
//
// Registered from the loaded GLB by Map; queried by Player each frame. The
// surface Y is read live from the mesh, so a plane that rises (e.g. the source
// filling during its cutscene) only counts as water once it has come up.

import { type AbstractMesh } from '@babylonjs/core'

export type WaterFiller = {
  mesh: AbstractMesh
  // World-space XZ footprint. The plane only ever moves vertically, so the
  // horizontal extent captured at registration stays valid.
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export const WATER_FILLERS: WaterFiller[] = []

// How far above the plane's current surface the bird still counts as wading, so
// a capsule standing in the shallows triggers it (mirrors WATER_WADE_HEIGHT).
const WADE_CLEARANCE = 1.8

export function registerWaterFiller(mesh: AbstractMesh): void {
  mesh.computeWorldMatrix(true)
  const { min, max } = mesh.getHierarchyBoundingVectors(true)
  WATER_FILLERS.push({
    mesh,
    minX: min.x,
    maxX: max.x,
    minZ: min.z,
    maxZ: max.z,
  })
}

// True when the bird is inside any filler's footprint and at/below its surface.
export function isInWaterFiller(pos: {
  x: number
  y: number
  z: number
}): boolean {
  for (const f of WATER_FILLERS) {
    if (pos.x < f.minX || pos.x > f.maxX || pos.z < f.minZ || pos.z > f.maxZ) {
      continue
    }
    if (pos.y <= f.mesh.getAbsolutePosition().y + WADE_CLEARANCE) return true
  }
  return false
}

export function clearWaterFillers(): void {
  WATER_FILLERS.length = 0
}
