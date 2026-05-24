import { Engine, Scene } from 'react-babylonjs'
import { Color4 } from '@babylonjs/core'
import { LightSetup } from './components/LightSetup.tsx'
import { Terrain } from './components/Terrain.tsx'
import { Player } from './components/Player.tsx'
import { CameraController } from './components/CameraController.tsx'
import { PhysicsDebug } from './components/PhysicsDebug.tsx'

export default function App() {
  return (
    <div style={{ width: '100dvw', height: '100dvh' }}>
      <Engine antialias adaptToDeviceRatio canvasId="main-canvas">
        <Scene clearColor={new Color4(0.42, 0.71, 0.96, 1)}>
          <LightSetup />
          <Terrain />
          <CameraController />
          <Player />
          <PhysicsDebug />
        </Scene>
      </Engine>
    </div>
  )
}
