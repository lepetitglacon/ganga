import { useRef } from 'react'
import { Vector3 } from '@babylonjs/core'
import { Cutscene, Orbit, Step, Tween, ZoneTrigger } from '@/components/cutscene/index.ts'
import { gameStore } from '@/game/gameStore.ts'
import { completeQuest } from '@/game/quests.ts'

// When the player first walks into the source's footprint, the camera lifts off
// the bird and laps once around the spring while its water surface (Plan.001)
// rises up to the "waterY" empty — the source filling back up. Plays once per
// scene load.

const DURATION = 11 // seconds — total camera tour
const ORBIT_SPEED = 0.32 // rad/s — slow, gentle pan (~200° over DURATION)
const WATER_RISE_DURATION = 3.5 // the water settles early, the camera keeps circling
// Orbit framing derived from the footprint radius.
const RADIUS_MUL = 2.0
const HEIGHT_PAD = 16

export const SourceRising = () => {
  // Absolute XZ of the water plane, captured at start so we only drive its Y.
  const waterXZRef = useRef(new Vector3())

  return (
    <Cutscene
      id="source-rising"
      repeat="once"
      fov={0.9}
      onComplete={() => completeQuest('find-source')}
    >
      <ZoneTrigger zone={() => gameStore.sourceZone} />

      <Step>
        <Orbit
          center={() => gameStore.sourceZone!.center}
          radius={() => gameStore.sourceZone!.radius * RADIUS_MUL}
          height={() => gameStore.sourceZone!.radius + HEIGHT_PAD}
          speed={ORBIT_SPEED}
          duration={DURATION}
        />
        <Tween
          duration={WATER_RISE_DURATION}
          ease="smoothstep"
          blocking={false}
          onStart={() => {
            const water = gameStore.sourceWater
            if (!water) return
            water.plane.computeWorldMatrix(true)
            waterXZRef.current.copyFrom(water.plane.getAbsolutePosition())
          }}
          onUpdate={(t) => {
            const water = gameStore.sourceWater
            if (!water) return
            const y = water.startY + (water.targetY - water.startY) * t
            const xz = waterXZRef.current
            water.plane.setAbsolutePosition(new Vector3(xz.x, y, xz.z))
          }}
        />
      </Step>
    </Cutscene>
  )
}
