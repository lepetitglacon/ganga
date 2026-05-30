import { useEffect, useState } from 'react'
import { gameStore } from '@/game/gameStore.ts'

export const HUD = () => {
  const [speed, setSpeed] = useState(0)
  const [cooldown, setCooldown] = useState(0)
  const [flying, setFlying] = useState(false)
  const [water, setWater] = useState(1)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      setSpeed(gameStore.speed)
      setCooldown(gameStore.flapCooldown)
      setFlying(gameStore.birdMode !== 'grounded')
      setWater(gameStore.water)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const onCooldown = cooldown > 0
  const disabled = !flying || onCooldown

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        fontFamily: 'system-ui, sans-serif',
        color: '#fff',
        textShadow: '0 1px 3px rgba(0,0,0,0.7)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          padding: '8px 12px',
          background: 'rgba(0,0,0,0.35)',
          borderRadius: 8,
          fontSize: 14,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <div style={{ opacity: 0.7, fontSize: 11, letterSpacing: 1 }}>SPEED</div>
        <div style={{ fontSize: 22, fontWeight: 600 }}>{(speed * 3.6).toFixed(0)} km/h</div>

        <div style={{ opacity: 0.7, fontSize: 11, letterSpacing: 1, marginTop: 10 }}>
          WATER
        </div>
        <div
          style={{
            width: 120,
            height: 8,
            marginTop: 4,
            borderRadius: 4,
            background: 'rgba(255,255,255,0.15)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.round(water * 100)}%`,
              height: '100%',
              borderRadius: 4,
              background:
                water < 0.2
                  ? '#e0533d'
                  : 'linear-gradient(90deg, #2e8b8b, #6fd0d0)',
              transition: 'width 0.2s linear, background 0.3s',
            }}
          />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '8px 18px',
          borderRadius: 10,
          border: `1px solid ${disabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.5)'}`,
          background: disabled ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.5)',
          color: disabled ? 'rgba(255,255,255,0.35)' : '#fff',
          fontSize: 14,
          letterSpacing: 2,
          fontWeight: 600,
          transition: 'all 0.15s',
        }}
      >
        ESPACE
        {onCooldown && (
          <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>
            {cooldown.toFixed(2)}s
          </span>
        )}
      </div>
    </div>
  )
}
