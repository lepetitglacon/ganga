import { Engine, Scene } from 'react-babylonjs'
import { Color4 } from '@babylonjs/core'
import { LightSetup } from './components/LightSetup.tsx'
import { Environment } from './components/Environment.tsx'
import { Map } from './components/Map.tsx'
import { Water } from './components/Water.tsx'
import { WetnessMask } from './components/WetnessMask.tsx'
import { Player } from './components/Player.tsx'
import { WaterDrops } from './components/WaterDrops.tsx'
import { CameraController } from './components/CameraController.tsx'
import { PostProcess } from './components/PostProcess.tsx'
import { Storms } from './components/Storms.tsx'
import { PhysicsDebug } from './components/PhysicsDebug.tsx'
import { ThermalDebug } from './components/ThermalDebug.tsx'
import { StormDebug } from './components/StormDebug.tsx'
import { HUD } from './components/HUD.tsx'
import { DebugPanel } from './components/DebugPanel.tsx'
import { PlaceAmbience } from './components/PlaceAmbience.tsx'
import { LensFlareComponent } from './components/LensFlare.tsx'
import { IntroSequence } from './components/IntroSequence.tsx'
import { Loader } from './components/Loader.tsx'
import { MuteButton } from './components/MuteButton.tsx'

export default function App() {
  return (
    <div style={{ width: '100dvw', height: '100dvh' }}>
      <Engine antialias adaptToDeviceRatio canvasId="main-canvas" engineOptions={{ audioEngine: true }}>
        <Scene clearColor={new Color4(0.96, 0.78, 0.58, 1)}>
          <LightSetup />
          <Environment />
          <LensFlareComponent />
          <Map />
          <Water />
          <WetnessMask />
          <CameraController />
          <IntroSequence />
          <PostProcess />
          <Player />
          <WaterDrops />
          <PlaceAmbience />
          <Storms maxConcurrent={3} />
          <PhysicsDebug />
          <ThermalDebug />
          <StormDebug />
        </Scene>
      </Engine>
      <HUD />
      <DebugPanel />
      <Loader />
      <MuteButton />
    </div>
  )
}
