import { useEffect, useState } from 'react'
import type { Trainer } from '../app/trainer'

/** Re-render on an interval for time-based stats (PPS), never per frame. */
function useClock(ms: number) {
  const [, setT] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setT((t) => t + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

export function Hud({ trainer }: { trainer: Trainer }) {
  useClock(250)
  const s = trainer.session.state
  const t = trainer.elapsed()
  const pps = t > 0 ? s.stats.pieces / t : 0
  return (
    <div className="panel">
      <h2>Stats</h2>
      <dl className="stats">
        <div>
          <dt>Pieces</dt>
          <dd>{s.stats.pieces}</dd>
        </div>
        <div>
          <dt>Lines</dt>
          <dd>{s.stats.lines}</dd>
        </div>
        <div>
          <dt>PPS</dt>
          <dd>{pps.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{fmtTime(t)}</dd>
        </div>
        <div>
          <dt>Undo</dt>
          <dd>{trainer.session.undoDepth}</dd>
        </div>
      </dl>
      <p className="muted small">B2B, combo, attack and APM arrive with scoring (step 2).</p>
    </div>
  )
}
