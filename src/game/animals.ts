import { Vector3 } from '@babylonjs/core'

export type Animal = {
  name: string
  file: string
  // World XZ position; Y is resolved from the terrain at load so feet sit on
  // the ground.
  position: Vector3
  rotationY: number
  // The imported mesh is normalized to this height (world units) regardless of
  // the GLB's source units. Roughly proportional to each animal's real size,
  // anchored on the elephant at 25.
  targetHeight: number
}

// All GLBs live in /public/gltf/animals/. They're static meshes (no skeleton),
// so each gets a baked trimesh body collider.
export const ANIMALS: Animal[] = [
  {
    name: 'elephant',
    file: 'elephant.glb',
    position: new Vector3(35, 0, -20),
    rotationY: Math.PI * 0.75,
    targetHeight: 25,
  },
  {
    name: 'hippopotamus',
    file: 'hippopotamus.glb',
    position: new Vector3(-30, 0, -35),
    rotationY: Math.PI * 0.25,
    targetHeight: 14,
  },
  {
    name: 'sumatran_tiger',
    file: 'sumatran_tiger.glb',
    position: new Vector3(50, 0, 25),
    rotationY: -Math.PI * 0.5,
    targetHeight: 9,
  },
  {
    name: 'seychelles_giant_tortoise',
    file: 'seychelles_giant_tortoise.glb',
    position: new Vector3(-45, 0, 20),
    rotationY: Math.PI,
    targetHeight: 6,
  },
]
