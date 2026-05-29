import { Engine, Scene } from 'react-babylonjs'
import { Color4 } from '@babylonjs/core'
import { LightSetup } from './components/LightSetup.tsx'
import { Environment } from './components/Environment.tsx'
import { Map } from './components/Map.tsx'
import { Water } from './components/Water.tsx'
import { Player } from './components/Player.tsx'
import { CameraController } from './components/CameraController.tsx'
import { PostProcess } from './components/PostProcess.tsx'
import { Storm } from './components/Storm.tsx'
import { Vector3 } from '@babylonjs/core'
import { PhysicsDebug } from './components/PhysicsDebug.tsx'
import { ThermalDebug } from './components/ThermalDebug.tsx'
import { StormDebug } from './components/StormDebug.tsx'
import { HUD } from './components/HUD.tsx'
import { DebugPanel } from './components/DebugPanel.tsx'
import { PlaceAmbience } from './components/PlaceAmbience.tsx'

export default function App() {
  return (
    <div style={{ width: '100dvw', height: '100dvh' }}>
      <Engine antialias adaptToDeviceRatio canvasId="main-canvas" engineOptions={{ audioEngine: true }}>
        <Scene clearColor={new Color4(0.96, 0.78, 0.58, 1)}>
          <LightSetup />
          <Environment />
          <Map />
          <Water />
          <CameraController />
          <PostProcess />
          <Player />
          <PlaceAmbience />
          <Storm />
          <Storm
            configOverrides={{ center: new Vector3(-400, 0, -200) }}
            velocity={{ x: 12, z: 8 }}
            bounds={{ minX: -700, maxX: 700, minZ: -700, maxZ: 700 }}
          />
          <PhysicsDebug />
          <ThermalDebug />
          <StormDebug />
        </Scene>
      </Engine>
      <HUD />
      <DebugPanel />
    </div>
  )
}
