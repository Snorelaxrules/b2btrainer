import { useEffect, useState } from 'react'
import type { Trainer } from '../app/trainer'
import { parseQueue } from '../engine/game'

/** Buttons give focus back to the game so Space doesn't re-click them. */
function blurAfter(fn: () => void) {
  return (e: React.MouseEvent<HTMLElement>) => {
    fn()
    e.currentTarget.blur()
  }
}

function blurOnEnter(apply: () => void) {
  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      apply()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.currentTarget.blur()
    }
  }
}

export function SettingsPanel({ trainer }: { trainer: Trainer }) {
  const st = trainer.settings
  const [seedText, setSeedText] = useState(String(st.seed))
  const [queueText, setQueueText] = useState(st.customQueue)
  // follow seed changes made elsewhere (R rolls a new seed)
  useEffect(() => setSeedText(String(st.seed)), [st.seed])

  const applySeedAndRestart = () => {
    const n = Number.parseInt(seedText, 10)
    if (Number.isFinite(n) && n > 0) trainer.update({ seed: n })
    else setSeedText(String(trainer.settings.seed))
    trainer.update({ customQueue: queueText })
    trainer.restart(false)
  }

  const queuePreview = parseQueue(queueText).join('')
  return (
    <div className="panel">
      <h2>Game</h2>
      <label className="field">
        <span>Seed</span>
        <input
          inputMode="numeric"
          value={seedText}
          onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={blurOnEnter(applySeedAndRestart)}
        />
      </label>
      <div className="row">
        <button onClick={blurAfter(applySeedAndRestart)}>Restart same seed</button>
        <button onClick={blurAfter(() => trainer.restart(true))}>New seed</button>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={st.lockSeed}
          onChange={(e) => {
            trainer.update({ lockSeed: e.target.checked })
            e.currentTarget.blur()
          }}
        />
        <span>R keeps this seed</span>
      </label>

      <label className="field">
        <span>Custom queue</span>
        <input
          placeholder="e.g. TILJSZO"
          value={queueText}
          spellCheck={false}
          onChange={(e) => setQueueText(e.target.value.toUpperCase())}
          onKeyDown={blurOnEnter(applySeedAndRestart)}
        />
      </label>
      <p className="muted small">
        {queuePreview ? `Starts with ${queuePreview}, then the seeded bag.` : 'Forces the first pieces; Enter restarts.'}
      </p>

      <label className="field">
        <span>Gravity</span>
        <select
          value={st.gravity}
          onChange={(e) => {
            trainer.update({ gravity: e.target.value === 'normal' ? 'normal' : 'none' })
            e.currentTarget.blur()
          }}
        >
          <option value="none">None (lock on hard drop only)</option>
          <option value="normal">Normal (0.5 s lock delay, 15 resets)</option>
        </select>
      </label>
    </div>
  )
}
