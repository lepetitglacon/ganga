import { Color3, Vector3 } from '@babylonjs/core'

// A sandstorm: inverted cone (narrow at the ground, wider at the top).
// The dense sand lives in a thin shell of `wallThickness`; the inside of
// the cone (the eye) is calm and clear.
export interface StormConfig {
  // Position du point bas (la pointe) de la tempête, en coordonnées monde.
  // center.y doit valoir la hauteur du terrain à (center.x, center.z) pour
  // que le cône soit posé sur le sol.
  center: Vector3

  // --- Forme du cône ---
  // Rayon du shell tout en bas. Plus c'est petit, plus la pointe est étroite
  // et plus l'œil au sol est petit.
  baseRadius: number
  // Rayon du shell tout en haut. topRadius > baseRadius = cône inversé
  // (s'évase vers le ciel).
  topRadius: number
  // Hauteur totale (mètres). Va de center.y à center.y + height.
  height: number
  // Épaisseur du mur dense (mètres). Le mur est l'anneau entre
  // (rayon - épaisseur/2) et (rayon + épaisseur/2) à chaque hauteur :
  //   - dedans = forces actives + visi dégradée
  //   - à l'intérieur = œil calme
  //   - à l'extérieur = air libre
  wallThickness: number

  // --- Forces (appliquées uniquement quand le joueur est dans le mur) ---
  // Accélération du vent tangentiel en m/s². Pousse le joueur dans le sens
  // anti-horaire autour de l'axe du cône (même sens que la rotation visuelle).
  // Plus haut = plus difficile d'avancer à contre-vent.
  windSpeed: number
  // Accélération radiale vers l'extérieur en m/s². Petite répulsion qui
  // expulse le joueur du mur — donne la sensation d'une barrière plutôt
  // que d'une aspiration vers le centre.
  outwardAccel: number

  // --- Visuel : densité / forme des patches ---
  // Nombre de quads texturés répartis sur le shell. Plus haut = mur plus
  // dense et sableux, mais plus de GPU. 3000–6000 est un bon range ;
  // au-delà tu vas surtout payer du fillrate (overdraw).
  patchCount: number
  // Largeur d'un patch en mètres (le long de la tangente du cône).
  patchWidth: number
  // Hauteur d'un patch en mètres (vertical).
  patchHeight: number

  // --- Visuel : opacité / fade ---
  // Multiplicateur global d'opacité (0..1+). Augmenter pour cacher l'autre
  // côté du cône, diminuer pour rendre la tempête plus diaphane.
  patchOpacity: number
  // Hauteur normalisée (0..1) en-dessous de laquelle l'alpha commence à
  // monter à fond. Sert à coller la base au sol sans bord franc.
  bottomFadeEnd: number
  // Hauteur normalisée (0..1) à partir de laquelle l'alpha commence à
  // chuter vers 0 en haut. < 1 = le cône se dissipe avant son sommet.
  topFadeStart: number

  // --- Visuel : couleurs ---
  // Couleur de base du sable (teinte dominante).
  sandColor: Color3
  // Première teinte par-patch (variation A). Mélangée avec tintB selon un
  // hash par instance pour casser l'uniformité.
  tintA: Color3
  // Seconde teinte par-patch (variation B).
  tintB: Color3
  // Plage de luminosité par-patch [min, max]. Chaque patch reçoit un
  // facteur multiplicatif aléatoire dans cet intervalle.
  brightnessMin: number
  brightnessMax: number

  // --- Visuel : animation du shader ---
  // Vitesse de défilement horizontal du noise (m/s en UV). Lit comme du
  // vent qui souffle dans le mur. Plus haut = vent plus visible.
  noiseScrollSpeed: number
  // Mélange du noise haute fréquence ("gusts") par-dessus le noise de base.
  // 0 = lisse, 1 = uniquement les gusts.
  streakMix: number

  // --- Visuel : rotation du cône ---
  // Vitesse de rotation angulaire du cône au sol, en rad/s. Donne le swirl
  // visuel. 0 = poussière statique, ~0.5–1.0 = vent qui tourne nettement,
  // >1.5 = vortex agressif.
  windAngularSpeed: number
  // Fraction de windAngularSpeed appliquée tout en haut du cône (0..1). Le
  // swirl ralentit linéairement avec la hauteur : 1 = rotation rigide (haut et
  // bas tournent à la même vitesse), 0.3 = le sommet tourne ~3× plus lentement
  // que la base, ce qui enroule la poussière en spirale comme une tornade.
  windAngularTopFactor: number
}

