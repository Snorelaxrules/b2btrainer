import { useSyncExternalStore } from 'react'
import { BEAM_PRESETS } from '../app/planner'
import type { Trainer } from '../app/trainer'
import { MOVE_LABEL } from '../engine/movegen'
import type { Plan, PlanStep } from '../engine/planner'
import { PIECE_COLORS } from '../config/theme'

function PieceChip({ type }: { type: string }) {
  return (
    <span className="chip" style={{ background: PIECE_COLORS[type as keyof typeof PIECE_COLORS] }}>
      {type}
    </span>
  )
}

function stepText(st: PlanStep) {
  const r = st.result
  if (r.lines || r.spin !== 'none') {
    const extra = r.lines && r.attack ? ` +${r.attack}` : ''
    return `${r.label}${extra}`
  }
  return 'place'
}

function Step({ st, payoff }: { st: PlanStep; payoff: boolean }) {
  const keys = [...(st.viaHold ? (['hold'] as const) : []), ...st.path, 'hardDrop' as const]
  const r = st.result
  return (
    <li className={payoff ? 'payoff' : r.b2bChange === 'broken' ? 'bad' : undefined}>
      <div className="step-head">
        <span className="step-n">{st.n}</span>
        <PieceChip type={st.type} />
        <span className="step-what">
          {st.viaHold ? 'hold → ' : ''}
          {stepText(st)}
        </span>
        {r.lines > 0 && (
          <span className={`step-b2b ${r.b2bChange}`}>
            {r.b2bChange === 'broken' ? 'B2B broken' : r.after.b2b >= 1 ? `B2B ×${r.after.b2b}` : 'B2B starts'}
          </span>
        )}
      </div>
      <div className="keyseq">
        {keys.map((k, i) => (
          <kbd key={i}>{MOVE_LABEL[k]}</kbd>
        ))}
      </div>
    </li>
  )
}

function PlanButton({ p, i, on, onClick }: { p: Plan; i: number; on: boolean; onClick: () => void }) {
  return (
    <button className={`plan-btn${on ? ' on' : ''}`} onClick={onClick} aria-pressed={on}>
      <span className="plan-letter">{String.fromCharCode(65 + i)}</span>
      <span className="plan-sum">
        {p.followed ? '✓ ' : ''}
        {p.summary}
      </span>
    </button>
  )
}

export function PlanPanel({ trainer }: { trainer: Trainer }) {
  const pl = trainer.planner
  useSyncExternalStore(pl.subscribe, pl.getVersion)
  const st = pl.settings
  const plan = pl.plan
  const blur = (e: { currentTarget: HTMLElement }) => e.currentTarget.blur()
  const gravity = trainer.settings.gravity === 'normal'

  return (
    <div className="panel plan">
      <div className="panel-head">
        <h2>Spin plan</h2>
        <button
          className={pl.active ? 'on' : undefined}
          aria-pressed={pl.active}
          onClick={(e) => {
            pl.toggle(trainer.session.state, trainer.settings.spinRule)
            blur(e)
          }}
        >
          {pl.active ? 'Stop' : 'Find setup'} <kbd>P</kbd>
        </button>
      </div>

      <div className="row plan-opts">
        <label>
          Pieces{' '}
          <select
            value={st.depth}
            onChange={(e) => {
              trainer.setPlanner({ depth: Number(e.target.value) })
              blur(e)
            }}
          >
            {[1, 2, 3, 4, 5, 6].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search{' '}
          <select
            value={st.beam}
            onChange={(e) => {
              trainer.setPlanner({ beam: Number(e.target.value) })
              blur(e)
            }}
          >
            {BEAM_PRESETS.map((b) => (
              <option key={b.beam} value={b.beam}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        {pl.active && (
          <span className="status" aria-live="polite">
            {pl.running ? (
              <>
                <span className="spinner" aria-hidden="true" /> {pl.depthDone}/{st.depth}
              </>
            ) : pl.following ? null : (
              `${(pl.ms / 1000).toFixed(2)} s`
            )}
          </span>
        )}
      </div>

      {pl.note && <p className="plan-note">{pl.note}</p>}

      {!pl.active && !pl.note && (
        <p className="muted small">
          Play normally. Press <kbd>P</kbd> when you want a spin setup from the current position: the planner looks at
          your piece, hold and the next {Math.min(5, st.depth)} previews only.
        </p>
      )}

      {pl.active && pl.following && plan && (
        <div className="following">
          <span>
            <strong>Following</strong> · {plan.steps.length} step{plan.steps.length === 1 ? '' : 's'} left
          </span>
          <button
            onClick={(e) => {
              trainer.replan()
              blur(e)
            }}
          >
            New plan
          </button>
        </div>
      )}

      {pl.active && !pl.following && pl.plans.length > 0 && (
        <div className="plan-list">
          {pl.plans.map((p, i) => (
            <PlanButton
              key={i}
              p={p}
              i={i}
              on={i === pl.selected}
              onClick={() => {
                pl.select(i)
                ;(document.activeElement as HTMLElement | null)?.blur()
              }}
            />
          ))}
        </div>
      )}
      {pl.active && !pl.following && !pl.plans.length && pl.running && <p className="muted small">Searching…</p>}

      {plan && (
        <ol className="steps">
          {plan.steps.map((s, i) => (
            <Step key={s.n} st={s} payoff={plan.payoffs.includes(i)} />
          ))}
        </ol>
      )}

      {pl.active && (
        <p className="muted small">
          {gravity && <strong className="warn">Gravity is on: plans assume unlimited time and may not be playable. </strong>}
          Numbers on the board are placement order (H = hold first). Play step 1 (or hold, for an H step) to lock the
          plan; it stays until it pays off or you leave it. Tab switches plans before you commit. Release ←/→ before
          rotating after a DAS, or the held direction slides the piece again.
        </p>
      )}
      {import.meta.env.DEV && (
        <p className="dev small">
          dev · every plan shown is replayed through the engine · discarded this session: {pl.discardedTotal}
        </p>
      )}
    </div>
  )
}
