import { useEffect, useState } from 'react'
import { sceneManager } from '@/game/sceneManager.ts'

export const FadeOverlay = () => {
  const [opacity, setOpacity] = useState(() => sceneManager.getFadeOpacity())

  useEffect(
    () =>
      sceneManager.subscribe(() => {
        setOpacity(sceneManager.getFadeOpacity())
      }),
    [],
  )

  if (opacity <= 0) return null

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#000',
        opacity,
        pointerEvents: 'none',
        zIndex: 9999,
        transition: 'none',
      }}
    />
  )
}