export function shellRadiusAt(storm: StormConfig, relY: number): number {
  const t = Math.max(0, Math.min(1, relY / storm.height))
  return storm.baseRadius + (storm.topRadius - storm.baseRadius) * t
}

// Audio falloff zone for a storm's spatial sound. Min = full-volume core,
// max = audible range. Shared between Storm (audio params) and StormDebug
// (visualization) so they stay in sync.
export const STORM_SOUND_MIN_FACTOR = 0.3
export const STORM_SOUND_MAX_FACTOR = 1.5
// Directional cone: full-volume inside the inner half-angle, fades to silence
// between inner and outer half-angles. Cone tip at storm.center, axis = +Y
// (opens upward, matching the storm's visual cone but wider).
export const STORM_SOUND_INNER_HALF_ANGLE = Math.PI / 4 // 45°
export const STORM_SOUND_OUTER_HALF_ANGLE = Math.PI / 3 // 60°
export function stormSoundRange(storm: StormConfig): { min: number; max: number } {
  return {
    min: storm.topRadius * STORM_SOUND_MIN_FACTOR,
    max: storm.topRadius * STORM_SOUND_MAX_FACTOR,
  }
}

export interface StormSample {
  inWall: boolean // dense ring → forces apply, vision degraded
  insideEye: boolean // inside the calm core
  wallProximity: number // 0..1 — peaks at the wall mid, used for fog/HUD
}

// Sample the storm field at a world position. Cheap; safe to call per frame.
export function sampleStorm(storm: StormConfig, x: number, y: number, z: number): StormSample {
  const relY = y - storm.center.y
  if (relY < -10 || relY > storm.height + 10) {
    return { inWall: false, insideEye: false, wallProximity: 0 }
  }
  const dx = x - storm.center.x
  const dz = z - storm.center.z
  const r = Math.hypot(dx, dz)
  const localRadius = shellRadiusAt(storm, relY)
  const wallDist = Math.abs(r - localRadius)
  const half = storm.wallThickness / 2
  // 0 at the edge of the wall, 1 at its center
  const proximity = wallDist < half ? 1 - wallDist / half : 0
  const inWall = wallDist < half && relY >= 0 && relY <= storm.height
  const insideEye = r < localRadius - half && relY >= 0 && relY <= storm.height
  return { inWall, insideEye, wallProximity: proximity }
}

// Mutates the player's linvel to add wind (tangential) + repulsion (radial outward)
// when the player is inside the dense ring. No-op otherwise.
export function applyStormForce(
  storm: StormConfig,
  x: number,
  z: number,
  sample: StormSample,
  dt: number,
  outVel: { x: number; y: number; z: number },
): void {
  if (!sample.inWall) return
  const dx = x - storm.center.x
  const dz = z - storm.center.z
  const r = Math.hypot(dx, dz) || 1
  const rx = dx / r
  const rz = dz / r
  // CW tangent — matches the visual swirl direction of the cone shader.
  const tx = rz
  const tz = -rx
  // smoothstep for soft entry/exit at the wall edges
  const s = sample.wallProximity * sample.wallProximity * (3 - 2 * sample.wallProximity)
  // Asymmetric tangent force: when the bird is fighting the swirl (negative
  // tangent velocity), the wind hits ~3× harder so it brakes fast. When the
  // bird already rides with the swirl, the boost is gentler — the storm
  // herds you into its rotation instead of catapulting you indefinitely.
  const velTan = outVel.x * tx + outVel.z * tz
  const tangentMult = velTan < 0 ? 3.0 : 10
  const wind = storm.windSpeed * s * dt * tangentMult
  const push = storm.outwardAccel * s * dt
  outVel.x += tx * wind + rx * push
  outVel.z += tz * wind + rz * push
}

// Default storm — sits ~500m from spawn, tall enough to dominate the horizon.
export function makeDefaultStorm(groundY: number): StormConfig {
  return {
    center: new Vector3(150, groundY, 150),

    baseRadius: 64,
    topRadius: 130,
    height: 300,
    wallThickness: 50,

    windSpeed: 150,
    outwardAccel: 150,

    patchCount: 4000,
    patchWidth: 30,
    patchHeight: 10,

    patchOpacity: 5,
    bottomFadeEnd: 0.0,
    topFadeStart: 0.7,

    sandColor: new Color3(0.86, 0.7, 0.46),
    tintA: new Color3(1.0, 0.94, 0.82),
    tintB: new Color3(1.06, 1.0, 0.9),
    brightnessMin: 0.88,
    brightnessMax: 1.08,

    noiseScrollSpeed: 2.2,
    streakMix: .5,

    windAngularSpeed: 1,
    windAngularTopFactor: 0.0,
  }
}
