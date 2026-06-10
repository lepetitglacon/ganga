import {
  SceneLoader,
  TransformNode,
  Material,
  type Scene,
  type AnimationGroup,
  type AbstractMesh,
} from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'

// Minimal GLB loader for the intro cinematic. Loads a model under a clean
// carrier we own, normalizes its height, forces materials opaque (some GLBs —
// the elephant — ship alphaMode MASK with alpha 0, which renders invisible),
// registers it as a shadow caster, and returns handles for staging.

export type LoadedModel = {
  carrier: TransformNode
  meshes: AbstractMesh[]
  anims: AnimationGroup[]
  // Vertical offset (world units, post-scale) from the carrier origin to the
  // model's lowest point — add to a ground height to rest its feet on it.
  restOffset: number
  setEnabled: (on: boolean) => void
  playAnim: (re: RegExp, loop?: boolean) => AnimationGroup | null
  dispose: () => void
}

export async function loadGLB(
  scene: Scene,
  folder: string,
  file: string,
  targetHeight: number,
  isCancelled: () => boolean,
): Promise<LoadedModel | null> {
  const result = await SceneLoader.ImportMeshAsync('', folder, file, scene)
  if (isCancelled()) {
    result.meshes.forEach((m) => m.dispose())
    return null
  }

  const importedRoot = result.meshes[0]
  const { min, max } = importedRoot.getHierarchyBoundingVectors(true)
  const height = Math.max(max.y - min.y, 1e-3)
  const scale = targetHeight / height

  const carrier = new TransformNode(`intro-${file}`, scene)
  carrier.scaling.setAll(scale)
  importedRoot.parent = carrier

  const sg = gameStore.shadowGenerator
  for (const m of result.meshes) {
    const mat = m.material
    if (mat) {
      mat.transparencyMode = Material.MATERIAL_OPAQUE
      mat.alpha = 1
    }
    if (sg) sg.addShadowCaster(m)
    m.receiveShadows = true
  }

  for (const g of result.animationGroups) g.stop()

  return {
    carrier,
    meshes: result.meshes,
    anims: result.animationGroups,
    restOffset: -min.y * scale,
    setEnabled: (on: boolean) => carrier.setEnabled(on),
    playAnim: (re: RegExp, loop = true) => {
      const g = result.animationGroups.find((a) => re.test(a.name)) ?? null
      g?.start(loop)
      return g
    },
    dispose: () => carrier.dispose(false, true),
  }
}
