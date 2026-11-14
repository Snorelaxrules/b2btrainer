/**
 * Spin finder: every reachable placement for a piece, scored and classified
 * for back-to-back play. Pure; used by the UI overlay, lookahead and coach.
 */
import type { SpinRule } from '../config/scoring'
import { SCORING, type ScoringConfig } from '../config/scoring'
import { type ActivePiece, type Board, type Cell, HEIGHT, VISIBLE, WIDTH, fits, isGrounded, occupied, pieceCells } from './game'
import { type Move, cellsKey, reachablePlacements } from './movegen'
import type { PieceType, Rotation } from './pieces'
import { type ClearResult, type Counters, detectSpin, resolveLock } from './scoring'
import { sealedHoles } from './features'

export type Category =
  /** spin or quad clear that starts/keeps B2B */
  | 'b2b'
  /** non-clearing spin: builds toward B2B without spending it */
  | 'setup'
  /** line clear that breaks an active B2B streak */
  | 'break'
  | 'other'

export const CATEGORY_ORDER: Record<Category, number> = { b2b: 0, setup: 1, break: 2, other: 3 }

export interface Candidate {
  /** stable id within one finder result */
  id: string
  piece: ActivePiece
  cells: Cell[]
  /** used hold to get this piece */
  viaHold: boolean
  /** inputs from spawn (after hold if viaHold), excluding the final hard drop */
  path: Move[]
  result: ClearResult
  category: Category
  /** board after locking and clearing */
  board: Board
  /** holes after minus holes before (negative = opened some) */
  newHoles: number
  /** sealed (unreachable) holes after minus before */
  newSealed: number
  /** the resulting board has a T-spin slot (full spin, ≥1 line) that the board before did not */
  makesSlot: number
}

const SPIN_RANK = { none: 0, mini: 1, full: 2 }

export function categorize(r: ClearResult): Category {
  if (r.lines > 0 && r.difficult) return 'b2b'
  if (r.lines === 0 && r.spin !== 'none') return 'setup'
  if (r.lines > 0 && r.b2bChange === 'broken') return 'break'
  return 'other'
}

/** Empty cells with a filled cell somewhere above them in the same column. */
export function countHoles(board: Board): number {
  let holes = 0
  for (let x = 0; x < WIDTH; x++) {
    let roof = false
    for (let y = VISIBLE + 3; y >= 0; y--) {
      if (board[y * WIDTH + x]) roof = true
      else if (roof) holes++
    }
  }
  return holes
}

/**
 * Best T-spin slot on a board: lines a full T-spin would clear at any resting
 * spot that passes the 3-corner + facing-corner test and has a roof (so it
 * can't simply be dropped into). Cheap heuristic; ignores reachability.
 */
export function bestTSlot(board: Board): number {
  let best = 0
  for (const rot of [1, 2, 3] as Rotation[]) {
    for (let x = -1; x < WIDTH; x++) {
      for (let y = 1; y < VISIBLE; y++) {
        const p: ActivePiece = { type: 'T', rot, x, y, rotated: true, kick: 0 }
        if (!fits(board, p) || !isGrounded(board, p)) continue
        if (fits(board, { ...p, y: p.y + 1 }) && fits(board, { ...p, y: p.y + 2 })) {
          // open above: only counts if something overhangs one of its cells
          const covered = pieceCells(p).some(([cx, cy]) => {
            for (let yy = cy + 1; yy < HEIGHT; yy++) if (occupied(board, cx, yy)) return true
            return false
          })
          if (!covered) continue
        }
        if (detectSpin(board, p, 'tspin') !== 'full') continue
        let lines = 0
        const rows = new Set(pieceCells(p).map(([, cy]) => cy))
        for (const row of rows) {
          let full = true
          for (let cx = 0; cx < WIDTH && full; cx++) {
            if (!occupied(board, cx, row) && !pieceCells(p).some(([px, py]) => px === cx && py === row)) full = false
          }
          if (full) lines++
        }
        if (lines > best) best = lines
      }
    }
  }
  return best
}

export interface FindOptions {
  spinRule: SpinRule
  cfg?: ScoringConfig
  /** compute the T-slot heuristic (slower) */
  slots?: boolean
}

/** All distinct placements of `type` on `board`, best variant per covered-cells set. */
export function findPlacements(
  board: Board,
  type: PieceType,
  counters: Counters,
  viaHold: boolean,
  opts: FindOptions,
): Candidate[] {
  const cfg = opts.cfg ?? SCORING
  const holesBefore = countHoles(board)
  const sealedBefore = sealedHoles(board)
  const slotBefore = opts.slots ? bestTSlot(board) : 0
  // group by covered cells; keep the strongest spin, then the shortest path
  const best = new Map<string, { r: ReturnType<typeof reachablePlacements>[number]; spin: number; cells: Cell[] }>()
  for (const r of reachablePlacements(board, type)) {
    const cells = pieceCells(r.piece)
    const k = cellsKey(cells)
    const spin = SPIN_RANK[detectSpin(board, r.piece, opts.spinRule, cfg)]
    const cur = best.get(k)
    if (!cur || spin > cur.spin || (spin === cur.spin && r.path.length < cur.r.path.length)) {
      best.set(k, { r, spin, cells })
    }
  }
  const out: Candidate[] = []
  for (const [k, { r, cells }] of best) {
    const { board: after, result } = resolveLock(board, r.piece, counters, opts.spinRule, cfg)
    const slotAfter = opts.slots ? bestTSlot(after) : 0
    out.push({
      id: `${viaHold ? 'h' : 'c'}:${k}`,
      piece: r.piece,
      cells,
      viaHold,
      path: r.path,
      result,
      category: categorize(result),
      board: after,
      newHoles: countHoles(after) - holesBefore,
      newSealed: sealedHoles(after) - sealedBefore,
      makesSlot: slotAfter > slotBefore ? slotAfter : 0,
    })
  }
  return sortCandidates(out)
}

export function sortCandidates(list: Candidate[]): Candidate[] {
  return list.sort(
    (a, b) =>
      CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
      b.result.attack - a.result.attack ||
      SPIN_RANK[b.result.spin] - SPIN_RANK[a.result.spin] ||
      b.result.lines - a.result.lines ||
      a.newHoles - b.newHoles ||
      a.path.length - b.path.length,
  )
}

/** Piece cells after the lock, shifted down past cleared rows (for previews). */
export function cellsAfterClear(c: Candidate, boardBefore: Board): Cell[] {
  const cleared: number[] = []
  const rows = new Set(c.cells.map(([, y]) => y))
  for (const y of rows) {
    let full = true
    for (let x = 0; x < WIDTH && full; x++) {
      if (!boardBefore[y * WIDTH + x] && !c.cells.some(([cx, cy]) => cx === x && cy === y)) full = false
    }
    if (full) cleared.push(y)
  }
  return c.cells
    .filter(([, y]) => !cleared.includes(y))
    .map(([x, y]): Cell => [x, y - cleared.filter((r) => r < y).length])
}
