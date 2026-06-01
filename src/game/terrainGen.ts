// Babylon-free procedural terrain generation.
//
// This module holds every pure, deterministic numeric routine that builds the
// desert: the dune height field, oasis carving, and the full terrain vertex
// data. It imports NOTHING from @babylonjs/core so it can run unchanged inside
// a web worker (see src/workers/mapgen.worker.ts). The Babylon glue
// (materials, Vector3 normals) lives in terrain.ts, which re-exports from here.
//
// Place flattening depends on radii that are only known once the place GLBs are
// loaded (resolved in Map.tsx). Rather than import the live PLACES array (which
// would drag Vector3 in and, in a worker, would not see the runtime-resolved
// radii), the flattening operates on a plain list injected via
// setFlattenPlaces() — called both on the main thread and, with the same
// payload, inside the worker. This keeps the main-thread height queries and the
// worker-built mesh/heightfield byte-for-byte identical.

import { OASES } from './oasis.ts'

// Extended from 1600/192 to 3000/360: the cell size (S/N = 8.33 m) is kept
// identical, so every sample over the original central area lands on the exact
// same world position and the existing terrain is unchanged — the larger grid
// only adds desert further out, big enough to host the ring of rock massifs
// (rocks.ts) that surrounds the map.
export const TERRAIN_SIZE = 3000
export const TERRAIN_SUBDIVISIONS = 360

// --- Place flattening -------------------------------------------------------

// The subset of a Place that matters for height flattening. Plain numbers only,
// so it can be structured-cloned into a worker.
export type FlattenPlace = {
  x: number
  z: number
  radius: number
  flatRadius: number
  groundY: number
}

let flattenPlaces: FlattenPlace[] = []

// Install the resolved place footprints used by the flattening. Resets the
// lazy oasis resolution so water levels are recomputed against the new terrain.
export function setFlattenPlaces(places: FlattenPlace[]): void {
  flattenPlaces = places
  oasesResolved = false
}

// Returns the flattened height at (x, z), or the input procedural height if no
// place influences this point. Inside flatRadius the terrain is fully flattened
// to groundY; between flatRadius and radius it blends back to the dune height.
function applyPlaceFlattening(x: number, z: number, h: number): number {
  let out = h
  for (const p of flattenPlaces) {
    const dx = x - p.x
    const dz = z - p.z
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d >= p.radius) continue
    const t = 1 - smoothstep(p.flatRadius, p.radius, d)
    out = out * (1 - t) + p.groundY * t
  }
  return out
}

// --- noise ------------------------------------------------------------------

