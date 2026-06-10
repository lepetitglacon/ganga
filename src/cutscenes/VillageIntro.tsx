import { Vector3 } from '@babylonjs/core'
import { Cutscene, InteractTrigger, PanTo, Say, Step } from '@/components/cutscene/index.ts'
import { gameStore } from '@/game/gameStore.ts'
import { completeQuest } from '@/game/quests.ts'
import { RESERVOIRS } from '@/game/reservoir.ts'

// Village intro: the elder bird tells you the well has run dry and sends you
// out to ferry water back in your feathers. Started by pressing F next to the
// talking bird ("Armature", zone set by Map); replayable — the villager can
// always be talked to again.

// The NPC is framed from a few steps back; the reservoir from higher up and
// further out so its empty bowl reads.
const NPC_CAM_OFFSET: [number, number, number] = [9, 5, 9]
const RES_CAM_OFFSET: [number, number, number] = [-15, 17, -15]

const npcFocus = () => gameStore.npcZone?.center.clone() ?? Vector3.Zero()

const reservoirFocus = () => {
  if (RESERVOIRS.length > 0) {
    const r = RESERVOIRS[0]
    return r.min.add(r.max).scale(0.5)
  }
  return npcFocus()
}

export const VillageIntro = () => (
  <Cutscene
    id="village-intro"
    repeat="always"
    fov={0.9}
    onComplete={() => completeQuest('meet-village')}
  >
    <InteractTrigger zone={() => gameStore.npcZone} prompt="F pour parler" />

    <Step>
      <PanTo focus={npcFocus} offset={NPC_CAM_OFFSET} />
      <Say>On a plus d'eau…</Say>
    </Step>

    <Step>
      <PanTo focus={reservoirFocus} offset={RES_CAM_OFFSET} />
      <Say>
        Tu es le seul qui peut transporter de l'eau avec tes plumes, va nous en chercher en
        dehors du village.
      </Say>
    </Step>
  </Cutscene>
)
