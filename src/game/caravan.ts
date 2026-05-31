import { Vector3 } from '@babylonjs/core'

// A merchant camel caravan that walks a fixed loop across the desert, following
// the dune surface. All tunables live here; Caravan.tsx does the loading,
// per-frame placement and the moving hitbox.
//
// The trail is a closed polyline of world XZ waypoints. Camels advance along it
// at CARAVAN_SPEED and wrap around at the end, so the train walks forever. Each
// camel trails the one ahead by CAMEL_SPACING metres of arc length. Only the XZ
// route lives here — the ground height and the tilt to the slope are resolved
// from the terrain every frame in the component.

// GLB lives in /public/gltf/animals/, same as the static animals.
export const CAMEL_FILE = 'camel.glb'

// Imported camel is normalized to this height (world units), matching the scale
// convention in animals.ts (elephant = 25). Sits between the tiger (9) and the
// hippopotamus (14) — a touch taller for the hump.
export const CAMEL_TARGET_HEIGHT = 15

// How many camels in the train. The first one is the merchant's lead camel and
// carries the collision hitbox.
export const CARAVAN_COUNT = 6

// Walking speed along the trail (m/s) and the gap between two consecutive
// camels (arc-length metres). Spacing must exceed a camel's body length so they
// don't visually overlap.
export const CARAVAN_SPEED = 3
export const CAMEL_SPACING = 24

// Yaw offset (radians) so the model's nose points forward along the trail. Flip
// to Math.PI if the camels end up walking backwards.
export const CAMEL_HEADING_OFFSET = 0

// Half-extents (world units) of the lead camel's kinematic collision box — the
// "merchant" hitbox the flying bird bumps into. Roughly wraps one camel body
// (wide on Z = body length, tall enough to clear the hump).
export const LEAD_HITBOX_HALF = new Vector3(5, 8, 12)

// Closed loop of world XZ waypoints (Y is ignored — resolved per frame from the
// terrain). Routed through open desert, clear of the spawn (origin), the
// village (200,-150) and the source (-180,150). Edit these to move the trail;
// it auto-closes (the last point links back to the first). Note: the loop may
// clip a procedurally-placed oasis — nudge a waypoint if a camel wades through
// water.
export const CARAVAN_PATH: Vector3[] = [
  new Vector3(-600, 0, -200),
  new Vector3(-300, 0, -450),
  new Vector3(150, 0, -500),
  new Vector3(550, 0, -300),
  new Vector3(620, 0, 100),
  new Vector3(350, 0, 420),
  new Vector3(-100, 0, 500),
  new Vector3(-520, 0, 320),
]

// --- Arc-length parametrization of the closed path (XZ only) ---
// Precompute each segment's start, direction and cumulative length so a
// distance `s` maps to a point + heading. The path is closed: the segment after
// the last waypoint returns to the first.
type Seg = {
  ax: number
  az: number
  dx: number
  dz: number
  len: number
  acc: number // cumulative length at the segment START
}

function buildSegments(path: Vector3[]): { segs: Seg[]; total: number } {
  const segs: Seg[] = []
  let acc = 0
  for (let i = 0; i < path.length; i++) {
    const a = path[i]
    const b = path[(i + 1) % path.length]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    segs.push({ ax: a.x, az: a.z, dx, dz, len, acc })
    acc += len
  }
  return { segs, total: acc }
}

const { segs: SEGMENTS, total: PATH_LENGTH } = buildSegments(CARAVAN_PATH)
export { PATH_LENGTH }

// Sample the closed trail at arc-length `s` (wrapped into [0, PATH_LENGTH)).
// Writes the XZ position into `outPos` and the unit heading into `outDir`
// (both with y = 0). Reuses the caller's vectors — no per-call allocation.
export function samplePath(s: number, outPos: Vector3, outDir: Vector3): void {
  let d = s % PATH_LENGTH
  if (d < 0) d += PATH_LENGTH
  // Few segments → a linear scan is cheaper than anything fancier.
  let seg = SEGMENTS[SEGMENTS.length - 1]
  for (const sgm of SEGMENTS) {
    if (d < sgm.acc + sgm.len) {
      seg = sgm
      break
    }
  }
  const inv = seg.len > 1e-6 ? 1 / seg.len : 0
  const t = (d - seg.acc) * inv
  outPos.x = seg.ax + seg.dx * t
  outPos.y = 0
  outPos.z = seg.az + seg.dz * t
  outDir.x = seg.dx * inv
  outDir.y = 0
  outDir.z = seg.dz * inv
}
