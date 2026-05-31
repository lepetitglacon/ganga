import {
  Color3,
  DirectionalLight,
  HemisphericLight,
  Scene,
  ShadowGenerator,
  Vector3,
} from '@babylonjs/core'
import { SUN_DIR } from './world.ts'

// ---------------------------------------------------------------------------
// Centralized lighting + shadow config (parallel to fog.ts).
//
// Why shadows used to look smeared: a DirectionalLight auto-fits its shadow
// frustum to ALL casters in the scene. With a 3000 m terrain, the 2048² shadow
// map was stretched over the whole map (~1.5 m per texel) — soft, blocky edges.
// The fix is a small, fixed frustum that we recenter on the player every frame
// (aimShadowsAt), so the texels stay packed wherever the bird roams.
// ---------------------------------------------------------------------------

export const HEMI_LIGHT = {
  intensity: 0.6,
  // Warm sky bounce / cool ground bounce — Journey-ish ambient.
  diffuse: new Color3(1.0, 0.85, 0.65),
  groundColor: new Color3(0.45, 0.3, 0.22),
}

export const SUN_LIGHT = {
  intensity: 1.6,
  diffuse: new Color3(1.0, 0.88, 0.7),
  specular: new Color3(1.0, 0.9, 0.75),
}

export const SHADOWS = {
  // Shadow map resolution. 2048 is plenty once the frustum is tight.
  mapSize: 2048,
  // Full width/height (metres) of the square shadow area that tracks the
  // player. Smaller = sharper (more texels per metre) but a smaller shadowed
  // region. 120 m over 2048 texels ≈ 17 texels/m vs ~0.7 before.
  frustumSize: 120,
  // Near/far of the shadow camera along the sun direction.
  minZ: 1,
  maxZ: 1000,
  // How far up-sun the shadow camera sits from the player. Casters between the
  // camera and (cameraBackoff + ground spread) below it get shadowed; keep
  // cameraBackoff comfortably inside [minZ, maxZ].
  cameraBackoff: 600,
  // 0 = pitch-black shadow, 1 = invisible.
  darkness: 0.35,
  // PCF gives crisp, lightly anti-aliased edges (vs the old blurry exponential
  // map with blurKernel 16). Bump filteringQuality for softer edges.
  filteringQuality: ShadowGenerator.QUALITY_HIGH,
}

export function createHemiLight(scene: Scene): HemisphericLight {
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
  hemi.intensity = HEMI_LIGHT.intensity
  hemi.diffuse = HEMI_LIGHT.diffuse
  hemi.groundColor = HEMI_LIGHT.groundColor
  return hemi
}

export function createSun(scene: Scene): DirectionalLight {
  // Directional light points -SUN_DIR (from the sun down toward the ground);
  // direction must match the sky shader / world.ts SUN_DIR.
  const sun = new DirectionalLight('sun', SUN_DIR.scale(-1), scene)
  sun.intensity = SUN_LIGHT.intensity
  sun.diffuse = SUN_LIGHT.diffuse
  sun.specular = SUN_LIGHT.specular
  // Fixed, tight frustum (shadowFrustumSize > 0 selects the fixed-frustum path)
  // that we recenter on the player each frame via aimShadowsAt.
  sun.autoUpdateExtends = false
  sun.shadowFrustumSize = SHADOWS.frustumSize
  sun.shadowMinZ = SHADOWS.minZ
  sun.shadowMaxZ = SHADOWS.maxZ
  // Sensible initial spot until the bird exists.
  sun.position = SUN_DIR.scale(SHADOWS.cameraBackoff)
  return sun
}

export function createShadowGenerator(sun: DirectionalLight): ShadowGenerator {
  const shadows = new ShadowGenerator(SHADOWS.mapSize, sun)
  shadows.usePercentageCloserFiltering = true
  shadows.filteringQuality = SHADOWS.filteringQuality
  shadows.setDarkness(SHADOWS.darkness)
  return shadows
}

// Recenter the shadow frustum on a world position (the player). The shadow
// camera sits cameraBackoff metres up-sun from the target, looking down -SUN_DIR,
// so casters around the player fall inside [minZ, maxZ].
const _backoff = new Vector3()
export function aimShadowsAt(sun: DirectionalLight, target: Vector3) {
  SUN_DIR.scaleToRef(SHADOWS.cameraBackoff, _backoff)
  sun.position.copyFrom(target).addInPlace(_backoff)
}
