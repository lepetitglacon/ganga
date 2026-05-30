import { getTerrainHeight } from './terrain.ts'

// ---------------------------------------------------------------------------
// Procedural "Colorado" rock massifs.
//
// The base terrain is a heightfield: one height per (x, z) column, so it can
// never describe an overhang or a roof. This module adds the OPPOSITE kind of
// geometry — fully volumetric rock masses defined by a signed density field
// `solidAt()` (> 0 = rock, < 0 = air) and meshed with Surface Nets into a
// triangle soup. That mesh is rendered on top of the sand AND registered as a
// static trimesh collider, so the player can walk through open-top slot canyons
// (carved as vertical sheets) and real tunnels with rock above their head
// (carved as 3D tubes).
//
// Several seeded massifs are arranged in a ring around the map, forming a giant
// surrounding mountain range. Each one is generated in its own sampling box and
// concatenated into one mesh. Everything is world space, so the positions feed
// both Babylon and Rapier with no transform.
// ---------------------------------------------------------------------------

// Voxel edge length (m). Smaller = narrower carveable caves but cubic cost.
const CELL = 5
// Vertical sampling band, relative to the local sand height. Must reach below
// the sand (closed base) and above the tallest peak (air top).
const Y_BELOW = 60
const Y_ABOVE = 150

// Seed for the whole range layout (sizes, carving). Change to reshuffle.
const RANGE_SEED = 0x1ce_b00c

// mulberry32 — small seeded PRNG.
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

// ---- carving primitives ----------------------------------------------------

// A meandering slot canyon, in the massif's LOCAL frame (origin at its centre).
// Distance to the curve is approximated by the gap to the centreline, exact
// enough for a graph-like (non-overhanging) path. `flare` widens it upward for
// the classic Antelope funnel cross-section.
type SlotCanyon = {
  axis: 'z' | 'x'
  base: number
  amp: number
  freq: number
  phase: number
  halfWidth: number
  flare: number
}

// A tube boring through the rock → a tunnel with rock left above it (a real
// cave roof). `hAbove` is the tunnel centre height above the local sand.
type Tube = {
  axis: 'z' | 'x'
  cross: number
  hAbove: number
  amp: number
  freq: number
  phase: number
  radius: number
}

type Massif = {
  cx: number
  cz: number
  halfX: number
  halfZ: number
  peak: number
  // Per-massif noise offset so no two look alike.
  noiseOffX: number
  noiseOffZ: number
  slots: SlotCanyon[]
  tubes: Tube[]
}

// Build a varied set of canyons/tunnels for one massif from its own rng.
function makeMassif(cx: number, cz: number, rng: () => number): Massif {
  const halfX = 200 + rng() * 90
  const halfZ = 200 + rng() * 90
  const peak = 110 + rng() * 60
  const slots: SlotCanyon[] = []
  const nSlots = 2 + Math.floor(rng() * 2) // 2-3
  for (let i = 0; i < nSlots; i++) {
    const axis = rng() < 0.5 ? 'z' : 'x'
    const span = axis === 'z' ? halfX : halfZ
    slots.push({
      axis,
      base: (rng() * 2 - 1) * span * 0.6,
      amp: 40 + rng() * 45,
      freq: 0.008 + rng() * 0.006,
      phase: rng() * Math.PI * 2,
      halfWidth: 6 + rng() * 3,
      flare: 0.04 + rng() * 0.04,
    })
  }
  const tubes: Tube[] = []
  const nTubes = 1 + Math.floor(rng() * 2) // 1-2
  for (let i = 0; i < nTubes; i++) {
    const axis = rng() < 0.5 ? 'z' : 'x'
    const span = axis === 'z' ? halfX : halfZ
    tubes.push({
      axis,
      cross: (rng() * 2 - 1) * span * 0.5,
      hAbove: 6 + rng() * 22,
      amp: 10 + rng() * 14,
      freq: 0.009 + rng() * 0.006,
      phase: rng() * Math.PI * 2,
      radius: 5 + rng() * 2.5,
    })
  }
  return {
    cx,
    cz,
    halfX,
    halfZ,
    peak,
    noiseOffX: rng() * 1000,
    noiseOffZ: rng() * 1000,
    slots,
    tubes,
  }
}

// Ring of massifs around the map centre, nearly touching so they read as a
// continuous range. Leaves the central play area clear.
function buildRange(): Massif[] {
  const rng = mulberry32(RANGE_SEED)
  const out: Massif[] = []
  const count = 12
  const ringRadius = 980
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    // Jitter each centre a little so the ring isn't a perfect circle.
    const r = ringRadius + (rng() * 2 - 1) * 70
    const cx = Math.cos(a) * r + (rng() * 2 - 1) * 40
    const cz = Math.sin(a) * r + (rng() * 2 - 1) * 40
    out.push(makeMassif(cx, cz, rng))
  }
  return out
}

