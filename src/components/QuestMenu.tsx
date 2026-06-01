import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { gameStore } from '@/game/gameStore.ts'
import {
  QUESTS,
  getQuestStatus,
  questDepth,
  subscribeQuests,
  type QuestStatus,
} from '@/game/quests.ts'
import {
  ACHIEVEMENTS,
  achievementProgress,
  formatAchievement,
  isComplete,
  isDiscovered,
  subscribeAchievements,
} from '@/game/achievements.ts'
import { clearSave, getSavedAt } from '@/game/save.ts'

// Left-side journal panel. Tab cycles through it: closed → first tab → next
// tab → … → closed. Escape closes it outright. The blur sits only on a left
// strip (no full-screen dim, no colored backdrop) — the game stays visible and
// running to the right.
//
// Two tabs: "Quêtes" draws the quest tree as a node graph (depth = flex row,
// siblings spread horizontally; edges are measured from the real laid-out nodes
// and drawn as an SVG overlay behind the cards). "Hauts faits" lists the
// achievements with their live values and progress bars.

const TABS = [
  { key: 'quests', label: 'Quêtes' },
  { key: 'achievements', label: 'Hauts faits' },
] as const

const COLORS = {
  ink: '#efe7d6',
  inkSoft: 'rgba(239, 231, 214, 0.6)',
  inkFaint: 'rgba(239, 231, 214, 0.3)',
  gold: '#e0b563',
  goldEdge: 'rgba(224, 181, 99, 0.85)',
  faintEdge: 'rgba(239, 231, 214, 0.22)',
}

const ANIM_CSS = `
@keyframes questPanelIn {
  from { opacity: 0; transform: translateX(-24px) }
  to   { opacity: 1; transform: translateX(0) }
}
`

function nodeStyle(status: QuestStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    width: 150,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '10px 12px',
    borderRadius: 12,
    boxSizing: 'border-box',
    position: 'relative',
    backdropFilter: 'blur(2px)',
  }
  if (status === 'done') {
    return { ...base, background: COLORS.gold, border: `1.5px solid ${COLORS.gold}` }
  }
  if (status === 'active') {
    return { ...base, background: '#f3ead8', border: `1.5px solid ${COLORS.goldEdge}` }
  }
  return { ...base, background: '#cdc3b0', border: `1.5px dashed rgba(43, 36, 21, 0.35)` }
}

// Achievement card: a translucent strip, gold-tinted once accomplished.
function achievementCardStyle(done: boolean): React.CSSProperties {
  return {
    padding: '11px 13px',
    borderRadius: 12,
    boxSizing: 'border-box',
    background: done ? 'rgba(224, 181, 99, 0.12)' : 'rgba(43, 36, 21, 0.28)',
    border: `1px solid ${done ? COLORS.goldEdge : COLORS.faintEdge}`,
    backdropFilter: 'blur(2px)',
  }
}

// Round leading badge: ✓ when done, ◆ in progress, ? when still hidden.
function achievementBadgeStyle(done: boolean): React.CSSProperties {
  return {
    flex: '0 0 auto',
    width: 22,
    height: 22,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    fontSize: 11,
    fontWeight: 800,
    background: done ? COLORS.gold : 'rgba(239, 231, 214, 0.12)',
    color: done ? '#2b2415' : COLORS.inkSoft,
  }
}

type Edge = { key: string; d: string; lit: boolean }

