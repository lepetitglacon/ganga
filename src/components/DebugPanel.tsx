import { useEffect, useState } from 'react'
import {
  DEBUG_CATEGORIES,
  isDebugEnabled,
  setDebug,
  subscribeDebugPanel,
  type DebugCategory,
} from '@/game/debug.ts'
import { gameStore } from '@/game/gameStore.ts'

function snapshot(): Record<DebugCategory, boolean> {
  return {
    physics: isDebugEnabled('physics'),
    sound: isDebugEnabled('sound'),
    ground: isDebugEnabled('ground'),
    mesh: isDebugEnabled('mesh'),
  }
}

export const DebugPanel = () => {
  const [state, setState] = useState<Record<DebugCategory, boolean>>(snapshot)
  const [playing, setPlaying] = useState(false)

  useEffect(() => subscribeDebugPanel(() => setState(snapshot())), [])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      setPlaying(gameStore.phase === 'playing')
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Hidden during the loading screen / cinematic intro.
  if (!playing) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 200,
        right: 16,
        padding: '10px 14px',
        background: 'rgba(0,0,0,0.45)',
        borderRadius: 8,
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
    >
      <div style={{ opacity: 0.7, fontSize: 11, letterSpacing: 1, marginBottom: 6 }}>
        DEBUG
      </div>
      {DEBUG_CATEGORIES.map((c) => (
        <label
          key={c}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            padding: '2px 0',
          }}
        >
          <input
            type="checkbox"
            checked={state[c]}
            onChange={(e) => setDebug(c, e.target.checked)}
          />
          <span style={{ textTransform: 'capitalize' }}>{c}</span>
        </label>
      ))}
    </div>
  )
}
