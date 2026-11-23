/**
 * Agreement with real players: for a position extracted from a replay, does the
 * planner's first move match where the player actually put the piece?
 * Shared by `npm run agree` (report) and `npm run tune` (weight search).
 */
import { PLAN_SCORE, PLAN_SEARCH, type PlanScoreConfig, type PlanSearchConfig } from '../config/planScore'
import type { SpinRule } from '../config/scoring'
import { findPlacements } from '../engine/finder'
import { type Board, boardFromRows } from '../engine/game'
import type { PieceType } from '../engine/pieces'
import { type Plan, searchPlans } from '../engine/planner'

/** One decision from a replay (scripts/replay/extract.mjs). */
export interface ReplayPosition {
  source: string
  round: number
  player: string
  n: number
  ruleset: SpinRule
  /** rows top-down */
  board: string[]
  current: PieceType
  hold: PieceType | null
  queue: PieceType[]
  b2b: number
  combo: number
  /** garbage lines waiting to enter the board */
  incoming: number | null
  chosen: { type: PieceType; viaHold: boolean; cells: [number, number][] }
}

export interface SearchSettings {
  /** ms; Infinity = deterministic (every pass up to beamMax) */
  budgetMs: number
  beam?: number
  beamMax?: number
}

export interface Agreement {
  /** our move search can reach the player's placement */
  reachable: boolean
  /** the player's move broke B2B (our planner never does) */
  theyBroke: boolean
  top1: boolean
  top3: boolean
  /** the player's piece is somewhere in our best plan */
  inPlan: boolean
  situation: string
  /** for reports */
  ours: string
  theirs: string
}

const key = (cells: readonly (readonly [number, number])[]) =>
  cells
    .map(([x, y]) => y * 16 + x)
    .sort((a, b) => a - b)
    .join(',')

const sameFirst = (plan: Plan | undefined, p: ReplayPosition) => {
  const s = plan?.steps[0]
  return !!s && s.type === p.chosen.type && key(s.cells) === key(p.chosen.cells)
}

export function agreement(
  p: ReplayPosition,
  search: SearchSettings,
  score: PlanScoreConfig = PLAN_SCORE,
  searchCfg: PlanSearchConfig = PLAN_SEARCH,
): Agreement {
  const board: Board = boardFromRows(p.board)
  const counters = { b2b: p.b2b, combo: p.combo }
  const want = key(p.chosen.cells)
  const theirs =
    findPlacements(board, p.chosen.type, counters, p.chosen.viaHold, { spinRule: p.ruleset }).find((c) => key(c.cells) === want) ?? null
  const plans = searchPlans(
    {
      board,
      counters,
      current: p.current,
      hold: p.hold,
      holdUsed: false,
      queue: p.queue,
      spinRule: p.ruleset,
      budgetMs: search.budgetMs,
      beam: search.beam,
      beamMax: search.beamMax,
    },
    undefined,
    3,
    { score, search: searchCfg, verify: false },
  )
  const r = theirs?.result
  const situation = !theirs
    ? 'unreachable for us'
    : r!.b2bChange === 'broken'
      ? 'they broke B2B'
      : r!.lines && r!.spin !== 'none'
        ? 'their spin clear'
        : r!.lines >= 4
          ? 'their quad'
          : r!.lines
            ? 'their other clear'
            : (p.incoming ?? 0) > 0
              ? 'stacking, garbage incoming'
              : 'stacking'
  return {
    reachable: !!theirs,
    theyBroke: r?.b2bChange === 'broken',
    top1: sameFirst(plans[0], p),
    top3: plans.some((pl) => sameFirst(pl, p)),
    inPlan: !!plans[0]?.steps.some((s) => s.type === p.chosen.type && key(s.cells) === want),
    situation,
    ours: plans[0]?.summary ?? '(no plan)',
    theirs: `${p.chosen.viaHold ? 'hold→' : ''}${p.chosen.type} at ${want}${r?.lines ? ` (${r.label})` : ''}`,
  }
}

/** The tuning objective: full credit for top-1, half for top-3 only. */
export const agreementScore = (a: readonly Agreement[]) => a.reduce((s, x) => s + (x.top1 ? 1 : x.top3 ? 0.5 : 0), 0) / Math.max(1, a.length)

/** Every `k`-th position (a fixed, spread-out sample). */
export const spread = <T>(xs: readonly T[], n: number): T[] => {
  if (xs.length <= n) return [...xs]
  const step = xs.length / n
  return Array.from({ length: n }, (_, i) => xs[Math.floor(i * step)])
}
