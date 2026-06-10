import { useEffect, useState } from 'react'
import { sceneManager } from '@/game/sceneManager.ts'
import type { GameScene } from '@/game/scenes/types.ts'

export const SceneSwitcher = () => {
  const [scenes, setScenes] = useState<GameScene[]>(sceneManager.getAll)
  const [activeId, setActiveId] = useState<string | null>(sceneManager.getActiveId)
  const [transitioning, setTransitioning] = useState(false)
  const [hovered, setHovered] = useState(false)

  useEffect(
    () =>
      sceneManager.subscribe(() => {
        setScenes(sceneManager.getAll())
        setActiveId(sceneManager.getActiveId())
        setTransitioning(sceneManager.isTransitioning())
      }),
    [],
  )

  if (scenes.length === 0) return null

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 1000,
        fontFamily: 'system-ui, sans-serif',
        userSelect: 'none',
      }}
    >
      {/* Header button */}
      <div
        style={{
          padding: '8px 16px',
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          borderRadius: hovered ? '8px 8px 0 0' : 8,
          color: '#f4d9a6',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.08em',
          cursor: 'default',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 11 }}>▶</span>
        SCÈNES
      </div>

      {/* Dropdown */}
      {hovered && (
        <div
          style={{
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            borderRadius: '0 0 8px 8px',
            padding: '4px 0',
            minWidth: 160,
          }}
        >
          {scenes.map((s) => {
            const isActive = s.id === activeId
            return (
              <div
                key={s.id}
                onClick={() => {
                  if (!isActive && !transitioning) sceneManager.switchTo(s.id)
                }}
                style={{
                  padding: '8px 16px',
                  color: isActive ? '#f4d9a6' : 'rgba(255,255,255,0.75)',
                  fontSize: 13,
                  cursor: isActive || transitioning ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: isActive ? 'rgba(244,217,166,0.1)' : 'transparent',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isActive
                    ? 'rgba(244,217,166,0.1)'
                    : 'transparent'
                }}
              >
                <span style={{ width: 8, fontSize: 10 }}>{isActive ? '●' : ''}</span>
                {s.label}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
