import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import {
  GlowLayer,
  MeshBuilder,
  Vector3,
  Color3,
  StandardMaterial,
} from '@babylonjs/core'
import { SUN_DIR } from '@/game/world.ts'

export const LensFlareComponent = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return

    // Glow layer pour l'effet de bloom
    const glow = new GlowLayer('glow', scene)
    glow.intensity = 1.0
    glow.blurKernel = 64

    // Créer un mesh invisible du soleil pour le lens flare
    // Positionner selon la direction du soleil
    const sunPos = SUN_DIR.normalize().scale(500)
    const sunMesh = MeshBuilder.CreateSphere(
      'sun-mesh',
      { diameter: 20, segments: 4 },
      scene
    )
    sunMesh.position = sunPos
    sunMesh.infiniteDistance = true

    // Material émissif pour le glow
    const sunMat = new StandardMaterial('sun-material', scene)
    sunMat.emissiveColor = new Color3(1.0, 0.88, 0.7)
    sunMat.renderingGroupId = 1
    sunMesh.material = sunMat

    // Ajouter au glow layer
    glow.addIncludedOnlyMesh(sunMesh)

    return () => {
      glow.dispose()
      sunMesh.dispose()
      sunMat.dispose()
    }
  }, [scene])

  return null
}
