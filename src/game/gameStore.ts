import type { ArcRotateCamera, ShadowGenerator, TrailMesh, TransformNode } from '@babylonjs/core'
import type { PhysicsWorld } from './physics.ts'

export const gameStore = {
  mesh: null as TransformNode | null,
  physics: null as PhysicsWorld | null,
  terrainHeights: null as Float32Array | null,
  arcCam: null as ArcRotateCamera | null,
  shadowGenerator: null as ShadowGenerator | null,
  trails: [] as TrailMesh[],
  camMode: 'third' as 'third' | 'first',
  birdMode: 'grounded' as 'grounded' | 'flying',
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
}
