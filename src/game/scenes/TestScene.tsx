import { useEffect } from 'react'
import { LightSetup } from '@/components/LightSetup.tsx'
import { Environment } from '@/components/Environment.tsx'
import { Map } from '@/components/Map.tsx'
import { Player } from '@/components/Player.tsx'
import { Clouds } from '@/components/Clouds.tsx'
import { HUD } from '@/components/HUD.tsx'
import { QuestMenu } from '@/components/QuestMenu.tsx'
import { QuestToast } from '@/components/QuestToast.tsx'
import { Loader } from '@/components/Loader.tsx'
import { MuteButton } from '@/components/MuteButton.tsx'
import { audio } from '@/game/audio.ts'
import { subscribeQuestUnlock } from '@/game/quests.ts'
import type { GameScene } from '@/game/scenes/types.ts'

const UNLOCK_SOUND_URL = '/sound/quests/unlock-quest.wav'

const TestSceneContent = () => (
  <>
    <LightSetup />
    <Environment />
    <Map />
    <Player />
    <Clouds count={16} />
  </>
)

const TestOverlay = () => {
  useEffect(() => subscribeQuestUnlock(() => audio.playOneShot(UNLOCK_SOUND_URL)), [])

  return (
    <>
      <HUD />
      <QuestMenu />
      <QuestToast />
      <Loader />
      <MuteButton />
    </>
  )
}

export const testScene: GameScene = {
  id: 'test',
  label: 'TEST',
  SceneContent: TestSceneContent,
  Overlay: TestOverlay,
}
