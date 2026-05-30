import { Vector3 } from '@babylonjs/core'
import { applyPlaceFlattening } from './places.ts'
import { OASES } from './oasis.ts'

// How far the carved rim crest sits ABOVE the water surface. The bowl always
// rises past the waterline just outside the water disc, so the flat surface is
// enclosed on every side (no edge-on view of the plane), even on a slope.
const OASIS_RIM_LIP = 0.9

// Extended from 1600/192 to 3000/360: the cell size (S/N = 8.33 m) is kept
// identical, so every sample over the original central area lands on the exact
// same world position and the existing terrain is unchanged — the larger grid
// only adds desert further out, big enough to host the ring of rock massifs
// (rocks.ts) that surrounds the map.
export const TERRAIN_SIZE = 3000
export const TERRAIN_SUBDIVISIONS = 360

// Cheap hash-based pseudo-random in [0..1)
function hash2(x: number, y: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263
  h = (h ^ (h >> 13)) * 1274126177
  return ((h ^ (h >> 16)) >>> 0) / 4294967295
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

// Bilinearly-interpolated value noise on an integer grid.
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const v00 = hash2(xi, yi)
  const v10 = hash2(xi + 1, yi)
  const v01 = hash2(xi, yi + 1)
  const v11 = hash2(xi + 1, yi + 1)
  const u = smooth(xf)
  const v = smooth(yf)
  return (
    v00 * (1 - u) * (1 - v) +
    v10 * u * (1 - v) +
    v01 * (1 - u) * v +
    v11 * u * v
  )
}

function fbm(x: number, y: number, octaves: number, gain: number): number {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq)
    norm += amp
    amp *= gain
    freq *= 2
  }
  return sum / norm
}

// Domain-warped fbm gives curvy, crescent-like dune crests instead of
// the radially-symmetric blobs that raw fbm produces. This is the bare dune
// height (noise + place flattening), WITHOUT oasis carving — oasis water levels
// are derived from it, so it must stay carve-free to avoid feedback.
function baseHeight(x: number, z: number): number {
  const wx = fbm(x * 0.004, z * 0.004, 3, 0.5)
  const wz = fbm((x + 137) * 0.004, (z + 53) * 0.004, 3, 0.5)
  const base = fbm(x * 0.00175 + wx * 3.0, z * 0.00175 + wz * 3.0, 5, 0.55)
  const ripples = (fbm(x * 0.18, z * 0.18, 2, 0.5) - 0.5) * 0.7
  const h = (base - 0.5) * 150 + ripples
  return applyPlaceFlattening(x, z, h)
}

// Resolve each oasis's water surface / bowl floor from the local dune height.
// Lazy + idempotent: the first heightAt() call (terrain bake) triggers it, and
// Water.tsx calls it explicitly before reading waterY.
let oasesResolved = false
export function ensureOasesResolved(): void {
  if (oasesResolved) return
  oasesResolved = true
  for (const o of OASES) {
    const h0 = baseHeight(o.x, o.z)
    o.waterY = h0 - o.rimDepth
    o.floorY = o.waterY - o.poolDepth
  }
}

// Carve a self-contained basin at each oasis. Inside the carve radius the
// terrain is REPLACED by an analytic profile (not just lowered): it rises from
// the bowl floor at the center, past the waterline to a rim crest just outside
// the water disc, then blends back to the natural dune height at the radius.
// Because the crest is always above waterY, the flat water plane is fully
// enclosed even when the oasis sits on a slope — no edge-on view of the disc.
// Oases never overlap (MIN_SEPARATION > MAX_RADIUS), so a point is shaped by at
// most one of them.
function applyOasisCarving(x: number, z: number, h: number): number {
  ensureOasesResolved()
  let out = h
  for (const o of OASES) {
    const dx = x - o.x
    const dz = z - o.z
    const d2 = dx * dx + dz * dz
    if (d2 >= o.radius * o.radius) continue
    const u = Math.sqrt(d2) / o.radius // 0 at center, 1 at carve edge
    const ratio = o.waterRadius / o.radius // shoreline == visible disc edge
    const uCrest = Math.min(0.96, ratio + 0.1) // berm crest just past the shore
    const crestY = o.waterY + OASIS_RIM_LIP
    if (u <= ratio) {
      // Bowl floor → exactly waterY at the shoreline, so the flat disc fills
      // the basin precisely (water reaches the rendered edge, no buried ring).
      out = o.floorY + (o.waterY - o.floorY) * smooth(u / ratio)
    } else if (u <= uCrest) {
      // Shoreline → berm crest, just outside the water — encloses the surface.
      out = o.waterY + (crestY - o.waterY) * smooth((u - ratio) / (uCrest - ratio))
    } else {
      // Berm crest → natural terrain at the outer radius.
      out = crestY + (h - crestY) * smooth((u - uCrest) / (1 - uCrest))
    }
  }
  return out
}

function heightAt(x: number, z: number): number {
  return applyOasisCarving(x, z, baseHeight(x, z))
}

export function getTerrainHeight(worldX: number, worldZ: number): number {
  return heightAt(worldX, worldZ)
}

// Analytical surface normal via central differences on the height field.
// Eps is in world units — larger eps smooths out small ripples so the
// returned normal reflects the *dune slope*, not surface roughness.
export function getTerrainNormal(x: number, z: number, eps = 2): Vector3 {
  const hL = heightAt(x - eps, z)
  const hR = heightAt(x + eps, z)
  const hD = heightAt(x, z - eps)
  const hU = heightAt(x, z + eps)
  // Gradient (dh/dx, dh/dz) → surface normal is (-dh/dx, 1, -dh/dz).
  const n = new Vector3((hL - hR) / (2 * eps), 1, (hD - hU) / (2 * eps))
  return n.normalize()
}

export function generateHeightData(): Float32Array {
  const N = TERRAIN_SUBDIVISIONS
  const S = TERRAIN_SIZE
  const heights = new Float32Array((N + 1) * (N + 1))
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = (i / N - 0.5) * S
      const z = (j / N - 0.5) * S
      heights[i * (N + 1) + j] = heightAt(x, z)
    }
  }
  return heights
}