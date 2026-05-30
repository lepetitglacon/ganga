// Village intro cutscene: the elder bird tells you the well has run dry and
// sends you out to ferry water back in your feathers. Each step frames a focus
// point (the NPC, then the reservoir) and shows one line of dialogue. The
// Cutscene component drives the camera; the HUD reads the current line.

export type CutsceneFocus = 'npc' | 'reservoir'

export type CutsceneStep = {
  focus: CutsceneFocus
  text: string
}

export const VILLAGE_INTRO_CUTSCENE: CutsceneStep[] = [
  { focus: 'npc', text: "On a plus d'eau…" },
  {
    focus: 'reservoir',
    text:
      "Tu es le seul qui peut transporter de l'eau avec tes plumes, va nous en chercher en dehors du village.",
  },
]
