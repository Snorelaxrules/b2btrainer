/**
 * Every distinct reachable placement of a piece, scored. Pure; the planner
 * expands search nodes with it.
 */
import { SCORING, type ScoringConfig, type SpinRule } from '../config/scoring'
import { type ActivePiece, type Board, type Cell, pieceCells } from './game'
import { type Move, cellsKey, reachablePlacements } from './movegen'
import type { PieceType } from './pieces'
import { type ClearResult, type Counters, detectSpin, resolveLock } from './scoring'

export interface Candidate {
  /** stable id within one result */
  id: string
  piece: ActivePiece
  cells: Cell[]
  /** used hold to get this piece */
  viaHold: boolean
  /** inputs from spawn (after hold if viaHold), excluding the final hard drop */
  path: Move[]
  result: ClearResult
  /** board after locking and clearing */
  board: Board
}

export interface FindOptions {
  spinRule: SpinRule
  cfg?: ScoringConfig
}

const SPIN_RANK = { none: 0, mini: 1, full: 2 }

/**
 * All distinct placements of `type` on `board`. When several ways of getting
 * there cover the same cells (S/Z/I rotations, or arriving by a shift vs a
 * kick), keep the strongest spin, then the shortest key sequence.
 */
export function findPlacements(
  board: Board,
  type: PieceType,
  counters: Counters,
  viaHold: boolean,
  opts: FindOptions,
): Candidate[] {
  const cfg = opts.cfg ?? SCORING
  const best = new Map<string, { r: ReturnType<typeof reachablePlacements>[number]; spin: number; cells: Cell[] }>()
  for (const r of reachablePlacements(board, type)) {
    const cells = pieceCells(r.piece)
    const k = cellsKey(cells)
    const spin = SPIN_RANK[detectSpin(board, r.piece, opts.spinRule, cfg)]
    const cur = best.get(k)
    if (!cur || spin > cur.spin || (spin === cur.spin && r.path.length < cur.r.path.length)) best.set(k, { r, spin, cells })
  }
  const out: Candidate[] = []
  for (const [k, { r, cells }] of best) {
    const { board: after, result } = resolveLock(board, r.piece, counters, opts.spinRule, cfg)
    out.push({ id: `${viaHold ? 'h' : 'c'}:${k}`, piece: r.piece, cells, viaHold, path: r.path, result, board: after })
  }
  return out
}
