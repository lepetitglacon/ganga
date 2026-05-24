import { Engine, Scene } from 'react-babylonjs'
import { Vector3, Color4, Color3 } from '@babylonjs/core'

export default function App() {
  return (
    <div style={{ width: '100dvw', height: '100dvh' }}>
      <Engine antialias adaptToDeviceRatio canvasId="main-canvas">
        <Scene clearColor={new Color4(0.42, 0.71, 0.96, 1)}>
          <arcRotateCamera
            name="cam"
            alpha={-Math.PI / 2}
            beta={Math.PI / 3.5}
            radius={14}
            target={Vector3.Zero()}
          />
          <hemisphericLight
            name="hemi"
            intensity={0.6}
            direction={new Vector3(0, 1, 0)}
          />
          <directionalLight
            name="sun"
            intensity={1.2}
            direction={new Vector3(-1, -2, -1)}
          />
          <ground name="ground" width={30} height={30} receiveShadows>
            <standardMaterial
              name="groundMat"
              diffuseColor={new Color3(0.29, 0.55, 0.24)}
            />
          </ground>
          <box name="box" size={1.5} position={new Vector3(0, 0.75, 0)}>
            <standardMaterial
              name="boxMat"
              diffuseColor={new Color3(0.8, 0.3, 0.2)}
            />
          </box>
        </Scene>
      </Engine>
    </div>
  )
}
