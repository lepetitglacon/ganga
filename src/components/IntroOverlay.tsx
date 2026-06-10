import { useEffect, useState } from 'react'
import { introStore } from '@/game/introStore.ts'
import { MuteButton } from '@/components/MuteButton.tsx'

// DOM overlay for the IntroScene: cinematic letterbox bars, the current
// narration line (cross-faded on change), and a "skip" hint. The caption text
// is driven by IntroCinematic through introStore.

const BAR_HEIGHT = '11vh'

export const IntroOverlay = () => {
  const [caption, setCaption] = useState(introStore.getState().caption)
  const [captionId, setCaptionId] = useState(introStore.getState().captionId)

  useEffect(
    () =>
      introStore.subscribe(() => {
        const s = introStore.getState()
        setCaption(s.caption)
        setCaptionId(s.captionId)
      }),
    [],
  )

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        userSelect: 'none',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Letterbox bars */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: BAR_HEIGHT, background: '#000' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: BAR_HEIGHT, background: '#000' }} />

      {/* Narration line, just above the bottom bar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: `calc(${BAR_HEIGHT} + 6vh)`,
          display: 'flex',
          justifyContent: 'center',
          padding: '0 8vw',
        }}
      >
        <div
          // key on captionId so React remounts the node and the fade-in replays
          // each time the line changes.
          key={captionId}
          style={{
            color: '#f4d9a6',
            fontSize: 'clamp(18px, 2.4vw, 30px)',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textAlign: 'center',
            textShadow: '0 2px 14px rgba(0,0,0,0.8)',
            animation: 'intro-caption-fade 1s ease forwards',
            opacity: 0,
          }}
        >
          {caption}
        </div>
      </div>

      {/* Skip hint */}
      <div
        style={{
          position: 'absolute',
          right: 24,
          bottom: `calc(${BAR_HEIGHT} + 16px)`,
          color: 'rgba(255,255,255,0.6)',
          fontSize: 13,
          letterSpacing: '0.12em',
        }}
      >
        ÉCHAP POUR PASSER
      </div>

      <MuteButton />

      <style>{`
        @keyframes intro-caption-fade {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
