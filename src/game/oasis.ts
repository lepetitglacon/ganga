// Seeded oasis placement. Positions/radii are derived from OASIS_SEED so the
// map is stable across reloads — change the seed to reshuffle the layout.
//
// Geometry only lives here (where the points are). The per-oasis water level
// (waterY) and bowl floor (floorY) depend on the procedural terrain height and
// are filled in lazily by terrain.ts once they're first needed — see
// ensureOasesResolved() there. The Water component reads the resolved values
// to place its surface discs.

export type Oasis = {
  x: number
  z: number
  // Carve radius: beyond this the terrain returns to its procedural height.
  radius: number
  // Visible water disc radius — kept inside `radius` so the carved sand rim
  // always overlaps the water edge (no surface poking out of a dune).
  waterRadius: number
  // Per-oasis carve depths (randomized). rimDepth = how far the water sits
  // below the surrounding sand; poolDepth = bowl floor below the water surface.
  rimDepth: number
  poolDepth: number
  // Filled by terrain.ts:ensureOasesResolved(). 0 until resolved.
  waterY: number
  floorY: number
}

// Change this to regenerate a completely different set of waterholes.
export const OASIS_SEED = 0x5eed_0a51

const OASIS_COUNT = 8
// Keep oases within the central, reachable part of the 1600-wide terrain.
const PLACEMENT_HALF = 640
// Minimum spacing between two oasis centers so they don't merge.
const MIN_SEPARATION = 190
const MIN_RADIUS = 22
const MAX_RADIUS = 56
// Keep clear of the spawn point and the village so they don't get flooded.
const SPAWN_CLEARANCE = 130
const VILLAGE_POS = { x: 200, z: -150 }
const VILLAGE_CLEARANCE = 220

// mulberry32 — small, fast, well-distributed 32-bit seeded PRNG.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function generateOases(): Oasis[] {
  const rng = mulberry32(OASIS_SEED)
  const list: Oasis[] = []
  let attempts = 0
  while (list.length < OASIS_COUNT && attempts < 4000) {
    attempts++
    const x = (rng() * 2 - 1) * PLACEMENT_HALF
    const z = (rng() * 2 - 1) * PLACEMENT_HALF
    if (Math.hypot(x, z) < SPAWN_CLEARANCE) continue
    if (Math.hypot(x - VILLAGE_POS.x, z - VILLAGE_POS.z) < VILLAGE_CLEARANCE) continue
    if (list.some((o) => Math.hypot(o.x - x, o.z - z) < MIN_SEPARATION)) continue
    const radius = MIN_RADIUS + rng() * (MAX_RADIUS - MIN_RADIUS)
    const waterRatio = 0.55 + rng() * 0.15 // 0.55..0.70 of the carve radius
    // Kept shallow enough that a landed bird wades rather than fully submerges.
    const rimDepth = 0.9 + rng() * 0.6 // 0.9..1.5 below surrounding sand
    const poolDepth = 1.2 + rng() * 1.2 // 1.2..2.4 below the water surface
    list.push({
      x,
      z,
      radius,
      waterRadius: radius * waterRatio,
      rimDepth,
      poolDepth,
      waterY: 0,
      floorY: 0,
    })
  }
  return list
}

export const OASES: Oasis[] = generateOases()
