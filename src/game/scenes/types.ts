import type { FC } from 'react'

export interface GameScene {
  /** Unique identifier for the scene. */
  id: string
  /** Human-readable name shown in the scene switcher. */
  label: string
  /** React component rendered inside the Babylon <Scene> (3D content: meshes, cameras, lights…). */
  SceneContent: FC
  /** Optional React component rendered as a DOM overlay on top of the canvas (HUD, menus…). */
  Overlay?: FC
}