export const QuestMenu = () => {
  // -1 = closed; otherwise the active tab index. Tab cycles 0 → … → last →
  // closed; Escape closes outright.
  const [view, setView] = useState(-1)
  const open = view >= 0
  // Bumped on every quest/achievement change to re-render and re-measure edges.
  const [tick, setTick] = useState(0)
  const [edges, setEdges] = useState<Edge[]>([])

  const graphRef = useRef<HTMLDivElement | null>(null)
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map())

  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetAutoClose = () => {
    if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current)
    autoCloseTimer.current = setTimeout(() => setView(-1), 5000)
  }

  useEffect(() => subscribeQuests(() => setTick((n) => n + 1)), [])
  useEffect(() => subscribeAchievements(() => setTick((n) => n + 1)), [])

  // Clear auto-close timer when menu closes; start it when it opens.
  useEffect(() => {
    if (open) {
      resetAutoClose()
    } else if (autoCloseTimer.current) {
      clearTimeout(autoCloseTimer.current)
      autoCloseTimer.current = null
    }
    return () => {
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current)
    }
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        // Swallow Tab always, so it never shifts browser focus off the canvas.
        e.preventDefault()
        if (gameStore.phase === 'playing') {
          setView((v) => {
            const next = v < 0 ? 0 : v + 1 >= TABS.length ? -1 : v + 1
            if (next >= 0) resetAutoClose()
            return next
          })
        }
        return
      }
      if (e.code === 'Escape') setView(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Group quests into depth layers; each layer becomes a flex row.
  const layers = useMemo(() => {
    const out: string[][] = []
    for (const q of QUESTS) (out[questDepth(q.id)] ??= []).push(q.id)
    return out
  }, [])

  // Measure each prerequisite→quest link from the real node positions and draw
  // a bezier between parent-bottom and child-top, in coordinates relative to
  // the graph container (so it scrolls with the nodes).
  useLayoutEffect(() => {
    // Only the quests tab (index 0) has a node graph to measure.
    if (view !== 0) return
    const measure = () => {
      const graph = graphRef.current
      if (!graph) return
      const gb = graph.getBoundingClientRect()
      const next: Edge[] = []
      for (const q of QUESTS) {
        const child = nodeRefs.current.get(q.id)
        if (!child) continue
        const cr = child.getBoundingClientRect()
        const ex = cr.left - gb.left + cr.width / 2
        const ey = cr.top - gb.top
        for (const parentId of q.requires) {
          const parent = nodeRefs.current.get(parentId)
          if (!parent) continue
          const pr = parent.getBoundingClientRect()
          const sx = pr.left - gb.left + pr.width / 2
          const sy = pr.bottom - gb.top
          const midY = (sy + ey) / 2
          next.push({
            key: `${parentId}-${q.id}`,
            d: `M ${sx} ${sy} C ${sx} ${midY}, ${ex} ${midY}, ${ex} ${ey}`,
            lit: getQuestStatus(q.id) !== 'locked',
          })
        }
      }
      setEdges(next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (graphRef.current) ro.observe(graphRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [view, tick])

  if (!open) {
    return (
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: '33%',
          zIndex: 50,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px 8px 12px',
          background: 'rgba(43, 36, 21, 0.45)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          borderRadius: '0 10px 10px 0',
          fontFamily: 'system-ui, sans-serif',
          color: COLORS.inkSoft,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.5,
          textShadow: '0 1px 4px rgba(0,0,0,0.5)',
          opacity: 0.85,
        }}
      >
        Quête{' '}
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(239, 231, 214, 0.15)',
            border: `1px solid ${COLORS.faintEdge}`,
            color: COLORS.ink,
          }}
        >
          tab
        </span>
      </div>
    )
  }

  const savedAt = getSavedAt()
  const savedLabel = savedAt
    ? `Sauvegardé à ${new Date(savedAt).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : 'Aucune sauvegarde'

  const onReset = () => {
    if (!window.confirm('Réinitialiser toute la progression ? Cette action est irréversible.')) {
      return
    }
    clearSave()
    window.location.reload()
  }

  const PANEL_WIDTH = 'min(400px, 92vw)'

  return (
    <>
      <style>{ANIM_CSS}</style>

      {/* Blur layer: a separate, non-animated element so the blur is there the
          instant Tab is pressed (not fading in with the panel). Blurs the game
          behind the strip only, no color fill, and fades out on its right edge
          so it melts into the scene. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: PANEL_WIDTH,
          zIndex: 49,
          pointerEvents: 'none',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          maskImage: 'linear-gradient(to right, black 78%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, black 78%, transparent 100%)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: PANEL_WIDTH,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          padding: '28px 30px',
          boxSizing: 'border-box',
          animation: 'questPanelIn 0.22s cubic-bezier(0.2, 0.8, 0.3, 1)',
          fontFamily: 'system-ui, sans-serif',
          color: COLORS.ink,
        }}
      >
      {/* Header */}
      <div
        style={{
          fontFamily: '"Cinzel Decorative", serif',
          fontSize: 21,
          fontWeight: 900,
          letterSpacing: 1,
          textShadow: '0 2px 8px rgba(0,0,0,0.5)',
        }}
      >
        Carnet de voyage
      </div>

      {/* Tab bar — click a tab or cycle with Tab. The active tab wears a gold
          underline; the others are dimmed. */}
      <div style={{ display: 'flex', gap: 18, margin: '14px 0 16px' }}>
        {TABS.map((t, i) => {
          const active = view === i
          return (
            <button
              key={t.key}
              onClick={() => setView(i)}
              style={{
                background: 'none',
                border: 'none',
                padding: '0 0 6px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                color: active ? COLORS.ink : COLORS.inkFaint,
                borderBottom: `2px solid ${active ? COLORS.gold : 'transparent'}`,
                textShadow: '0 1px 4px rgba(0,0,0,0.5)',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* --- Tab: Quêtes — node graph (scrolls if it overflows). Padding gives
          the corner ✓ badge room so it isn't clipped by the scroll box edges. */}
      {view === 0 && (
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <div ref={graphRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 44, padding: '12px 10px' }}>
          {/* Edges, behind the nodes */}
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
          >
            {edges.map((e) => (
              <path
                key={e.key}
                d={e.d}
                fill="none"
                stroke={e.lit ? COLORS.goldEdge : COLORS.faintEdge}
                strokeWidth={e.lit ? 2 : 1.5}
              />
            ))}
          </svg>

          {layers.map((ids, depth) => (
            <div
              key={depth}
              style={{ display: 'flex', justifyContent: 'center', gap: 18, position: 'relative', zIndex: 1 }}
            >
              {ids.map((id) => {
                const quest = QUESTS.find((q) => q.id === id)!
                const status = getQuestStatus(id)
                const locked = status === 'locked'
                return (
                  <div
                    key={id}
                    ref={(el) => {
                      if (el) nodeRefs.current.set(id, el)
                      else nodeRefs.current.delete(id)
                    }}
                    style={nodeStyle(status)}
                  >
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 700,
                        lineHeight: 1.25,
                        color: locked ? 'rgba(43, 36, 21, 0.55)' : '#1c1408',
                      }}
                    >
                      {locked ? '???' : quest.title}
                    </div>
                    <div style={{ fontSize: 10.5, lineHeight: 1.35, color: 'rgba(43, 36, 21, 0.7)' }}>
                      {locked ? 'À découvrir.' : quest.description}
                    </div>
                    {status === 'done' && (
                      <div
                        style={{
                          position: 'absolute',
                          top: -7,
                          right: -7,
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: '#2b2415',
                          color: COLORS.gold,
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 11,
                          fontWeight: 800,
                        }}
                      >
                        ✓
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      )}

      {/* --- Tab: Hauts faits — achievement list */}
      {view === 1 && (
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: 10, padding: '2px 2px 4px' }}>
          {ACHIEVEMENTS.map((a) => {
            const hidden = a.secret && !isDiscovered(a.id)
            if (hidden) {
              return (
                <div key={a.id} style={achievementCardStyle(false)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={achievementBadgeStyle(false)}>?</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.inkFaint }}>
                      Haut fait secret
                    </div>
                  </div>
                  <div style={{ fontSize: 10.5, color: COLORS.inkFaint, marginTop: 4 }}>
                    À découvrir au fil du voyage.
                  </div>
                </div>
              )
            }
            const done = isComplete(a)
            const progress = achievementProgress(a)
            const showBar = a.kind !== 'bool' && a.goal != null
            return (
              <div key={a.id} style={achievementCardStyle(done)}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={achievementBadgeStyle(done)}>{done ? '✓' : '◆'}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.ink, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                      {a.title}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: done ? COLORS.gold : COLORS.ink, whiteSpace: 'nowrap', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                    {formatAchievement(a)}
                  </div>
                </div>
                <div style={{ fontSize: 10.5, lineHeight: 1.35, color: COLORS.inkSoft, marginTop: 4 }}>
                  {a.description}
                </div>
                {showBar && (
                  <div style={{ height: 4, borderRadius: 2, background: 'rgba(239, 231, 214, 0.15)', marginTop: 8, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${progress * 100}%`, background: COLORS.gold, borderRadius: 2 }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer, pinned to the bottom of the panel */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, paddingTop: 18 }}>
        <span style={{ fontSize: 11, color: COLORS.inkSoft, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
          {savedLabel}
        </span>
        <button
          onClick={onReset}
          style={{
            border: `1px solid ${COLORS.faintEdge}`,
            background: 'transparent',
            color: COLORS.inkSoft,
            fontSize: 11,
            letterSpacing: 0.5,
            padding: '5px 12px',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Réinitialiser
        </button>
      </div>
      </div>
    </>
  )
}
