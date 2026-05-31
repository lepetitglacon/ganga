import { Vector3 } from '@babylonjs/core'

export type Place = {
  name: string
  file: string
  position: Vector3
  // Inside flatRadius the terrain is fully flattened to groundY.
  // Between flatRadius and radius it blends smoothly back to the procedural height.
  // Both default to values derived from the loaded GLB's XZ bounding box.
  flatRadius?: number
  radius?: number
  groundY: number
  // Vertical offset (world units) applied to the model only, on top of groundY.
  // Lets a place sit slightly below the flattened ground (negative) to bury the
  // model/terrain seam, without changing the flattening target height.
  yOffset?: number
  rotationY?: number
  scale?: number
  // Padding ratio applied when deriving radius/flatRadius from the GLB bbox.
  // radius = bboxExtent * radiusPadding (default 1.25)
  // flatRadius = bboxExtent * flatRadiusRatio (default 0.95)
  radiusPadding?: number
  flatRadiusRatio?: number
  // World-space XZ bounding box of the loaded GLB, filled in once the
  // mesh is imported. Used e.g. for ambient sound zones.
  bbox?: { minX: number; maxX: number; minZ: number; maxZ: number }
  // Optional ambient sound URL played while the player is inside `bbox`.
  ambientSound?: string
  ambientVolume?: number
  // Child mesh name(s) to render with the animated oasis water shader
  // (visual-only: skipped when baking colliders).
  waterSurface?: string | string[]
  // Child mesh name(s) the bird can drink/wade from like an oasis: standing in
  // their footprint refills hydration and plays the splash/wading audio. Usually
  // the same plane as waterSurface (the visual + the refill behaviour).
  waterFiller?: string | string[]
  // Child mesh name(s) to treat as ground: terrain sand material + shadow
  // reception + fog (see applyGroundSurface). Add objects by listing their
  // mesh names here.
  groundSurface?: string | string[]
}

export const PLACES: Place[] = [
  {
    name: 'village',
    file: 'village.glb',
    position: new Vector3(200, 0, -150),
    groundY: 0,
    radiusPadding: 5,
    ambientSound: '/sound/ambiance/bird chipping.mp3',
    ambientVolume: 0.6,
  },
  {
    name: 'source',
    file: 'source.glb',
    position: new Vector3(-180, 0, 150),
    groundY: -50,
    // Sink the model 1m so the flat sand laps over its edges, hiding the seam.
    yOffset: -1,
    // Enlarge the flattened zone so it extends past the ~50u-wide model.
    radiusPadding: 1.6,
    flatRadiusRatio: 1.15,
    waterSurface: 'Plan.001',
    waterFiller: 'Plan.001',
    groundSurface: 'Plan',
  },
]

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// Returns the flattened height at (x, z), or the input procedural height if
// no place influences this point. Places whose radii haven't been resolved
// yet (GLB not loaded) are skipped.
export function applyPlaceFlattening(x: number, z: number, h: number): number {
  let out = h
  for (const p of PLACES) {
    if (p.radius == null || p.flatRadius == null) continue
    const dx = x - p.position.x
    const dz = z - p.position.z
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d >= p.radius) continue
    // t = 1 at center (fully flat), 0 at outer radius.
    const t = 1 - smoothstep(p.flatRadius, p.radius, d)
    out = out * (1 - t) + p.groundY * t
  }
  return out
}

// Fills place.radius / place.flatRadius from the XZ extent of the loaded GLB
// if they were not explicitly set in the config.
export function resolvePlaceRadiusFromBBox(
  place: Place,
  min: Vector3,
  max: Vector3,
): void {
  // Half-extent of the bounding box on the horizontal plane.
  const halfX = (max.x - min.x) * 0.5
  const halfZ = (max.z - min.z) * 0.5
  const extent = Math.max(halfX, halfZ)
  const radiusPadding = place.radiusPadding ?? 1.25
  const flatRatio = place.flatRadiusRatio ?? 0.95
  if (place.radius == null) place.radius = extent * radiusPadding
  if (place.flatRadius == null) place.flatRadius = extent * flatRatio
  // World-space XZ bbox = local bbox + place's XZ origin.
  place.bbox = {
    minX: place.position.x + min.x,
    maxX: place.position.x + max.x,
    minZ: place.position.z + min.z,
    maxZ: place.position.z + max.z,
  }
}