import { useEffect, useRef, useState } from 'react'
import { sceneManager } from '@/game/sceneManager.ts'
import { audio } from '@/game/audio.ts'

// Title / menu overlay for the LandingScene, drawn over the cinematic dune
// orbit. Same look as the in-game loader (Cinzel Decorative title pinned near
// the top, "Jouer" near the bottom above the studio logo, soft vignette) and
// the same intro music. "Jouer" fades into the desert scene.

const INTRO_MUSIC_URL = '/sound/ambiance/intro.mp3'
const INTRO_MUSIC_VOLUME = 0.55
// volume/s — eased up so the loop doesn't pop in at full level.
const MUSIC_FADE_IN = 0.4

export const LandingMenu = () => {
  const [hover, setHover] = useState(false)
  const musicRef = useRef<{ setVolume: (v: number) => void } | null>(null)

  // Start the intro theme. The audio engine stays locked until the first user
  // gesture (any click/keypress unlocks it), then this fades up.
  useEffect(() => {
    const music = audio.loop(INTRO_MUSIC_URL, { volume: 0 })
    musicRef.current = music
    let vol = 0
    let raf = 0
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      if (vol < INTRO_MUSIC_VOLUME) {
        vol = Math.min(INTRO_MUSIC_VOLUME, vol + MUSIC_FADE_IN * dt)
        music.setVolume(vol)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      music.setVolume(0)
      musicRef.current = null
    }
  }, [])

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        // Title pinned near the top, "Jouer" near the bottom (above the studio
        // logo, which sits at the very bottom).
        paddingTop: 'clamp(48px, 14vh, 160px)',
        paddingBottom: 'clamp(120px, 20vh, 220px)',
        boxSizing: 'border-box',
        fontFamily: 'system-ui, sans-serif',
        color: '#fff',
        // Soft vignette so the title reads over the bright desert without
        // hiding it.
        background:
          'radial-gradient(ellipse at center, rgba(0,0,0,0.15) 0%, rgba(20,8,0,0.55) 100%)',
        textShadow: '0 2px 12px rgba(0,0,0,0.6)',
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          fontFamily: "'Cinzel Decorative', serif",
          fontSize: 'clamp(48px, 12vw, 140px)',
          fontWeight: 900,
          letterSpacing: '0.08em',
          marginLeft: '0.08em',
        }}
      >
        Ganga
      </div>

      <div style={{ height: 56, display: 'flex', alignItems: 'center' }}>
        <button
          onClick={() => sceneManager.switchTo('intro')}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            padding: '14px 48px',
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '0.15em',
            color: '#f4d9a6',
            background: hover ? 'rgba(217, 171, 99, 0.35)' : 'rgba(20, 12, 4, 0.45)',
            border: '1px solid rgba(244, 217, 166, 0.45)',
            borderRadius: 999,
            cursor: 'pointer',
            pointerEvents: 'auto',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            boxShadow: hover ? '0 4px 18px rgba(0,0,0,0.5)' : '0 2px 10px rgba(0,0,0,0.4)',
            transition:
              'background 0.2s ease, color 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease',
            transform: hover ? 'scale(1.08)' : 'scale(1)',
            textShadow: 'none',
          }}
        >
          JOUER
        </button>
      </div>

      <img
        src="/img/studio.png"
        alt="Studio"
        style={{
          position: 'absolute',
          bottom: 28,
          height: 'clamp(40px, 7vh, 72px)',
          opacity: 0.9,
          filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.5))',
        }}
      />
    </div>
  )
}
