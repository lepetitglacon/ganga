import type { ArcRotateCamera, ShadowGenerator, TrailMesh, TransformNode, Vector3 } from '@babylonjs/core'
import type { PhysicsWorld } from './physics.ts'
import type { StormConfig } from './storm.ts'

export const gameStore = {
  // Startup flow. 'intro' = loading screen + cinematic desert fly-over; flips to
  // 'playing' when the player clicks "Jouer" (IntroSequence then lerps the
  // camera onto the bird and fades the intro music out). assetsReady goes true
  // once the world + bird are loaded, which is what swaps "Chargement" → "Jouer".
  phase: 'intro' as 'intro' | 'playing',
  assetsReady: false,
  mesh: null as TransformNode | null,
  physics: null as PhysicsWorld | null,
  terrainHeights: null as Float32Array | null,
  arcCam: null as ArcRotateCamera | null,
  shadowGenerator: null as ShadowGenerator | null,
  trails: [] as TrailMesh[],
  camMode: 'third' as 'third' | 'first',
  birdMode: 'grounded' as 'grounded' | 'takingOff' | 'flying',
  // Visual flare overlay on top of `flying`. Set when the predicted trajectory
  // is about to intersect the ground — bird levels out and flaps. Player keeps
  // full velocity control; clears as soon as the trajectory becomes safe again.
  landingApproach: false,
  // Camera angles — source of truth for camera orientation, driven by mouse
  camAlpha: -Math.PI / 2,
  // π/2 = horizon → level flight when taking off
  camBeta: Math.PI / 2,
  // Bird heading angles. Track cam* unless free-look (Shift) decouples them.
  birdAlpha: -Math.PI / 2,
  birdBeta: Math.PI / 2,
  // Hold Shift to look around without turning the bird.
  freeLook: false,
  // True while the camera is lerping back behind the bird after free-look.
  recentering: false,
  // Derived each frame from bird angles
  birdYaw: 0,
  birdPitch: 0,
  // 0..1 — current thermal strength under the bird (sun-facing slope updraft).
  // Useful for HUD/VFX hooks; written by Player each frame.
  thermal: 0,
  speed: 0,
  flapCooldown: 0,
  // Incremented once per in-flight wing-flap. WaterDrops watches this to fire a
  // droplet burst; flapVel holds the bird's velocity at that instant so the
  // shed drops inherit the bird's heading (and keep it if the bird then turns).
  flapId: 0,
  flapVel: { x: 0, y: 0, z: 0 },
  // Bird hydration, 0..1. Drains slowly over time; refills while wading in an
  // oasis. Written by Player each frame, read by HUD.
  water: 1,
  // True while the bird is standing in oasis water (drives refill + SFX).
  inWater: false,
  // 0..1 how wet the bird's feet are; drives the wet trail painted by
  // WetnessMask. Set to 1 while wading, dries out as it walks on dry sand.
  feetWet: 0,
  // Active sandstorms. Player reads these to apply forces; Storm component
  // owns the lifecycle (mount/unmount registers and removes entries).
  storms: [] as StormConfig[],
  // Per-frame summary written by Player: max wall proximity across all storms.
  // 0 = outside any storm wall, 1 = dead center of a wall. Used for fog/HUD.
  stormProximity: 0,
  // --- Village NPC interaction + cutscene ---
  // Proximity trigger around the talking bird ("Armature") in the village.
  // Set by Map once the GLB loads. center/radius is the XZ proximity test; the
  // cutscene camera frames `center`.
  npcZone: null as { center: Vector3; radius: number } | null,
  // True while the grounded player stands inside npcZone — HUD shows "F pour parler".
  nearNpc: false,
  // Non-null while the village intro cutscene plays; `step` indexes the dialogue.
  cutscene: null as { step: number } | null,
  // One-shot event: set true the frame a reservoir first reaches 100%. The
  // VillageCelebration component consumes it (sets it back to false) to kick off
  // its camera tour + water geysers.
  reservoirJustFilled: false,
  // True while the village celebration camera tour is playing (input frozen,
  // camera taken over) — same gating as `cutscene`.
  villageCelebration: false,
}
