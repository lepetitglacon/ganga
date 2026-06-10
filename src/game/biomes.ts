// Hand-authored biomes. Babylon-free (plain numbers / tuples only) so this can
// run inside the map worker (per-vertex ground tint) AND on the main thread
// (per-frame fog/light driving + the biome-name HUD toast).
//
// A biome is a set of 2D (x, z) shapes plus the look it imposes: fog color +
// density, sun + hemispheric light, and an optional ground tint baked into the
// terrain vertex colors. biomeAt(x, z) returns the highest-priority biome whose
// shape contains the point, or DEFAULT_BIOME (the base desert) elsewhere.
//
// To add a biome: drop an entry in BIOMES with one or more shapes and the look
// you want. Higher `priority` wins where shapes overlap. Everything OUTSIDE your
// shapes keeps DEFAULT_BIOME, which mirrors the current desert exactly — so the
// untouched world is unchanged.

export type RGB = [number, number, number]

export type BiomeShape =
  | { type: 'circle'; x: number; z: number; r: number }
  | { type: 'rect'; minX: number; minZ: number; maxX: number; maxZ: number }
  // Polygon in XZ, vertices in order (CW or CCW). Tested by ray-crossing.
  | { type: 'polygon'; points: [number, number][] }

export type Biome = {
  id: string
  // Shown in the biome-name HUD toast when you enter it.
  label: string
  // Overlap tie-break: higher wins. DEFAULT_BIOME is -Infinity.
  priority: number
  shapes: BiomeShape[]
  // Scene fog. color also drives the sky-horizon band so the edge stays seamless.
  fogColor: RGB
  fogDensity: number
  // Directional sun.
  sunColor: RGB
  sunIntensity: number
  // Hemispheric ambient.
  hemiColor: RGB
  hemiIntensity: number
  // Optional per-vertex multiplier baked into the terrain color in the worker.
  groundTint?: RGB
}

// The base desert. Values mirror world.ts (HORIZON_COLOR), fog.ts (baseDensity)
// and lighting.ts (SUN_LIGHT / HEMI_LIGHT) so anywhere NOT inside an authored
// shape looks exactly like today. Keep these in sync if you retune the base.
export const DEFAULT_BIOME: Biome = {
  id: 'desert',
  label: 'Désert',
  priority: -Infinity,
  shapes: [],
  fogColor: [0.9, 0.74, 0.5], // HORIZON_COLOR
  fogDensity: 0.0042, // FOG.baseDensity
  sunColor: [1.0, 0.88, 0.7], // SUN_LIGHT.diffuse
  sunIntensity: 1.6, // SUN_LIGHT.intensity
  hemiColor: [1.0, 0.85, 0.65], // HEMI_LIGHT.diffuse
  hemiIntensity: 0.6, // HEMI_LIGHT.intensity
}

// --- Authored biomes --------------------------------------------------------
// Examples to copy. Coordinates are world metres (the map spans roughly
// ±1500 on X and Z). Edit freely.
export const BIOMES: Biome[] = [
  {
    id: 'oasis-verdoyante',
    label: 'Oasis Verdoyante',
    priority: 0,
    shapes: [{ type: 'circle', x: 0, z: 0, r: 260 }],
    // Cooler, clearer air; greener light; greener ground.
    fogColor: [0.72, 0.82, 0.62],
    fogDensity: 0.003,
    sunColor: [0.95, 1.0, 0.82],
    sunIntensity: 1.5,
    hemiColor: [0.75, 0.95, 0.7],
    hemiIntensity: 0.75,
    groundTint: [0.7, 0.95, 0.6],
  },
  {
    id: 'terres-rouges',
    label: 'Terres Rouges',
    priority: 0,
    shapes: [
      {
        type: 'polygon',
        points: [
          [600, 400],
          [1100, 300],
          [1200, 900],
          [800, 1100],
          [500, 800],
        ],
      },
    ],
    // Hot, hazy, rust-red.
    fogColor: [0.85, 0.5, 0.35],
    fogDensity: 0.006,
    sunColor: [1.0, 0.7, 0.5],
    sunIntensity: 1.7,
    hemiColor: [0.9, 0.55, 0.4],
    hemiIntensity: 0.55,
    groundTint: [1.0, 0.6, 0.45],
  },
]

// --- Point-in-shape ---------------------------------------------------------

function pointInShape(x: number, z: number, s: BiomeShape): boolean {
  switch (s.type) {
    case 'circle': {
      const dx = x - s.x
      const dz = z - s.z
      return dx * dx + dz * dz <= s.r * s.r
    }
    case 'rect':
      return x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ
    case 'polygon': {
      // Ray-crossing (even-odd) test in the XZ plane.
      const p = s.points
      let inside = false
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const xi = p[i][0]
        const zi = p[i][1]
        const xj = p[j][0]
        const zj = p[j][1]
        const intersect =
          zi > z !== zj > z &&
          x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
        if (intersect) inside = !inside
      }
      return inside
    }
  }
}

function biomeContains(b: Biome, x: number, z: number): boolean {
  for (const s of b.shapes) if (pointInShape(x, z, s)) return true
  return false
}

// Highest-priority biome whose shape contains (x, z); DEFAULT_BIOME otherwise.
export function biomeAt(x: number, z: number): Biome {
  let best: Biome = DEFAULT_BIOME
  for (const b of BIOMES) {
    if (b.priority <= best.priority) continue
    if (biomeContains(b, x, z)) best = b
  }
  return best
}

// --- Biome-change events ----------------------------------------------------
// BiomeController fires this when the bird crosses into a new biome; the
// BiomeToast HUD subscribes to show the biome name.

type BiomeListener = (b: Biome) => void
const listeners = new Set<BiomeListener>()

export function subscribeBiomeChange(fn: BiomeListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emitBiomeChange(b: Biome): void {
  for (const fn of listeners) fn(b)
}
