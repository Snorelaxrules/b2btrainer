import { useEffect, useState } from 'react'
import type { Trainer } from '../app/trainer'
import { surgeFor } from '../engine/scoring'
import type { Placement } from '../engine/game'

/** Re-render on an interval for time-based stats (PPS, APM), never per frame. */
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

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={accent ? 'accent' : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/** "TSD +5 B2B ×6" */
export function describePlacement(p: Placement): string {
  const r = p.result
  const parts = [r.label]
  if (r.attack) parts.push(`+${r.attack}`)
  if (r.after.b2b >= 1 && r.lines) parts.push(`B2B ×${r.after.b2b}`)
  if (r.after.combo >= 1) parts.push(`${r.after.combo} combo`)
  if (r.surge) parts.push(`surge ${r.surge}`)
  if (r.b2bChange === 'broken') parts.push('B2B broken')
  return parts.join(' ')
}

const TONE: Record<string, string> = { kept: 'good', started: 'good', broken: 'bad', unchanged: 'setup', none: '' }

export function Hud({ trainer }: { trainer: Trainer }) {
  useClock(250)
  const s = trainer.session.state
  const t = trainer.elapsed()
  const pps = t > 0 ? s.stats.pieces / t : 0
  const apm = t > 0 ? (s.stats.attack / t) * 60 : 0
  const { b2b, combo } = s.counters
  const surge = surgeFor(b2b)
  return (
    <div className="panel">
      <h2>Stats</h2>
      <dl className="stats">
        <Stat label="B2B" value={b2b >= 1 ? `×${b2b}` : b2b === 0 ? 'ready' : '—'} accent={b2b >= 1} />
        <Stat label="Surge" value={surge ? surge : '—'} accent={surge > 0} />
        <Stat label="Combo" value={combo >= 1 ? combo : '—'} />
        <Stat label="Attack" value={s.stats.attack} />
        <Stat label="APM" value={apm.toFixed(1)} />
        <Stat label="PPS" value={pps.toFixed(2)} />
        <Stat label="Pieces" value={s.stats.pieces} />
        <Stat label="Lines" value={s.stats.lines} />
        <Stat label="Time" value={fmtTime(t)} />
      </dl>
      <h3>Recent</h3>
      {s.recent.length === 0 ? (
        <p className="muted small">Clears and spins show up here.</p>
      ) : (
        <ol className="recent">
          {s.recent.map((p) => (
            <li key={p.n} className={TONE[p.result.b2bChange]}>
              <span className="n">#{p.n}</span> {describePlacement(p)}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