// ---- noise -----------------------------------------------------------------

function hash2(x: number, y: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263
  h = (h ^ (h >> 13)) * 1274126177
  return ((h ^ (h >> 16)) >>> 0) / 4294967295
}

function hash3(x: number, y: number, z: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647
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

function valueNoise2(x: number, y: number): number {
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
  return v00 * (1 - u) * (1 - v) + v10 * u * (1 - v) + v01 * (1 - u) * v + v11 * u * v
}

function valueNoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const u = smooth(xf)
  const v = smooth(yf)
  const w = smooth(zf)
  const c = (a: number, b: number, cc: number) => hash3(xi + a, yi + b, zi + cc)
  const x00 = c(0, 0, 0) * (1 - u) + c(1, 0, 0) * u
  const x10 = c(0, 1, 0) * (1 - u) + c(1, 1, 0) * u
  const x01 = c(0, 0, 1) * (1 - u) + c(1, 0, 1) * u
  const x11 = c(0, 1, 1) * (1 - u) + c(1, 1, 1) * u
  const y0 = x00 * (1 - v) + x10 * v
  const y1 = x01 * (1 - v) + x11 * v
  return y0 * (1 - w) + y1 * w
}

function fbm2(x: number, y: number, octaves: number, gain: number): number {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, y * freq)
    norm += amp
    amp *= gain
    freq *= 2
  }
  return sum / norm
}

function fbm3(x: number, y: number, z: number, octaves: number, gain: number): number {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(x * freq, y * freq, z * freq)
    norm += amp
    amp *= gain
    freq *= 2
  }
  return sum / norm
}

// ---- density field (one massif) --------------------------------------------

// Top of the bare massif at local (lx, lz): sand height + a ridged mound that
// fades to zero before the box edge, so the rock is a closed island.
// Returns the rock top height, or a value far below the sampling box (→ pure
// air, no rock at all) outside the island. Crucially it must NOT return a value
// near the sand outside the mound, or the box margins fill with a buried slab
// that the detail noise then pokes through the sand across the whole map.
const NO_ROCK = -1e6
function massifTop(m: Massif, lx: number, lz: number, sandY: number): number {
  const nx = lx / m.halfX
  const nz = lz / m.halfZ
  const r = Math.sqrt(nx * nx + nz * nz)
  const falloff = smoothstep(0.9, 0.35, r)
  if (falloff <= 0) return NO_ROCK
  const n = fbm2(
    (lx + m.noiseOffX) * 0.006,
    (lz + m.noiseOffZ) * 0.006,
    5,
    0.55,
  )
  const ridged = 1 - Math.abs(n * 2 - 1)
  const mound = (0.35 + 0.65 * ridged) * falloff
  return sandY + m.peak * mound
}

function slotDist(lx: number, lz: number, s: SlotCanyon): number {
  if (s.axis === 'z') {
    const center = s.base + s.amp * Math.sin(lz * s.freq + s.phase)
    return Math.abs(lx - center)
  }
  const center = s.base + s.amp * Math.sin(lx * s.freq + s.phase)
  return Math.abs(lz - center)
}

function tubeDist(lx: number, y: number, lz: number, sandY: number, t: Tube): number {
  const ty = sandY + t.hAbove
  if (t.axis === 'x') {
    const cz = t.cross + t.amp * Math.sin(lx * t.freq + t.phase)
    return Math.hypot(lz - cz, y - ty)
  }
  const cx = t.cross + t.amp * Math.sin(lz * t.freq + t.phase)
  return Math.hypot(lx - cx, y - ty)
}

// Signed density for one massif: > 0 inside rock, < 0 air.
function solidAt(m: Massif, x: number, y: number, z: number, sandY: number): number {
  const lx = x - m.cx
  const lz = z - m.cz
  let d = massifTop(m, lx, lz, sandY) - y

  const above = Math.max(0, y - sandY)
  for (const s of m.slots) {
    const hw = s.halfWidth + above * s.flare
    const carve = slotDist(lx, lz, s) - hw
    if (carve < d) d = carve
  }
  for (const t of m.tubes) {
    const carve = tubeDist(lx, y, lz, sandY, t) - t.radius
    if (carve < d) d = carve
  }

  // Skip surface detail far from the isosurface — it only matters near d≈0,
  // and outside the island d is hugely negative (NO_ROCK), so leave it air.
  if (d > -40 && d < 40) {
    d += (fbm3(x * 0.05, y * 0.05, z * 0.05, 3, 0.5) - 0.5) * 5
  }
  return d
}

