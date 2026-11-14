import { HANDLING, HANDLING_LIMITS, type Handling, fromFrames, toFrames } from '../config/handling'
import type { Trainer } from '../app/trainer'

type FrameKey = 'das' | 'arr' | 'dcd'

const ROWS: { key: FrameKey; label: string; hint: string }[] = [
  { key: 'das', label: 'DAS', hint: 'delay before a held direction auto-repeats' },
  { key: 'arr', label: 'ARR', hint: 'time between auto-repeat moves (0 = straight to the wall)' },
  { key: 'dcd', label: 'DCD', hint: 'pause auto-shift after a rotate, hold or new piece (0 = never)' },
]

/** Let go of the slider's keyboard focus, so arrow keys go back to the game. */
const release = (e: { currentTarget: HTMLElement }) => e.currentTarget.blur()
/** keyboard users adjust with the arrows, then Enter/Escape hands the keys back to the game */
const releaseOnKey = (e: React.KeyboardEvent<HTMLElement>) => {
  if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
}

export function HandlingPanel({ trainer }: { trainer: Trainer }) {
  const h = trainer.settings.handling
  const set = (patch: Partial<Handling>) => trainer.setHandling(patch)
  const sdfMax = HANDLING_LIMITS.sdf.max
  const sdfValue = Number.isFinite(h.sdf) ? h.sdf : sdfMax + 1
  return (
    <details className="panel">
      <summary>
        <h2>Handling</h2>
      </summary>
      {ROWS.map(({ key, label, hint }) => {
        const lim = HANDLING_LIMITS[key]
        const frames = toFrames(h[key])
        return (
          <label className="slider" key={key} title={hint}>
            <span className="slider-label">{label}</span>
            <input
              type="range"
              min={lim.min}
              max={lim.max}
              step={lim.step}
              value={frames}
              onChange={(e) => set({ [key]: fromFrames(Number(e.target.value)) })}
              onPointerUp={release}
              onKeyDown={releaseOnKey}
            />
            <span className="slider-value">
              {frames.toFixed(1)}F <small>{Math.round(h[key])} ms</small>
            </span>
          </label>
        )
      })}
      <label className="slider" title="soft drop speed multiplier (∞ = straight to the floor)">
        <span className="slider-label">SDF</span>
        <input
          type="range"
          min={HANDLING_LIMITS.sdf.min}
          max={sdfMax + 1}
          step={1}
          value={sdfValue}
          onChange={(e) => {
            const v = Number(e.target.value)
            set({ sdf: v > sdfMax ? Infinity : v })
          }}
          onPointerUp={release}
          onKeyDown={releaseOnKey}
        />
        <span className="slider-value">{Number.isFinite(h.sdf) ? `${h.sdf}×` : '∞'}</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={h.carryDas}
          onChange={(e) => {
            set({ carryDas: e.target.checked })
            e.currentTarget.blur()
          }}
        />
        <span>Keep DAS charge into the next piece</span>
      </label>
      <div className="row">
        <button
          onClick={(e) => {
            set({ ...HANDLING })
            e.currentTarget.blur()
          }}
        >
          Reset (DAS 4.5F, ARR 0, DCD 0, SDF ∞)
        </button>
      </div>
      <p className="muted small">
        Frames at 60 fps, like TETR.IO's settings. Applied instantly and saved in this browser. With a slider focused,
        arrows adjust it; Enter or Esc returns the keys to the game.
      </p>
    </details>
  )
}
