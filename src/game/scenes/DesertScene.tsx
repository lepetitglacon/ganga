import { useEffect } from 'react'
import { LightSetup } from '@/components/LightSetup.tsx'
import { Environment } from '@/components/Environment.tsx'
import { Map } from '@/components/Map.tsx'
import { Animals } from '@/components/Animals.tsx'
import { Caravan } from '@/components/Caravan.tsx'
import { Water } from '@/components/Water.tsx'
import { WetnessMask } from '@/components/WetnessMask.tsx'
import { CameraController } from '@/components/CameraController.tsx'
import { IntroSequence } from '@/components/IntroSequence.tsx'
import { Cutscene } from '@/components/Cutscene.tsx'
import { VillageCelebration } from '@/components/VillageCelebration.tsx'
import { SourceCutscene } from '@/components/SourceCutscene.tsx'
import { PostProcess } from '@/components/PostProcess.tsx'
import { Player } from '@/components/Player.tsx'
import { WaterDrops } from '@/components/WaterDrops.tsx'
import { PlaceAmbience } from '@/components/PlaceAmbience.tsx'
import { Storms } from '@/components/Storms.tsx'
import { Clouds } from '@/components/Clouds.tsx'
import { PhysicsDebug } from '@/components/PhysicsDebug.tsx'
import { ThermalDebug } from '@/components/ThermalDebug.tsx'
import { StormDebug } from '@/components/StormDebug.tsx'
import { LensFlareComponent } from '@/components/LensFlare.tsx'
import { HUD } from '@/components/HUD.tsx'
import { QuestMenu } from '@/components/QuestMenu.tsx'
import { QuestToast } from '@/components/QuestToast.tsx'
import { DebugPanel } from '@/components/DebugPanel.tsx'
import { Loader } from '@/components/Loader.tsx'
import { MuteButton } from '@/components/MuteButton.tsx'
import { audio } from '@/game/audio.ts'
import { subscribeQuestUnlock } from '@/game/quests.ts'
import type { GameScene } from '@/game/scenes/types.ts'

const UNLOCK_SOUND_URL = '/sound/quests/unlock-quest.wav'

const DesertSceneContent = () => (
  <>
    <LightSetup />
    <Environment />
    <LensFlareComponent />
    <Map />
    <Animals />
    <Caravan />
    <Water />
    <WetnessMask />
    <CameraController />
    <IntroSequence />
    <Cutscene />
    <VillageCelebration />
    <SourceCutscene />
    <PostProcess />
    <Player />
    <WaterDrops />
    <PlaceAmbience />
    <Storms maxConcurrent={3} />
    <Clouds count={16} />
    <PhysicsDebug />
    <ThermalDebug />
    <StormDebug />
  </>
)

const DesertOverlay = () => {
  useEffect(() => subscribeQuestUnlock(() => audio.playOneShot(UNLOCK_SOUND_URL)), [])

  return (
    <>
      <HUD />
      <QuestMenu />
      <QuestToast />
      <DebugPanel />
      <Loader />
      <MuteButton />
    </>
  )
}

export const desertScene: GameScene = {
  id: 'desert',
  label: 'Désert',
  SceneContent: DesertSceneContent,
  Overlay: DesertOverlay,
}
