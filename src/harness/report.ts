/**
 * Run the planner on a position and explain every plan: steps with keys, the
 * end stack and the per-term score table. Pure (no fs / process): the CLI in
 * scripts/plan.ts prints what this returns.
 */
import { PLAN_SCORE, type PlanScoreConfig } from '../config/planScore'
import { type Board, clearLines, placeOnBoard } from '../engine/game'
import { MOVE_LABEL } from '../engine/movegen'
import { type PlanScore, boardText, formatScore, remainingPieces, scorePlan } from '../engine/planScore'
import { type Plan, type PlanRequest, searchPlans } from '../engine/planner'
import type { Position } from './position'

export interface RunOptions {
  depth?: number
  beam?: number
  top?: number
  cfg?: PlanScoreConfig
}

export interface PlanReport {
  plan: Plan
  score: PlanScore
  endBoard: Board
  /** the search's own rank (1-based) */
  searchRank: number
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
    depth: opts.depth ?? Math.min(6, 1 + p.queue.length),
    beam: opts.beam ?? 100,
    spinRule: p.ruleset,
    miniSpins: p.ruleset === 'tspin' ? 'off' : 'existing',
  }
}

/** Run the search, score each plan on its end state, best score first. */
export function analysePosition(p: Position, opts: RunOptions = {}): PositionReport {
  const req = requestFor(p, opts)
  const t0 = performance.now()
  const plans = searchPlans(req, undefined, opts.top ?? 3)
  const ms = performance.now() - t0
  const reports = plans.map((plan, i): PlanReport => {
    let b = p.board
    for (const st of plan.steps) {
      b = placeOnBoard(b, st.piece)
      clearLines(b)
    }
    const remaining = remainingPieces(
      { current: p.current, hold: p.hold, queue: p.queue },
      plan.steps.map((s) => s.type),
    )
    const score = scorePlan({ steps: plan.steps, endBoard: b, remaining, rule: p.ruleset }, opts.cfg ?? PLAN_SCORE)
    return { plan, score, endBoard: b, searchRank: i + 1 }
  })
  reports.sort((a, b) => b.score.total - a.score.total)
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
    out.push('', `--- Plan ${i + 1} · score ${rep.score.total.toFixed(2)} · search rank ${rep.searchRank}`, `    ${rep.plan.summary}`)
    const steps = rep.plan.steps.map((s) => {
      const cols = [...new Set(s.cells.map(([x]) => x))].sort((a, b) => a - b)
      const keys = [...(s.viaHold ? ['Hold'] : []), ...s.path.map((m) => MOVE_LABEL[m]), 'Drop'].join(' ')
      const clear = s.result.lines ? `  [${s.result.label}${s.result.attack ? ` +${s.result.attack}` : ''}]` : ''
      return `${String(s.n).padStart(2)}. ${s.viaHold ? 'hold→' : ''}${s.type}  rot ${ROT[s.piece.rot]} cols ${cols[0]}–${cols[cols.length - 1]}  ${keys}${clear}`
    })
    out.push(...beside(steps, ['end stack:', ...boardText(rep.endBoard)]).map((l) => `  ${l}`))
    out.push('', formatScore(rep.score, opts.all))
  })
  return out.join('\n')
}
