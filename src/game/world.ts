import { Color3, Vector3 } from '@babylonjs/core'

// Direction *toward* the sun (unit vector). Must match the sky shader and
// LightSetup — the directional light points -SUN_DIR from its position.
export const SUN_DIR = new Vector3(1, 2, 1).normalize()

// Shared palette — the sky shader's horizonColor IS the fog color, so the
// terrain edge dissolves seamlessly into the sky at the horizon line.
export const HORIZON_COLOR = new Color3(0.98, 0.78, 0.55)
export const ZENITH_COLOR = new Color3(0.92, 0.55, 0.35)
export const GROUND_COLOR = new Color3(0.78, 0.55, 0.38)
export const SUN_TINT = new Color3(1.6, 1.3, 0.85)