import { useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { audio } from '@/game/audio.ts'

// Always-on-top sound toggle. The first click also unlocks Babylon's audio
// engine (browsers gate it behind a user gesture), so it serves as the
// "enable sound" button on first load.
export const MuteButton = () => {
  const [muted, setMuted] = useState(audio.isMuted())
  const [hover, setHover] = useState(false)

  const toggle = () => {
    const next = !muted
    audio.setMuted(next)
    setMuted(next)
  }

  return (
    <button
      onClick={toggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={muted ? 'Activer le son' : 'Couper le son'}
      style={{
        position: 'absolute',
        bottom: 24,
        right: 24,
        width: 48,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        border: '1px solid rgba(244, 217, 166, 0.45)',
        background: hover
          ? 'rgba(217, 171, 99, 0.35)'
          : 'rgba(20, 12, 4, 0.45)',
        color: muted ? 'rgba(244, 217, 166, 0.55)' : '#f4d9a6',
        cursor: 'pointer',
        pointerEvents: 'auto',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        boxShadow: hover
          ? '0 4px 18px rgba(0,0,0,0.5)'
          : '0 2px 10px rgba(0,0,0,0.4)',
        transition: 'background 0.2s ease, color 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease',
        transform: hover ? 'scale(1.08)' : 'scale(1)',
      }}
    >
      {muted ? <VolumeX size={22} strokeWidth={2} /> : <Volume2 size={22} strokeWidth={2} />}
    </button>
  )
}
