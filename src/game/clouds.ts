import { Vector3 } from '@babylonjs/core'
import { getTerrainHeight } from './terrain.ts'

// A cloud is a cluster of billboard particles whose positions are carved out of
// a 3D noise field (so the silhouette billows like a cumulus). Each cloud owns
// a contiguous block of per-particle data; the renderer (Clouds.tsx) packs the
// blocks of the currently-near clouds into the front of a shared thin-instance
// buffer and draws the far ones as a single sprite (LOD).
export interface CloudSpawn {
  center: Vector3
  radius: number // horizontal radius — also the far-LOD sprite size basis
  count: number // number of particles
  // count*16 — identity matrices carrying each particle's ABSOLUTE world pos in
  // the translation column (the billboard shader expands the quad from there).
  matrices: Float32Array
  // count*4 — per particle: size, normHeight (0 bottom → 1 top), seed, _unused
  aData: Float32Array
  spriteSize: number // billboard size for the far LOD sprite
}

// Name of the offscreen orthographic camera that renders the cloud shadow map.
// Shared so PostProcess.tsx can skip attaching the SSAO pipeline to it (the
// pipeline's post-processes crash when finalized during the RTT render).
export const CLOUD_SUN_CAM_NAME = 'cloudSunCam'

// Clouds float high over the dunes like real cumulus. Purely visual — no
// collision — so they sit well above where the bird ever climbs.
const ALT_MIN = 175
const ALT_MAX = 385

// --- 3D value noise (cloud shaping, CPU side) ---
function hash3(x: number, y: number, z: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 1442695041
  h = (h ^ (h >> 13)) * 1274126177
  return ((h ^ (h >> 16)) >>> 0) / 4294967295
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}
function vnoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const u = smooth(xf)
  const v = smooth(yf)
  const w = smooth(zf)
  const c000 = hash3(xi, yi, zi)
  const c100 = hash3(xi + 1, yi, zi)
  const c010 = hash3(xi, yi + 1, zi)
  const c110 = hash3(xi + 1, yi + 1, zi)
  const c001 = hash3(xi, yi, zi + 1)
  const c101 = hash3(xi + 1, yi, zi + 1)
  const c011 = hash3(xi, yi + 1, zi + 1)
  const c111 = hash3(xi + 1, yi + 1, zi + 1)
  const x00 = c000 * (1 - u) + c100 * u
  const x10 = c010 * (1 - u) + c110 * u
  const x01 = c001 * (1 - u) + c101 * u
  const x11 = c011 * (1 - u) + c111 * u
  const y0 = x00 * (1 - v) + x10 * v
  const y1 = x01 * (1 - v) + x11 * v
  return y0 * (1 - w) + y1 * w
}
function fbm3(x: number, y: number, z: number): number {
  let amp = 0.6
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < 3; i++) {
    sum += amp * vnoise3(x * freq, y * freq, z * freq)
    norm += amp
    amp *= 0.5
    freq *= 2.03
  }
  return sum / norm
}

// Scatter `count` clouds across a disc of the given radius. Each cloud's
// particles are rejection-sampled inside a flattened ellipsoid where the noise
// density (biased to fall off toward the rim) clears a threshold.
export function makeRandomClouds(count: number, worldHalf: number): CloudSpawn[] {
  const clouds: CloudSpawn[] = []
  for (let i = 0; i < count; i++) {
    // Area-uniform spread over the disc.
    const ang = Math.random() * Math.PI * 2
    const rad = Math.sqrt(Math.random()) * worldHalf
    const cx = Math.cos(ang) * rad
    const cz = Math.sin(ang) * rad
    const terrainY = getTerrainHeight(cx, cz)
    const cy = terrainY + ALT_MIN + Math.random() * (ALT_MAX - ALT_MIN)

    const radius = 300 + Math.random() * 300 // horizontal reach — enormous cumulus
    const ry = radius * (0.42 + Math.random() * 0.18) // vertical half-extent (flatter)
    const target = Math.round(
      Math.min(6500, Math.max(2500, Math.pow(radius / 85, 2) * 1100)),
    )
    // Per-cloud noise offset so each cloud has its own lumps.
    const ox = Math.random() * 500
    const oy = Math.random() * 500
    const oz = Math.random() * 500

    const mats: number[] = []
    const datas: number[] = []
    let n = 0
    let attempts = 0
    const maxAttempts = target * 12
    while (n < target && attempts < maxAttempts) {
      attempts++
      const px = (Math.random() * 2 - 1) * radius
      const py = (Math.random() * 2 - 1) * ry
      const pz = (Math.random() * 2 - 1) * radius
      const ex = px / radius
      const ey = py / ry
      const ez = pz / radius
      const r2 = ex * ex + ey * ey + ez * ez
      if (r2 > 1) continue
      // Denser core, noisy rim: accept only where the noise beats a threshold
      // that climbs with distance from the centre.
      const dens = fbm3(px * 0.03 + ox, py * 0.05 + oy, pz * 0.03 + oz)
      if (dens < 0.3 + r2 * 0.45) continue

      const wx = cx + px
      const wy = cy + py
      const wz = cz + pz
      // Identity matrix, translation in the last column (column-major).
      mats.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, wx, wy, wz, 1)
      const size = radius * (0.14 + Math.random() * 0.12)
      const normH = (py / ry + 1) * 0.5
      datas.push(size, normH, Math.random(), 0)
      n++
    }

    if (n === 0) continue
    clouds.push({
      center: new Vector3(cx, cy, cz),
      radius,
      count: n,
      matrices: Float32Array.from(mats),
      aData: Float32Array.from(datas),
      spriteSize: radius * 2.1,
    })
  }
  return clouds
}
