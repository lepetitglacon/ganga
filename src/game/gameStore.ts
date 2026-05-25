import type { ArcRotateCamera, ShadowGenerator, TrailMesh, TransformNode } from '@babylonjs/core'
import type { PhysicsWorld } from './physics.ts'

export const gameStore = {
  mesh: null as TransformNode | null,
  physics: null as PhysicsWorld | null,
  arcCam: null as ArcRotateCamera | null,
  shadowGenerator: null as ShadowGenerator | null,
  trails: [] as TrailMesh[],
  camMode: 'third' as 'third' | 'first',
  birdMode: 'grounded' as 'grounded' | 'flying',
  // Camera angles — source of truth, driven by mouse
  camAlpha: -Math.PI / 2,
  // π/2 = horizon → level flight when taking off
  camBeta: Math.PI / 2,
  // Derived each frame from camera angles
  birdYaw: 0,
  birdPitch: 0,
  // 0..1 — current thermal strength under the bird (sun-facing slope updraft).
  // Useful for HUD/VFX hooks; written by Player each frame.
  thermal: 0,
}
