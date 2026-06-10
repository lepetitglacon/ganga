// JSX cutscene toolkit. A cutscene is a component mounted in the scene:
//
//   <Cutscene id="village-intro" repeat="always" onComplete={...}>
//     <InteractTrigger zone={() => gameStore.npcZone} prompt="F pour parler" />
//     <Step>
//       <PanTo focus={() => npcCenter()} offset={[9, 5, 9]} />
//       <Say speaker="L'Ancien">On a plus d'eau…</Say>
//     </Step>
//   </Cutscene>
//
// Steps run in order; everything inside a step runs in parallel. Triggers
// decide when it fires; the director (game/director.ts) keeps one cutscene
// active at a time and handles advance/skip input.

export { Cutscene, type CutsceneProps, type CutsceneRepeat } from './Cutscene.tsx'
export { Step, type StepProps } from './Step.tsx'
export { ZoneTrigger, InteractTrigger, EventTrigger, type Zone } from './triggers.tsx'
export {
  PanTo,
  Orbit,
  Tween,
  Wait,
  Action,
  Say,
  Spawn,
  type Ease,
  type PanToProps,
  type OrbitProps,
  type TweenProps,
  type SayProps,
} from './actions.tsx'
export { useCutsceneAction, type ActionImpl } from './useCutsceneAction.ts'