// Cheap hash-based pseudo-random in [0..1)
function hash2(x: number, y: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263
  h = (h ^ (h >> 13)) * 1274126177
  return ((h ^ (h >> 16)) >>> 0) / 4294967295
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
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

// --- oasis carving ----------------------------------------------------------

// How far the carved rim crest sits ABOVE the water surface. The bowl always
// rises past the waterline just outside the water disc, so the flat surface is
// enclosed on every side (no edge-on view of the plane), even on a slope.
const OASIS_RIM_LIP = 0.9

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

// Surface gradient via central differences on the height field, returned as raw
// components so this stays Babylon-free. terrain.ts wraps it into a Vector3.
// Eps is in world units — larger eps smooths out small ripples so the returned
// normal reflects the *dune slope*, not surface roughness.
export function getTerrainNormalComponents(
  x: number,
  z: number,
  eps = 2,
): { x: number; y: number; z: number } {
  const hL = heightAt(x - eps, z)
  const hR = heightAt(x + eps, z)
  const hD = heightAt(x, z - eps)
  const hU = heightAt(x, z + eps)
  // Gradient (dh/dx, dh/dz) → surface normal is (-dh/dx, 1, -dh/dz).
  const nx = (hL - hR) / (2 * eps)
  const nz = (hD - hU) / (2 * eps)
  const len = Math.hypot(nx, 1, nz) || 1
  return { x: nx / len, y: 1 / len, z: nz / len }
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

// --- full terrain vertex data (worker-built) --------------------------------

// Wet-sand vertex tint: a per-channel multiplier applied to the dry sand color
// where the ground is damp. Darker AND browner than dry sand (blue/green pulled
// down more than red) so the ring around each pool reads as wet earth, not just
// shadow. The wet-footprint decals in Player.tsx use the matching damp brown.
const WET_SAND_TINT = { r: 0.6, g: 0.42, b: 0.3 }
function sandWetness(x: number, z: number): number {
  let wet = 0
  for (const o of OASES) {
    const d = Math.hypot(x - o.x, z - o.z)
    const outer = Math.min(o.radius, o.waterRadius + 9)
    // 1 inside the water disc, fading to 0 at the outer damp edge.
    const w = 1 - Math.min(1, Math.max(0, (d - o.waterRadius) / (outer - o.waterRadius)))
    if (w > wet) wet = w
  }
  return wet
}

// Per-vertex normals, replicating Babylon's VertexData.ComputeNormals exactly so
// the worker-built mesh shades identically to a main-thread build: each face
// normal is p1p2 × p3p2 with p1p2 = v0−v1, p3p2 = v2−v1, NORMALIZED to unit
// length (equal weight per face), accumulated onto its three vertices, then
// normalized per vertex. The winding (and thus the sign) must match, otherwise
// lighting is inverted. Pure, so the worker needs no Babylon to finish the mesh.
export function computeNormals(
  positions: Float32Array,
  indices: Uint32Array,
): Float32Array {
  const normals = new Float32Array(positions.length)
  for (let t = 0; t < indices.length; t += 3) {
    const v1 = indices[t] * 3
    const v2 = indices[t + 1] * 3
    const v3 = indices[t + 2] * 3
    const p1p2x = positions[v1] - positions[v2]
    const p1p2y = positions[v1 + 1] - positions[v2 + 1]
    const p1p2z = positions[v1 + 2] - positions[v2 + 2]
    const p3p2x = positions[v3] - positions[v2]
    const p3p2y = positions[v3 + 1] - positions[v2 + 1]
    const p3p2z = positions[v3 + 2] - positions[v2 + 2]
    let nx = p1p2y * p3p2z - p1p2z * p3p2y
    let ny = p1p2z * p3p2x - p1p2x * p3p2z
    let nz = p1p2x * p3p2y - p1p2y * p3p2x
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    nx /= l; ny /= l; nz /= l
    normals[v1] += nx; normals[v1 + 1] += ny; normals[v1 + 2] += nz
    normals[v2] += nx; normals[v2 + 1] += ny; normals[v2 + 2] += nz
    normals[v3] += nx; normals[v3 + 1] += ny; normals[v3 + 2] += nz
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.sqrt(
      normals[i] * normals[i] +
        normals[i + 1] * normals[i + 1] +
        normals[i + 2] * normals[i + 2],
    ) || 1
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l
  }
  return normals
}

export type TerrainData = {
  heights: Float32Array
  positions: Float32Array
  indices: Uint32Array
  normals: Float32Array
  uvs: Float32Array
  colors: Float32Array
}

// Build the entire terrain mesh payload: the heightfield (also fed to physics)
// plus the renderable vertex buffers. Returns typed arrays so the whole thing
// can be transferred out of a worker with zero copy.
export function generateTerrainData(): TerrainData {
  const N = TERRAIN_SUBDIVISIONS
  const S = TERRAIN_SIZE
  const cols = N + 1
  const vertCount = cols * cols

  const heights = new Float32Array(vertCount)
  const positions = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const colors = new Float32Array(vertCount * 4)
  const indices = new Uint32Array(N * N * 6)

  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = (i / N - 0.5) * S
      const z = (j / N - 0.5) * S
      const y = heightAt(x, z)
      const k = i * cols + j
      heights[k] = y
      const p = k * 3
      positions[p] = x
      positions[p + 1] = y
      positions[p + 2] = z
      const u = k * 2
      uvs[u] = (i / N) * 12
      uvs[u + 1] = (j / N) * 12
      // Vertex color multiplies the sand diffuse; tint toward damp brown.
      const w = sandWetness(x, z)
      const c = k * 4
      colors[c] = 1 - w * (1 - WET_SAND_TINT.r)
      colors[c + 1] = 1 - w * (1 - WET_SAND_TINT.g)
      colors[c + 2] = 1 - w * (1 - WET_SAND_TINT.b)
      colors[c + 3] = 1
    }
  }

  let t = 0
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * cols + j
      const b = a + 1
      const cc = (i + 1) * cols + j
      const d = cc + 1
      indices[t++] = a; indices[t++] = cc; indices[t++] = b
      indices[t++] = b; indices[t++] = cc; indices[t++] = d
    }
  }

  const normals = computeNormals(positions, indices)
  return { heights, positions, indices, normals, uvs, colors }
}
