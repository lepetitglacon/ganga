import { useEffect } from 'react'
import { Engine, Scene } from 'react-babylonjs'
import { Color4 } from '@babylonjs/core'
import { audio } from './game/audio.ts'
import { subscribeQuestUnlock } from './game/quests.ts'
import { LightSetup } from './components/LightSetup.tsx'
import { Environment } from './components/Environment.tsx'
import { Map } from './components/Map.tsx'
import { Animals } from './components/Animals.tsx'
import { Caravan } from './components/Caravan.tsx'
import { Water } from './components/Water.tsx'
import { WetnessMask } from './components/WetnessMask.tsx'
import { Player } from './components/Player.tsx'
import { WaterDrops } from './components/WaterDrops.tsx'
import { CameraController } from './components/CameraController.tsx'
import { PostProcess } from './components/PostProcess.tsx'
import { Storms } from './components/Storms.tsx'
import { Clouds } from './components/Clouds.tsx'
import { PhysicsDebug } from './components/PhysicsDebug.tsx'
import { ThermalDebug } from './components/ThermalDebug.tsx'
import { StormDebug } from './components/StormDebug.tsx'
import { HUD } from './components/HUD.tsx'
import { QuestMenu } from './components/QuestMenu.tsx'
import { QuestToast } from './components/QuestToast.tsx'
import { BiomeController } from './components/BiomeController.tsx'
import { BiomeToast } from './components/BiomeToast.tsx'
import { DebugPanel } from './components/DebugPanel.tsx'
import { PlaceAmbience } from './components/PlaceAmbience.tsx'
import { LensFlareComponent } from './components/LensFlare.tsx'
import { IntroSequence } from './components/IntroSequence.tsx'
import { Cutscene } from './components/Cutscene.tsx'
import { VillageCelebration } from './components/VillageCelebration.tsx'
import { SourceCutscene } from './components/SourceCutscene.tsx'
import { Loader } from './components/Loader.tsx'
import { MuteButton } from './components/MuteButton.tsx'

const UNLOCK_SOUND_URL = '/sound/quests/unlock-quest.wav'

export default function App() {
  // Play the unlock jingle whenever a new quest becomes available.
  useEffect(() => subscribeQuestUnlock(() => audio.playOneShot(UNLOCK_SOUND_URL)), [])

  return (
    <div style={{ width: '100dvw', height: '100dvh' }}>
      <Engine antialias adaptToDeviceRatio canvasId="main-canvas" engineOptions={{ audioEngine: true }}>
        <Scene clearColor={new Color4(0.96, 0.78, 0.58, 1)}>
          <LightSetup />
          <Environment />
          <BiomeController />
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
        </Scene>
      </Engine>
      <HUD />
      <QuestMenu />
      <QuestToast />
      <BiomeToast />
      <DebugPanel />
      <Loader />
      <MuteButton />
    </div>
  )
}
