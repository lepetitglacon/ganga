import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/cinzel-decorative/400.css'
import '@fontsource/cinzel-decorative/700.css'
import '@fontsource/cinzel-decorative/900.css'
import './index.css'
import App from './App.tsx'
import { loadGame, installSave } from './game/save.ts'

// Restore progression and wire autosave before the world mounts, so loaded
// flags (skip-source-cutscene, reservoir-already-full) are in place by the time
// components read them.
loadGame()
installSave()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
