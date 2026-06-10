import { Color3, Scene } from '@babylonjs/core'
import { HORIZON_COLOR } from './world.ts'

// ---------------------------------------------------------------------------
// Single source of truth for scene fog.
//
// The sky shader's horizon band IS the fog color, and every custom shader
// (Water, Clouds, Storm, oasisWaterMaterial) mirrors scene.fogColor /
// scene.fogDensity each frame — so writing scene.fog* HERE is enough to keep
// the whole world consistent. Nothing else should touch scene.fog* directly:
// Environment installs the baseline (attach) and drives the per-frame storm
// boost (setStormProximity); everyone else only reads.
//
// We stay on FOGMODE_EXP2 (not LINEAR) because those custom shaders replicate
// the EXP2 formula `factor = 1 - exp(-(density·dist)²)` by hand. Switching the
// scene to LINEAR would silently desync every one of them.
// ---------------------------------------------------------------------------

export const FOG = {
  color: HORIZON_COLOR,
  // Clear-weather haze. Higher = denser/closer fog.
  // 0.0042 ≈ visibilityForDensity(0.0042) ≈ 410 m before the world is ~95% hazed.
  baseDensity: 0.0042,
  // Extra density blended in at full storm-wall proximity (prox = 1).
  // At prox = 1 the density reaches 0.0042 + 0.018 = 0.0222 (~78 m visibility).
  stormDensityBoost: 0.018,
}

// EXP2 has a single knob (density), but you usually think in distances. These
// convert between "things fully dissolve at ~D metres" and the EXP2 density at
// which fog reaches ~95% at distance D. Handy when tuning by sight.
//   sqrt(3) because 1 - exp(-(d·D)²) = 0.95  ⇒  (d·D)² = ln(20) ≈ 3.
export const densityForVisibility = (metres: number) => Math.sqrt(3) / metres
export const visibilityForDensity = (density: number) => Math.sqrt(3) / density

let scene: Scene | null = null
let stormProximity = 0

export const fog = {
  /** Install the baseline. Call once when the scene is ready (Environment). */
  attach(s: Scene) {
    scene = s
    s.fogMode = Scene.FOGMODE_EXP2
    s.fogColor = FOG.color
    this.apply()
  },

  /** Restore no-fog and detach. Call from the Environment cleanup. */
  detach() {
    if (scene) scene.fogMode = Scene.FOGMODE_NONE
    scene = null
    stormProximity = 0
  },

  /**
   * Storm-wall proximity, 0 (clear) … 1 (dead centre of a wall). Drives the
   * localized fog boost. Environment pushes gameStore.stormProximity here each
   * frame, so this is the ONLY place storms affect fog.
   */
  setStormProximity(prox: number) {
    stormProximity = prox
    this.apply()
  },

  /** Change the clear-weather baseline at runtime (e.g. debug panel). */
  setBaseDensity(d: number) {
    FOG.baseDensity = d
    this.apply()
  },

  /**
   * Set the fog color (also the sky-horizon band). Used by BiomeController to
   * lerp the haze tint as the bird crosses biomes. The custom shaders mirror
   * scene.fogColor each frame, so writing it here propagates everywhere.
   */
  setColor(c: Color3) {
    FOG.color = c
    if (scene) scene.fogColor = c
  },

  /** Recompute scene.fogDensity from the baseline + current storm proximity. */
  apply() {
    if (scene) scene.fogDensity = FOG.baseDensity + stormProximity * FOG.stormDensityBoost
  },
}
