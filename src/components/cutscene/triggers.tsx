import { useEffect, useRef } from 'react'
import type { Vector3 } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'
import { director } from '@/game/director.ts'
import { useCutsceneCtx } from './context.ts'

// Trigger components: direct children of <Cutscene> that decide when it fires.
// Their poll runs once per frame while the cutscene is idle and armed (right
// phase, no other cinematic, repeat not spent).

export type Zone = { center: Vector3; radius: number }

// XZ proximity test against the player's physics body, mirroring how the old
// hand-rolled cutscenes detected the player.
function inZone(zone: Zone | null): boolean {
  const body = gameStore.physics?.playerBody
  if (!zone || !body) return false
  const t = body.translation()
  const dx = t.x - zone.center.x
  const dz = t.z - zone.center.z
  return dx * dx + dz * dz <= zone.radius * zone.radius
}

// Fires as soon as the player enters the zone (flying or not). The zone is a
// function because it's usually loaded into gameStore after the GLB mounts.
export const ZoneTrigger = ({ zone }: { zone: () => Zone | null }) => {
  const ctx = useCutsceneCtx()
  const zoneRef = useRef(zone)
  zoneRef.current = zone

  useEffect(
    () => ctx.registerTrigger(() => inZone(zoneRef.current())),
    [ctx.registerTrigger],
  )
  return null
}

// Shows `prompt` in the HUD while the grounded player stands in the zone, and
// fires when they press F.
export const InteractTrigger = ({
  zone,
  prompt = 'F pour parler',
}: {
  zone: () => Zone | null
  prompt?: string
}) => {
  const ctx = useCutsceneCtx()
  const zoneRef = useRef(zone)
  zoneRef.current = zone
  const promptRef = useRef(prompt)
  promptRef.current = prompt
  const insideRef = useRef(false)
  const pressedRef = useRef(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyF') return
      if (!insideRef.current || director.activeId) return
      e.preventDefault()
      pressedRef.current = true
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (director.prompt === promptRef.current) director.prompt = null
    }
  }, [])

  useEffect(
    () =>
      ctx.registerTrigger(() => {
        const inside = gameStore.birdMode === 'grounded' && inZone(zoneRef.current())
        insideRef.current = inside
        if (inside) director.prompt = promptRef.current
        else if (director.prompt === promptRef.current) director.prompt = null

        const fire = inside && pressedRef.current
        pressedRef.current = false
        if (fire && director.prompt === promptRef.current) director.prompt = null
        return fire
      }),
    [ctx.registerTrigger],
  )
  return null
}

// Fires when `poll` returns true — the bridge for game events. The poll should
// consume one-shot flags itself, e.g.:
//   poll={() => gameStore.reservoirJustFilled && !(gameStore.reservoirJustFilled = false)}
export const EventTrigger = ({ poll }: { poll: () => boolean }) => {
  const ctx = useCutsceneCtx()
  const pollRef = useRef(poll)
  pollRef.current = poll

  useEffect(
    () => ctx.registerTrigger(() => pollRef.current()),
    [ctx.registerTrigger],
  )
  return null
}
