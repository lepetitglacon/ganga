import { Vector3 } from '@babylonjs/core'
import { applyPlaceFlattening } from './places.ts'
import { OASES } from './oasis.ts'

// Oasis carving tuning.
// Water surface sits OASIS_RIM_DEPTH below the surrounding sand (reads as a
// sunken pool), and the bowl floor is OASIS_POOL_DEPTH below the water surface.
// Kept shallow so a landed bird stands on the floor with its body roughly at
// the waterline — i.e. it wades rather than drowns.
const OASIS_RIM_DEPTH = 1.2
const OASIS_POOL_DEPTH = 1.6

export const TERRAIN_SIZE = 1600
export const TERRAIN_SUBDIVISIONS = 192

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
    o.waterY = h0 - OASIS_RIM_DEPTH
    o.floorY = o.waterY - OASIS_POOL_DEPTH
  }
}

// Carve a smooth bowl into the dunes at each oasis. t=1 at the center (terrain
// pulled down to floorY) blending to 0 at the carve radius. We only ever lower
// the terrain (min), so the bowl never raises a neighbouring dune.
function applyOasisCarving(x: number, z: number, h: number): number {
  ensureOasesResolved()
  let out = h
  for (const o of OASES) {
    const dx = x - o.x
    const dz = z - o.z
    const r2 = o.radius * o.radius
    const d2 = dx * dx + dz * dz
    if (d2 >= r2) continue
    const t = 1 - smooth(Math.sqrt(d2) / o.radius)
    const carved = h * (1 - t) + o.floorY * t
    if (carved < out) out = carved
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