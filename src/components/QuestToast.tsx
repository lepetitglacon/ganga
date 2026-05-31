import { useEffect, useState } from 'react'
import { getQuest, subscribeQuestComplete } from '@/game/quests.ts'

// Transient popup that slides in from the left whenever a quest is completed,
// echoing the Carnet de quêtes palette/typography. Shows the quest title with a
// ✓ badge, then auto-dismisses after 5s. Stays mounted across toasts so a fresh
// completion can replace the current one.

const COLORS = {
  ink: '#1c1408',
  gold: '#e0b563',
  goldEdge: 'rgba(224, 181, 99, 0.85)',
  panel: '#f3ead8',
}

const VISIBLE_MS = 5000

const ANIM_CSS = `
@keyframes questToastIn {
  from { opacity: 0; transform: translateX(-110%) }
  to   { opacity: 1; transform: translateX(0) }
}
@keyframes questToastOut {
  from { opacity: 1; transform: translateX(0) }
  to   { opacity: 0; transform: translateX(-110%) }
}
`

export const QuestToast = () => {
  // The completed quest's title, plus a key so re-completing re-triggers the
  // slide-in animation. `leaving` drives the slide-out before unmount.
  const [toast, setToast] = useState<{ key: number; title: string } | null>(null)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout>
    let removeTimer: ReturnType<typeof setTimeout>
    const unsub = subscribeQuestComplete((id) => {
      const quest = getQuest(id)
      if (!quest) return
      clearTimeout(hideTimer)
      clearTimeout(removeTimer)
      setLeaving(false)
      setToast({ key: Date.now(), title: quest.title })
      hideTimer = setTimeout(() => setLeaving(true), VISIBLE_MS)
      removeTimer = setTimeout(() => setToast(null), VISIBLE_MS + 300)
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
          left: 24,
          top: 28,
          zIndex: 60,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 18px 12px 14px',
          borderRadius: 12,
          background: COLORS.panel,
          border: `1.5px solid ${COLORS.goldEdge}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          fontFamily: 'system-ui, sans-serif',
          animation: leaving
            ? 'questToastOut 0.3s cubic-bezier(0.4, 0, 1, 1) forwards'
            : 'questToastIn 0.3s cubic-bezier(0.2, 0.8, 0.3, 1)',
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            flexShrink: 0,
            borderRadius: '50%',
            background: '#2b2415',
            color: COLORS.gold,
            display: 'grid',
            placeItems: 'center',
            fontSize: 14,
            fontWeight: 800,
          }}
        >
          ✓
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: 'rgba(43, 36, 21, 0.6)',
            }}
          >
            Quête accomplie
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.ink }}>{toast.title}</div>
        </div>
      </div>
    </>
  )
}
