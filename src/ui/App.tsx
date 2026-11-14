import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Trainer } from '../app/trainer'
import { Hud } from './Hud'
import { SettingsPanel } from './SettingsPanel'
import { ControlsHelp } from './ControlsHelp'
import { PlanPanel } from './PlanPanel'
import { HandlingPanel } from './HandlingPanel'

export function App() {
  const [trainer] = useState(() => new Trainer())
  // dev-only handle for debugging and browser tests; stripped from production builds
  if (import.meta.env.DEV) (window as unknown as { __trainer: Trainer }).__trainer = trainer
  useSyncExternalStore(trainer.subscribe, trainer.getVersion)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    return trainer.mount(canvas, stage)
  }, [trainer])

  const s = trainer.session.state
  return (
    <div className="app">
      <header className="topbar">
        <h1>B2B Trainer</h1>
        <span className="muted">spin finder &amp; back-to-back coach</span>
      </header>
      <main className="layout">
        <section className="stage" ref={stageRef}>
          <canvas ref={canvasRef} aria-label="Game board" />
          {s.over && (
            <div className="overlay-msg" role="status">
              <strong>{s.over === 'blockout' ? 'Block out' : 'Lock out'}</strong>
              <span>R to restart · Ctrl+Z / Backspace to undo</span>
            </div>
          )}
        </section>
        <aside className="side">
          <PlanPanel trainer={trainer} />
          <Hud trainer={trainer} />
          <SettingsPanel trainer={trainer} />
          <HandlingPanel trainer={trainer} />
          <ControlsHelp />
        </aside>
      </main>
    </div>
  )
}
