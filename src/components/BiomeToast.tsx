import { useEffect, useState } from 'react'
import { subscribeBiomeChange } from '@/game/biomes.ts'

// Transient centered banner that fades in the biome's name whenever the bird
// crosses into a new biome, then fades out. Mirrors the QuestToast palette.

const COLORS = {
  ink: '#1c1408',
  gold: '#e0b563',
  goldEdge: 'rgba(224, 181, 99, 0.85)',
  panel: 'rgba(243, 234, 216, 0.92)',
}

const VISIBLE_MS = 3500

const ANIM_CSS = `
@keyframes biomeToastIn {
  from { opacity: 0; transform: translate(-50%, -12px) }
  to   { opacity: 1; transform: translate(-50%, 0) }
}
@keyframes biomeToastOut {
  from { opacity: 1; transform: translate(-50%, 0) }
  to   { opacity: 0; transform: translate(-50%, -12px) }
}
`

export const BiomeToast = () => {
  const [toast, setToast] = useState<{ key: number; label: string } | null>(null)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout>
    let removeTimer: ReturnType<typeof setTimeout>
    const unsub = subscribeBiomeChange((b) => {
      clearTimeout(hideTimer)
      clearTimeout(removeTimer)
      setLeaving(false)
      setToast({ key: Date.now(), label: b.label })
      hideTimer = setTimeout(() => setLeaving(true), VISIBLE_MS)
      removeTimer = setTimeout(() => setToast(null), VISIBLE_MS + 400)
    })
    return () => {
      unsub()
      clearTimeout(hideTimer)
      clearTimeout(removeTimer)
    }
  }, [])

  if (!toast) return null

  return (
    <>
      <style>{ANIM_CSS}</style>
      <div
        key={toast.key}
        style={{
          position: 'absolute',
          left: '50%',
          top: 72,
          transform: 'translateX(-50%)',
          zIndex: 55,
          padding: '10px 26px',
          borderRadius: 999,
          background: COLORS.panel,
          border: `1.5px solid ${COLORS.goldEdge}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          backdropFilter: 'blur(2px)',
          animation: leaving
            ? 'biomeToastOut 0.4s cubic-bezier(0.4, 0, 1, 1) forwards'
            : 'biomeToastIn 0.4s cubic-bezier(0.2, 0.8, 0.3, 1)',
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: 'rgba(43, 36, 21, 0.55)',
          }}
        >
          Vous entrez dans
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.ink, letterSpacing: 0.5 }}>
          {toast.label}
        </div>
      </div>
    </>
  )
}
