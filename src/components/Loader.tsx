import { useEffect, useState } from 'react'
import { gameStore } from '@/game/gameStore.ts'

// Loading / title overlay shown over the cinematic desert fly-over. Its
// background is transparent so the 3D intro camera stays visible behind it.
// "Chargement" until the world is ready, then a "Jouer" button that flips the
// game into 'playing' (IntroSequence picks that up and glides onto the bird).
export const Loader = () => {
  const [ready, setReady] = useState(false)
  // Drives the opacity fade-out, then a full unmount once the glide is underway.
  const [leaving, setLeaving] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [hover, setHover] = useState(false)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      setReady(gameStore.assetsReady)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  if (hidden) return null

  const onPlay = () => {
    if (!ready) return
    gameStore.phase = 'playing'
    // Lock the camera straight away — the click is a valid user gesture, so the
    // bird is steerable through the transition without a second click on the
    // canvas (which the overlay is still covering during the fade).
    const canvas = document.getElementById('main-canvas') as HTMLCanvasElement | null
    canvas?.requestPointerLock?.()
    setLeaving(true)
    // Unmount after the fade so the canvas (pointer-lock on click) is free.
    setTimeout(() => setHidden(true), 700)
  }

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
        opacity: leaving ? 0 : 1,
        transition: 'opacity 0.7s ease',
        // Block the canvas (no stray pointer-lock) while the overlay is up.
        pointerEvents: 'auto',
        userSelect: 'none',
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
        {ready ? (
          <button
            onClick={onPlay}
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
        ) : (
          <div style={{ fontSize: 18, letterSpacing: '0.25em', opacity: 0.85 }}>
            CHARGEMENT
            <span className="ganga-loader-dots" />
          </div>
        )}
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

      <style>{`
        .ganga-loader-dots::after {
          content: '';
          animation: ganga-dots 1.4s steps(4, end) infinite;
        }
        @keyframes ganga-dots {
          0% { content: ''; }
          25% { content: '.'; }
          50% { content: '..'; }
          75% { content: '...'; }
          100% { content: ''; }
        }
      `}</style>
    </div>
  )
}
