import { useEffect, useState } from 'react'
import { Engine, Scene, useScene } from 'react-babylonjs'
import { Color4, FreeCamera, Vector3 } from '@babylonjs/core'
import { sceneManager } from './game/sceneManager.ts'
import { desertScene } from './game/scenes/DesertScene.tsx'
import { FadeOverlay } from './components/FadeOverlay.tsx'
import { SceneSwitcher } from './components/SceneSwitcher.tsx'
import type { GameScene } from './game/scenes/types.ts'
import { testScene } from '@/game/scenes/TestScene.tsx'

// Register all game scenes
sceneManager.register(desertScene)
sceneManager.register(testScene)

// Fallback camera so Babylon never throws "No camera defined" between scene
// switches. Registers itself with sceneManager so switchTo() can activate it
// synchronously before React unmounts the old scene's cameras.
const FallbackCamera = () => {
  const scene = useScene()
  useEffect(() => {
    if (!scene) return
    const cam = new FreeCamera('__fallback', new Vector3(0, 10, 0), scene)
    cam.minZ = 0.1
    sceneManager._setBabylonScene(scene, cam)

    return () => {
      sceneManager._setBabylonScene(null, null)
      cam.dispose()
    }
  }, [scene])
  return null
}

export default function App() {
  const [activeScene, setActiveScene] = useState<GameScene | null>(sceneManager.getActive)

  useEffect(
    () =>
      sceneManager.subscribe(() => {
        setActiveScene(sceneManager.getActive())
      }),
    [],
  )

  const SceneContent = activeScene?.SceneContent
  const Overlay = activeScene?.Overlay

  return (
    <div style={{ width: '100dvw', height: '100dvh' }}>
      <Engine antialias adaptToDeviceRatio canvasId="main-canvas" engineOptions={{ audioEngine: true }}>
        <Scene clearColor={new Color4(0.96, 0.78, 0.58, 1)}>
          <FallbackCamera />
          {SceneContent && <SceneContent />}
        </Scene>
      </Engine>
      {Overlay && <Overlay />}
      <SceneSwitcher />
      <FadeOverlay />
    </div>
  )
}
