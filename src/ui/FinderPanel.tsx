import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Trainer } from '../app/trainer'
import { type Candidate, type Category, cellsAfterClear } from '../engine/finder'
import { MOVE_LABEL } from '../engine/movegen'
import type { B2BChange } from '../engine/scoring'
import { CATEGORY_STYLE } from '../render/finderOverlay'
import { drawBoardPreview } from '../render/preview'

const ROT_NAME = ['0', 'R', '2', 'L']

const B2B_TEXT: Record<B2BChange, string> = {
  started: 'starts B2B',
  kept: 'keeps B2B',
  broken: 'BREAKS B2B',
  none: 'no B2B',
  unchanged: 'B2B unchanged',
}

function b2bShow(n: number) {
  return n < 0 ? '–' : n === 0 ? '0 (ready)' : `×${n}`
}

function Swatch({ cat }: { cat: Category }) {
  const st = CATEGORY_STYLE[cat]
  return (
    <svg width="22" height="12" aria-hidden="true">
      <rect
        x="2"
        y="2"
        width="18"
        height="8"
        fill="none"
        stroke={st.color}
        strokeWidth={Math.min(st.width, 2.5)}
        strokeDasharray={st.dash.join(' ')}
      />
    </svg>
  )
}

function Keys({ c }: { c: Candidate }) {
  const keys = [...(c.viaHold ? (['hold'] as const) : []), ...c.path, 'hardDrop' as const]
  return (
    <div className="keyseq">
      {keys.map((k, i) => (
        <kbd key={i}>{MOVE_LABEL[k]}</kbd>
      ))}
    </div>
  )
}

function Readout({ c, trainer }: { c: Candidate; trainer: Trainer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const source = trainer.finder.source
  useEffect(() => {
    if (canvasRef.current && source) drawBoardPreview(canvasRef.current, c.board, cellsAfterClear(c, source.board))
  }, [c, source])
  const r = c.result
  return (
    <div className="readout">
      <canvas ref={canvasRef} className="preview" aria-label="Board after this placement" />
      <div className="readout-text">
        <div className="readout-title">
          <Swatch cat={c.category} /> {c.viaHold ? 'Hold → ' : ''}
          {c.piece.type} · {r.lines ? r.label : r.spin !== 'none' ? r.label : 'no clear'}
        </div>
        <dl className="kv">
          <dt>Lines</dt>
          <dd>{r.lines}</dd>
          <dt>Spin</dt>
          <dd>{r.spin}</dd>
          <dt>B2B</dt>
          <dd className={r.b2bChange === 'broken' ? 'bad' : r.b2bChange === 'kept' || r.b2bChange === 'started' ? 'good' : ''}>
            {b2bShow(r.before.b2b)} → {b2bShow(r.after.b2b)}
            <br />
            <small>{B2B_TEXT[r.b2bChange]}</small>
          </dd>
          <dt>Attack</dt>
          <dd>
            {r.attack}
            {r.surge ? <small> (surge {r.surge})</small> : null}
          </dd>
          <dt>Combo</dt>
          <dd>{r.after.combo >= 1 ? r.after.combo : '–'}</dd>
          <dt>Holes</dt>
          <dd>{c.newHoles > 0 ? `+${c.newHoles}` : c.newHoles}</dd>
          {c.makesSlot ? (
            <>
              <dt>Setup</dt>
              <dd className="setup">T-slot for {['', 'TSS', 'TSD', 'TST'][c.makesSlot]}</dd>
            </>
          ) : null}
          <dt>Spot</dt>
          <dd>
            x={c.piece.x} rot {ROT_NAME[c.piece.rot]}
          </dd>
        </dl>
        <Keys c={c} />
      </div>
    </div>
  )
}

export function FinderPanel({ trainer }: { trainer: Trainer }) {
  const f = trainer.finder
  useSyncExternalStore(f.subscribe, f.getVersion)
  const t = f.toggles
  const list = f.visible()
  const shown = f.displayed()
  const counts = { b2b: 0, setup: 0, break: 0, other: 0 }
  for (const c of [...f.current, ...f.hold]) counts[c.category]++

  const toggle = (patch: Parameters<Trainer['setFinder']>[0]) => (e: React.ChangeEvent<HTMLInputElement>) => {
    trainer.setFinder(patch)
    e.currentTarget.blur()
  }

  return (
    <div className="panel finder">
      <div className="panel-head">
        <h2>All placements (this piece)</h2>
        <label className="check inline">
          <input type="checkbox" checked={t.enabled} onChange={toggle({ enabled: !t.enabled })} />
          <span>
            on <kbd>F</kbd>
          </span>
        </label>
      </div>
      {t.enabled && (
        <>
          <div className="legend">
            {(['b2b', 'setup', 'break', 'other'] as Category[]).map((cat) => (
              <span key={cat} className={cat === 'other' && !t.showOther ? 'dim' : undefined}>
                <Swatch cat={cat} /> {CATEGORY_STYLE[cat].label} {counts[cat]}
              </span>
            ))}
          </div>
          <div className="row">
            <label className="check inline">
              <input type="checkbox" checked={t.showOther} onChange={toggle({ showOther: !t.showOther })} />
              <span>Show other</span>
            </label>
            <label className="check inline">
              <input type="checkbox" checked={t.includeHold} onChange={toggle({ includeHold: !t.includeHold })} />
              <span>What if I hold? (tagged H)</span>
            </label>
          </div>
          {shown ? (
            <Readout c={shown} trainer={trainer} />
          ) : (
            <p className="muted small">
              {list.length
                ? 'Tab / Shift+Tab cycles candidates; hover the board or a row to preview.'
                : 'No spin, B2B or B2B-breaking placements for this piece.'}
            </p>
          )}
          {list.length > 0 && (
            <ol className="cands" onMouseLeave={() => f.hover(null)}>
              {list.map((c) => (
                <li
                  key={c.id}
                  className={c.id === shown?.id ? 'on' : undefined}
                  onMouseEnter={() => f.hover(c.id)}
                  onClick={() => f.select(c.id)}
                >
                  <Swatch cat={c.category} />
                  <span className="cand-name">
                    {c.viaHold ? 'H·' : ''}
                    {c.piece.type} {c.result.lines || c.result.spin !== 'none' ? c.result.label : 'place'}
                  </span>
                  <span className="cand-atk">{c.result.attack ? `+${c.result.attack}` : ''}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="muted small">
            Reachable from spawn with ←/→, DAS, soft drop and CW/CCW/180 kicks. Assumes unlimited time: ignores gravity
            and lock delay. Computed in {f.lastMs.toFixed(1)} ms.
          </p>
        </>
      )}
    </div>
  )
}