// ---- Surface Nets mesher ---------------------------------------------------

const CORNER = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
]
const EDGE: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
]

export type RockMesh = {
  positions: Float32Array
  indices: Uint32Array
  colors: Float32Array
}

// Mesh one massif and append its geometry to the running arrays.
function meshMassif(
  m: Massif,
  positions: number[],
  indices: number[],
  // Per-vertex baked data, pushed in lockstep with positions: cavity occlusion
  // 0..1 (1 = deep in rock) and the outward normal's Y (1 = flat top, 0 = wall).
  occOut: number[],
  nyOut: number[],
): void {
  const minX = m.cx - m.halfX
  const minZ = m.cz - m.halfZ
  const sx = Math.round((m.halfX * 2) / CELL) + 1
  const sz = Math.round((m.halfZ * 2) / CELL) + 1

  // Local vertical band: cover sand-Y_BELOW .. peak+headroom for this massif.
  const yMin = getTerrainHeight(m.cx, m.cz) - Y_BELOW
  const yMax = getTerrainHeight(m.cx, m.cz) + m.peak + Y_ABOVE
  const sy = Math.round((yMax - yMin) / CELL) + 1

  // Precompute sand height per column (solidAt is called for every Y there).
  const sand = new Float32Array(sx * sz)
  for (let iz = 0; iz < sz; iz++) {
    const z = minZ + iz * CELL
    for (let ix = 0; ix < sx; ix++) {
      sand[ix + sx * iz] = getTerrainHeight(minX + ix * CELL, z)
    }
  }

  const field = new Float32Array(sx * sy * sz)
  for (let iz = 0; iz < sz; iz++) {
    const z = minZ + iz * CELL
    for (let iy = 0; iy < sy; iy++) {
      const y = yMin + iy * CELL
      for (let ix = 0; ix < sx; ix++) {
        field[ix + sx * (iy + sy * iz)] = solidAt(
          m,
          minX + ix * CELL,
          y,
          z,
          sand[ix + sx * iz],
        )
      }
    }
  }

  const cx = sx - 1
  const cy = sy - 1
  const cz = sz - 1
  const fIdx = (ix: number, iy: number, iz: number) => ix + sx * (iy + sy * iz)
  const cIdx = (ix: number, iy: number, iz: number) => ix + cx * (iy + cy * iz)

  const cellVert = new Int32Array(cx * cy * cz).fill(-1)
  const cv: number[] = [0, 0, 0, 0, 0, 0, 0, 0]

  for (let iz = 0; iz < cz; iz++) {
    for (let iy = 0; iy < cy; iy++) {
      for (let ix = 0; ix < cx; ix++) {
        let mask = 0
        for (let c = 0; c < 8; c++) {
          const v = field[fIdx(ix + CORNER[c][0], iy + CORNER[c][1], iz + CORNER[c][2])]
          cv[c] = v
          if (v < 0) mask |= 1 << c
        }
        if (mask === 0 || mask === 0xff) continue

        let px = 0
        let py = 0
        let pz = 0
        let count = 0
        for (const [a, b] of EDGE) {
          const va = cv[a]
          const vb = cv[b]
          if (va < 0 === vb < 0) continue
          const t = va / (va - vb)
          px += CORNER[a][0] + t * (CORNER[b][0] - CORNER[a][0])
          py += CORNER[a][1] + t * (CORNER[b][1] - CORNER[a][1])
          pz += CORNER[a][2] + t * (CORNER[b][2] - CORNER[a][2])
          count++
        }
        const inv = 1 / count
        cellVert[cIdx(ix, iy, iz)] = positions.length / 3
        positions.push(
          minX + (ix + px * inv) * CELL,
          yMin + (iy + py * inv) * CELL,
          minZ + (iz + pz * inv) * CELL,
        )

        // Baked cavity AO: fraction of a 5³ field neighbourhood that is solid
        // (field > 0). A flat exposed wall is ~half solid; a crevice/canyon
        // floor is mostly enclosed → higher. Reaches ~2 cells (10 m) so it
        // reads canyon depth, not just micro-contacts. View-independent, so no
        // screen-space artifact like SSAO.
        let solidCount = 0
        let total = 0
        for (let oz = -2; oz <= 2; oz++) {
          const zz = iz + oz
          if (zz < 0 || zz >= sz) continue
          for (let oy = -2; oy <= 2; oy++) {
            const yy = iy + oy
            if (yy < 0 || yy >= sy) continue
            for (let ox = -2; ox <= 2; ox++) {
              const xx = ix + ox
              if (xx < 0 || xx >= sx) continue
              total++
              if (field[fIdx(xx, yy, zz)] > 0) solidCount++
            }
          }
        }
        occOut.push(total > 0 ? solidCount / total : 0)

        // Outward normal via the field gradient (inside is field > 0, so the
        // surface normal points down-gradient). Only Y is needed, for slope tint.
        const xp = Math.min(ix + 1, sx - 1)
        const xm = Math.max(ix - 1, 0)
        const yp = Math.min(iy + 1, sy - 1)
        const ym = Math.max(iy - 1, 0)
        const zp = Math.min(iz + 1, sz - 1)
        const zm = Math.max(iz - 1, 0)
        const gx = field[fIdx(xp, iy, iz)] - field[fIdx(xm, iy, iz)]
        const gy = field[fIdx(ix, yp, iz)] - field[fIdx(ix, ym, iz)]
        const gz = field[fIdx(ix, iy, zp)] - field[fIdx(ix, iy, zm)]
        const glen = Math.hypot(gx, gy, gz) || 1
        nyOut.push(-gy / glen)
      }
    }
  }

  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) {
      indices.push(a, c, b, a, d, c)
    } else {
      indices.push(a, b, c, a, c, d)
    }
  }

  for (let iz = 0; iz < sz; iz++) {
    for (let iy = 0; iy < sy; iy++) {
      for (let ix = 0; ix < sx; ix++) {
        const v0 = field[fIdx(ix, iy, iz)]
        if (ix < sx - 1 && iy >= 1 && iz >= 1) {
          const v1 = field[fIdx(ix + 1, iy, iz)]
          if (v0 < 0 !== v1 < 0) {
            quad(
              cellVert[cIdx(ix, iy - 1, iz - 1)],
              cellVert[cIdx(ix, iy, iz - 1)],
              cellVert[cIdx(ix, iy, iz)],
              cellVert[cIdx(ix, iy - 1, iz)],
              v0 < 0,
            )
          }
        }
        if (iy < sy - 1 && ix >= 1 && iz >= 1) {
          const v1 = field[fIdx(ix, iy + 1, iz)]
          if (v0 < 0 !== v1 < 0) {
            quad(
              cellVert[cIdx(ix - 1, iy, iz - 1)],
              cellVert[cIdx(ix, iy, iz - 1)],
              cellVert[cIdx(ix, iy, iz)],
              cellVert[cIdx(ix - 1, iy, iz)],
              v0 >= 0,
            )
          }
        }
        if (iz < sz - 1 && ix >= 1 && iy >= 1) {
          const v1 = field[fIdx(ix, iy, iz + 1)]
          if (v0 < 0 !== v1 < 0) {
            quad(
              cellVert[cIdx(ix - 1, iy - 1, iz)],
              cellVert[cIdx(ix, iy - 1, iz)],
              cellVert[cIdx(ix, iy, iz)],
              cellVert[cIdx(ix - 1, iy, iz)],
              v0 < 0,
            )
          }
        }
      }
    }
  }
}

