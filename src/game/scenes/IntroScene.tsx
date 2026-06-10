import { LightSetup } from '@/components/LightSetup.tsx'
import { Environment } from '@/components/Environment.tsx'
import { PostProcess } from '@/components/PostProcess.tsx'
import { LandingTerrain } from '@/components/LandingTerrain.tsx'
import { IntroCinematic } from '@/components/IntroCinematic.tsx'
import { IntroOverlay } from '@/components/IntroOverlay.tsx'
import type { GameScene } from '@/game/scenes/types.ts'

// Cinematic intro: a sequence of camera shots with French narration that
// presents the world (the endless dunes, the drought, the water-bearing bird)
// over the lightweight dune/bird backdrop, then auto-advances to the desert.
// Reached from the landing menu's "Jouer"; skippable with Échap.
const IntroSceneContent = () => (
  <>
    <LightSetup />
    <Environment />
    <LandingTerrain />
    <IntroCinematic />
    <PostProcess />
  </>
)

export const introScene: GameScene = {
  id: 'intro',
  label: 'Intro',
  SceneContent: IntroSceneContent,
  Overlay: IntroOverlay,
}
