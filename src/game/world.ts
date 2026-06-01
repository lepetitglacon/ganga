import { Color3, Vector3 } from '@babylonjs/core'

// Direction *toward* the sun (unit vector). Must match the sky shader and
// LightSetup — the directional light points -SUN_DIR from its position.
//
// The sun sits due NORTH (+Z) so it doubles as a fixed compass for the player:
// X = 0 keeps the azimuth purely +Z, Y sets the elevation above the horizon.
// Everything visual (sky disk, directional light, shadows, water specular)
// derives from this single vector, so they all stay coherent if you tweak it.
export const SUN_DIR = new Vector3(0, 2, 1).normalize()

// Shared palette — the sky shader's horizonColor IS the fog color, so the
// terrain edge dissolves seamlessly into the sky at the horizon line.
export const HORIZON_COLOR = new Color3(0.90, 0.74, 0.50)
export const ZENITH_COLOR = new Color3(0.92, 0.55, 0.35)
export const GROUND_COLOR = new Color3(0.86, 0.70, 0.46)
export const SUN_TINT = new Color3(1.6, 1.3, 0.85)