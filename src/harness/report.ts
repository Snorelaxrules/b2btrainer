/**
 * Run the planner on a position and explain every plan: steps with keys, the
 * end stack and the per-term score table. Pure (no fs / process): the CLI in
 * scripts/plan.ts prints what this returns.
 */
import { type Board, clearLines, placeOnBoard } from '../engine/game'
import { MOVE_LABEL } from '../engine/movegen'
import { boardText, formatScore } from '../engine/planScore'
import { type Plan, type PlanRequest, searchPlans } from '../engine/planner'
import type { Position } from './position'

export interface RunOptions {
  depth?: number
  /** first-pass beam */
  beam?: number
  /** widest pass */
  beamMax?: number
  /** ms; default: no time limit (deterministic: every pass up to beamMax) */
  budget?: number
  top?: number
}

export interface PlanReport {
  plan: Plan
  endBoard: Board
}

export interface PositionReport {
  position: Position
  reports: PlanReport[]
  ms: number
}

export function requestFor(p: Position, opts: RunOptions = {}): PlanRequest {
  return {
    board: p.board,
    counters: p.counters,
    current: p.current,
    hold: p.hold,
    holdUsed: p.holdUsed,
    queue: p.queue,
    depth: opts.depth,
    beam: opts.beam,
    beamMax: opts.beamMax,
    budgetMs: opts.budget ?? Infinity,
    spinRule: p.ruleset,
  }
}

/** Run the search (plans come back best score first, each with its term breakdown). */
export function analysePosition(p: Position, opts: RunOptions = {}): PositionReport {
  const req = requestFor(p, opts)
  const t0 = performance.now()
  const plans = searchPlans(req, undefined, opts.top ?? 3)
  const ms = performance.now() - t0
  const reports = plans.map((plan): PlanReport => {
    let b = p.board
    for (const st of plan.steps) {
      b = placeOnBoard(b, st.piece)
      clearLines(b)
    }
    return { plan, endBoard: b }
  })
  return { position: p, reports, ms }
}

const ROT = ['0', 'R', '2', 'L']

/** Two text blocks side by side. */
function beside(a: string[], b: string[], gap = 4): string[] {
  const w = Math.max(0, ...a.map((l) => l.length))
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? '').padEnd(w + gap) + (b[i] ?? '')).map((l) => l.trimEnd())
}

export function formatPositionReport(r: PositionReport, opts: { all?: boolean } = {}): string {
  const p = r.position
  const out: string[] = []
  const b2b = p.counters.b2b < 0 ? 'no B2B' : `B2B ×${p.counters.b2b}`
  out.push(`=== ${p.name}`)
  out.push(`    ${p.ruleset} · ${b2b} · hand ${p.current} · hold ${p.hold ?? '-'} · queue ${p.queue.join('') || '-'} · ${r.ms.toFixed(0)} ms`)
  if (p.notes) out.push(`    ${p.notes}`)
  out.push('', ...p.rows.map((row) => `    ${row}`))
  if (!r.reports.length) out.push('', '  (no plans)')
  r.reports.forEach((rep, i) => {
    const pl = rep.plan
    out.push('', `--- Plan ${i + 1} · ${pl.kind} · score ${pl.score.toFixed(2)} · chain ${pl.chain} · attack ${pl.attack} · ${pl.steps.length} pieces`, `    ${pl.summary}`)
    const steps = rep.plan.steps.map((s) => {
      const cols = [...new Set(s.cells.map(([x]) => x))].sort((a, b) => a - b)
      const keys = [...(s.viaHold ? ['Hold'] : []), ...s.path.map((m) => MOVE_LABEL[m]), 'Drop'].join(' ')
      const clear = s.result.lines ? `  [${s.result.label}${s.result.attack ? ` +${s.result.attack}` : ''}]` : ''
      const note = s.note ? `  (${s.note})` : ''
      return `${String(s.n).padStart(2)}. ${s.viaHold ? 'hold→' : ''}${s.type}  rot ${ROT[s.piece.rot]} cols ${cols[0]}–${cols[cols.length - 1]}  ${keys}${clear}${note}`
    })
    out.push(...beside(steps, ['end stack:', ...boardText(rep.endBoard)]).map((l) => `  ${l}`))
    out.push('', formatScore({ total: pl.score, terms: pl.terms }, opts.all))
  })
  return out.join('\n')
}