let cached: RockMesh | null = null

export function generateRockMesh(): RockMesh {
  if (cached) return cached

  const positions: number[] = []
  const indices: number[] = []
  const occ: number[] = []
  const ny: number[] = []
  for (const m of buildRange()) {
    meshMassif(m, positions, indices, occ, ny)
  }

  // Build per-vertex albedo: ochre wall → lighter sandy caprock on flat tops,
  // multiplied by baked cavity AO so canyons/crevices darken with depth. This
  // replaces the screen-space SSAO look with view-stable shading that still
  // reacts to the sun via the mesh normals.
  const colors = new Float32Array((positions.length / 3) * 4)
  for (let v = 0, c = 0; v < occ.length; v++, c += 4) {
    const topness = Math.max(0, Math.min(1, ny[v])) // 0 wall .. 1 flat top
    const ao = 1 - smoothstep(0.5, 0.9, occ[v]) * 0.65 // 1 exposed .. 0.35 deep
    const r = (0.78 + (0.9 - 0.78) * topness) * ao
    const g = (0.5 + (0.71 - 0.5) * topness) * ao
    const b = (0.29 + (0.47 - 0.29) * topness) * ao
    colors[c] = r
    colors[c + 1] = g
    colors[c + 2] = b
    colors[c + 3] = 1
  }

  cached = {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    colors,
  }
  return cached
}
