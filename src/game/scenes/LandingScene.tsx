import { LightSetup } from '@/components/LightSetup.tsx'
import { Environment } from '@/components/Environment.tsx'
import { PostProcess } from '@/components/PostProcess.tsx'
import { LandingTerrain } from '@/components/LandingTerrain.tsx'
import { LandingBird } from '@/components/LandingBird.tsx'
import { LandingCamera } from '@/components/LandingCamera.tsx'
import { LandingMenu } from '@/components/LandingMenu.tsx'
import { MuteButton } from '@/components/MuteButton.tsx'
import type { GameScene } from '@/game/scenes/types.ts'

// Intro scene: just sand dunes (no rocks, no biomes, no places — "comme au
// début") with a slow camera orbit behind the title menu. "Jouer" switches to
// the desert scene.
const LandingSceneContent = () => (
  <>
    <LightSetup />
    <Environment />
    <LandingCamera />
    <LandingTerrain />
    <LandingBird />
    <PostProcess />
  </>
)

const LandingOverlay = () => (
  <>
    <LandingMenu />
    <MuteButton />
  </>
)

export const landingScene: GameScene = {
  id: 'landing',
  label: 'Accueil',
  SceneContent: LandingSceneContent,
  Overlay: LandingOverlay,
}
