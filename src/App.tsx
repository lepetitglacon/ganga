import { Engine, Scene } from 'react-babylonjs'
import { Color4 } from '@babylonjs/core'
import { LightSetup } from './components/LightSetup.tsx'
import { Environment } from './components/Environment.tsx'
import { Map } from './components/Map.tsx'
import { Player } from './components/Player.tsx'
import { CameraController } from './components/CameraController.tsx'
import { PostProcess } from './components/PostProcess.tsx'
import { Storm } from './components/Storm.tsx'
import { PhysicsDebug } from './components/PhysicsDebug.tsx'
import { ThermalDebug } from './components/ThermalDebug.tsx'
import { StormDebug } from './components/StormDebug.tsx'
import { HUD } from './components/HUD.tsx'

export default function App() {
  return (
    <div style={{ width: '100dvw', height: '100dvh' }}>
      <Engine antialias adaptToDeviceRatio canvasId="main-canvas">
        <Scene clearColor={new Color4(0.96, 0.78, 0.58, 1)}>
          <LightSetup />
          <Environment />
          <Map />
          <CameraController />
          <PostProcess />
          <Player />
          <Storm />
          <PhysicsDebug />
          <ThermalDebug />
          <StormDebug />
        </Scene>
      </Engine>
      <HUD />
    </div>
  )
}
