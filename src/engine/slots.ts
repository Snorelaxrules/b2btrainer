/**
 * Latent spin slots: every reachable placement of a (possibly hypothetical)
 * piece that would be a spin AND clear lines on this board, under the active
 * spin rule. Uses the real move search, kicks and spin detection, so a slot is
 * exactly what the game would score.
 *
 * Used to see which spins the board offers now, and as "continuation
 * potential": after a spin clear, which piece types have a slot on the result.
 */
import { SCORING, type ScoringConfig, type SpinRule } from '../config/scoring'
import { type ActivePiece, type Board, type Cell, WIDTH } from './game'
import { cellsInto, cellsKey, forEachResting } from './movegen'
import { PIECES, type PieceType, type Rotation } from './pieces'
import { type SpinKind, clearLabel, detectSpin } from './scoring'

export interface Slot {
  type: PieceType
  /** the piece at rest, with the rotation that got it there */
  piece: ActivePiece
  cells: Cell[]
  spin: Exclude<SpinKind, 'none'>
  lines: number
  /** e.g. "TSD", "S-Spin Mini Single" */
  label: string
}

const RANK = { none: 0, mini: 1, full: 2 } as const
const scratch = new Int8Array(8)

/** Rows a piece at these cells would complete on `board` (board not modified). */
export function linesCompleted(board: Board, cells: Int8Array | readonly Cell[]): number {
  const ys: number[] = []
  const flat = cells instanceof Int8Array
  for (let k = 0; k < 4; k++) {
    const y = flat ? (cells as Int8Array)[k * 2 + 1] : (cells as readonly Cell[])[k][1]
    if (!ys.includes(y)) ys.push(y)
  }
  let lines = 0
  for (const y of ys) {
    let n = 0
    for (let x = 0; x < WIDTH; x++) if (board[y * WIDTH + x]) n++
    for (let k = 0; k < 4; k++) if ((flat ? (cells as Int8Array)[k * 2 + 1] : (cells as readonly Cell[])[k][1]) === y) n++
    if (n === WIDTH) lines++
  }
  return lines
}

/**
 * Every distinct spin clear `type` can make on `board` (one per cell set,
 * keeping the strongest spin). Empty under 'tspin' for non-T pieces, and for
 * O when O-spins are off — the rule decides, never an assumption.
 */
export function slots(board: Board, type: PieceType, rule: SpinRule, cfg: ScoringConfig = SCORING): Slot[] {
  if (rule === 'tspin' && type !== 'T') return []
  if (type === 'O' && !cfg.oSpins) return []
  const best = new Map<string, Slot>()
  forEachResting(board, type, (rot, x, y, rk) => {
    if (rk < 0) return // a spin needs a rotation as the last move
    const piece: ActivePiece = { type, rot: rot as Rotation, x, y, rotated: true, kick: rk >= 6 ? rk - 6 : rk, flip: rk >= 6 }
    cellsInto(type, rot, x, y, scratch)
    const lines = linesCompleted(board, scratch)
    if (!lines) return
    const spin = detectSpin(board, piece, rule, cfg)
    if (spin === 'none') return
    const cells: Cell[] = [0, 1, 2, 3].map((k): Cell => [scratch[k * 2], scratch[k * 2 + 1]])
    const key = cellsKey(cells)
    const cur = best.get(key)
    if (!cur || RANK[spin] > RANK[cur.spin]) best.set(key, { type, piece, cells, spin, lines, label: clearLabel(type, spin, lines) })
  })
  return [...best.values()].sort((a, b) => RANK[b.spin] - RANK[a.spin] || b.lines - a.lines)
}

/** slots() for all 7 piece types. */
export function allSlots(board: Board, rule: SpinRule, cfg: ScoringConfig = SCORING): Record<PieceType, Slot[]> {
  return Object.fromEntries(PIECES.map((t) => [t, slots(board, t, rule, cfg)])) as Record<PieceType, Slot[]>
}

/** Piece types that have at least one spin clear available on `board`. */
export function slotTypes(board: Board, rule: SpinRule, cfg: ScoringConfig = SCORING): PieceType[] {
  return PIECES.filter((t) => slots(board, t, rule, cfg).length > 0)
}
