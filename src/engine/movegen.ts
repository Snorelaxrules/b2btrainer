/**
 * Move generation: every final placement reachable from spawn with the real
 * move set, plus the shortest key sequence to get there.
 *
 * Search space: (x, y, rotation, how the piece got there). The last part is
 * -1 for a shift/drop, or the kick index of the rotation that produced the
 * state, because spin detection depends on it. BFS gives each such state its
 * fewest-inputs path.
 *
 * Moves (one input each): tap ←/→, DAS ←/→ (slide to the wall), soft drop
 * (infinite SDF: to the floor), rotate CW / CCW / 180 with SRS+ kicks.
 * Assumes unlimited time: no gravity, no lock delay, no move-reset limit.
 * Not modelled: soft drop held *while* DAS slides (falling into the first gap).
 */
import { type ActivePiece, type Board, HEIGHT, WIDTH, spawnPiece } from './game'
import { PIECES, type PieceType, type Rotation, SHAPES, kickTests } from './pieces'

export type Move = 'left' | 'right' | 'dasLeft' | 'dasRight' | 'softDrop' | 'cw' | 'ccw' | 'flip'

export const MOVE_LABEL: Record<Move | 'hold' | 'hardDrop', string> = {
  left: '←',
  right: '→',
  dasLeft: '⇤ DAS',
  dasRight: 'DAS ⇥',
  softDrop: '↓',
  cw: '↻ CW',
  ccw: '↺ CCW',
  flip: '180',
  hold: 'Hold',
  hardDrop: 'Drop',
}

export interface Reachable {
  /** the piece at rest, with rotated/kick describing its last move */
  piece: ActivePiece
  /** inputs from spawn, excluding the final hard drop (a trailing soft drop is dropped: hard drop covers it) */
  path: Move[]
}

// --- precomputed tables (the search runs thousands of times per plan) ---------

/** per piece, per rotation: [cx0, cy0, cx1, cy1, …] (cy counts down from the box top) */
const OFFS = Object.fromEntries(PIECES.map((t) => [t, SHAPES[t].map((cells) => Int8Array.from(cells.flat()))])) as Record<
  PieceType,
  Int8Array[]
>
/** rotation turns in move order: cw, ccw, 180 */
const TURNS = [1, 3, 2] as const
/** per piece, per from-rotation, per turn: kick tests [dx, dy(up)] flattened, in SRS+ order */
const KICKS = Object.fromEntries(
  PIECES.map((t) => [
    t,
    [0, 1, 2, 3].map((from) =>
      TURNS.map((turn) => Int8Array.from(kickTests(t, from as Rotation, ((from + turn) % 4) as Rotation).flat())),
    ),
  ]),
) as Record<PieceType, Int8Array[][]>

const MOVES: Move[] = ['left', 'right', 'dasLeft', 'dasRight', 'softDrop', 'cw', 'ccw', 'flip']

function fitsAt(board: Board, o: Int8Array, x: number, y: number): boolean {
  for (let k = 0; k < 8; k += 2) {
    const cx = x + o[k]
    const cy = y - o[k + 1]
    if (cx < 0 || cx >= WIDTH || cy < 0 || cy >= HEIGHT || board[cy * WIDTH + cx]) return false
  }
  return true
}

/**
 * State key, 16 bits: rotation (2) | x+4 (4) | y (6) | rk+1 (4), where rk is
 * -1 for a shift/drop, 0–5 the kick index of a 90° rotation, 6–11 of a 180.
 */
const enc = (rot: number, x: number, y: number, rk: number) => (rot << 14) | ((x + 4) << 10) | (y << 4) | (rk + 1)

// scratch space reused across calls (single-threaded: main thread or one worker)
const SIZE = 1 << 16
const stamp = new Uint32Array(SIZE)
/** positions (state key without the arrival kind) already expanded this search */
const expanded = new Uint32Array(SIZE >> 4)
const parent = new Int32Array(SIZE)
const moveOf = new Int8Array(SIZE)
const queue = new Int32Array(SIZE)
let gen = 0

export interface ReachOptions {
  /** reconstruct key sequences (skip when only the placements matter) */
  paths?: boolean
}

/**
 * Run the move search and call `fn` for every resting arrival (no objects
 * built). rk: -1 = got there by a shift/drop, else the kick index (6–11 for a 180).
 * Returns how many arrivals were reported.
 */
export function forEachResting(board: Board, type: PieceType, fn: (rot: number, x: number, y: number, rk: number) => void): number {
  const n = search(board, type, spawnPiece(type))
  const offs = OFFS[type]
  let count = 0
  for (let qi = 0; qi < n; qi++) {
    const k = queue[qi]
    const rot = k >> 14
    const x = ((k >> 10) & 15) - 4
    const y = (k >> 4) & 63
    if (fitsAt(board, offs[rot], x, y - 1)) continue
    fn(rot, x, y, (k & 15) - 1)
    count++
  }
  return count
}

/** Cells of a piece at (rot, x, y), written into `out` as [x0, y0, x1, y1, …]. */
export function cellsInto(type: PieceType, rot: number, x: number, y: number, out: Int8Array): Int8Array {
  const o = OFFS[type][rot]
  for (let k = 0; k < 8; k += 2) {
    out[k] = x + o[k]
    out[k + 1] = y - o[k + 1]
  }
  return out
}

/** Can a piece of `type` be at (rot, x, y) on `board`? */
export function fitsState(board: Board, type: PieceType, rot: number, x: number, y: number): boolean {
  return fitsAt(board, OFFS[type][rot], x, y)
}

/** All grounded states reachable from `start` (default: the spawn position). */
export function reachablePlacements(board: Board, type: PieceType, start?: ActivePiece, opts: ReachOptions = {}): Reachable[] {
  const s0 = start ?? spawnPiece(type)
  const offs = OFFS[type]
  const qn = search(board, type, s0)
  const wantPaths = opts.paths !== false
  const out: Reachable[] = []
  for (let qi = 0; qi < qn; qi++) {
    const k = queue[qi]
    const rot = k >> 14
    const x = ((k >> 10) & 15) - 4
    const y = (k >> 4) & 63
    if (fitsAt(board, offs[rot], x, y - 1)) continue // not resting
    const rk = (k & 15) - 1
    const piece: ActivePiece = {
      type,
      rot: rot as Rotation,
      x,
      y,
      rotated: rk >= 0,
      kick: rk < 0 ? -1 : rk >= 6 ? rk - 6 : rk,
      flip: rk >= 6,
    }
    const path: Move[] = []
    if (wantPaths) {
      for (let c = k; moveOf[c] >= 0; c = parent[c]) path.push(MOVES[moveOf[c]])
      path.reverse()
      if (path[path.length - 1] === 'softDrop') path.pop()
    }
    out.push({ piece, path })
  }
  return out
}

/** The BFS itself: fills `queue` with every arrival; returns how many. */
function search(board: Board, type: PieceType, s0: ActivePiece): number {
  const offs = OFFS[type]
  if (!fitsAt(board, offs[s0.rot], s0.x, s0.y)) return 0
  if (++gen === 0xffffffff) {
    stamp.fill(0)
    expanded.fill(0)
    gen = 1
  }
  const kicks = KICKS[type]
  const k0 = enc(s0.rot, s0.x, s0.y, s0.rotated ? s0.kick + (s0.flip ? 6 : 0) : -1)
  let qn = 0
  stamp[k0] = gen
  parent[k0] = -1
  moveOf[k0] = -1
  queue[qn++] = k0
  const visit = (from: number, k: number, mv: number) => {
    if (stamp[k] === gen) return
    stamp[k] = gen
    parent[k] = from
    moveOf[k] = mv
    queue[qn++] = k
  }

  for (let qi = 0; qi < qn; qi++) {
    const k = queue[qi]
    // onward moves don't depend on how the piece arrived (shift vs which kick), so
    // expand each spot once; every distinct arrival is still kept for spin detection
    const pos = k >> 4
    if (expanded[pos] === gen) continue
    expanded[pos] = gen
    const rot = k >> 14
    const x = ((k >> 10) & 15) - 4
    const y = (k >> 4) & 63
    const o = offs[rot]
    // taps
    if (fitsAt(board, o, x - 1, y)) visit(k, enc(rot, x - 1, y, -1), 0)
    if (fitsAt(board, o, x + 1, y)) visit(k, enc(rot, x + 1, y, -1), 1)
    // DAS to the wall (only distinct from a tap if it travels 2+)
    let lx = x
    while (fitsAt(board, o, lx - 1, y)) lx--
    if (lx < x - 1) visit(k, enc(rot, lx, y, -1), 2)
    let rx = x
    while (fitsAt(board, o, rx + 1, y)) rx++
    if (rx > x + 1) visit(k, enc(rot, rx, y, -1), 3)
    // soft drop to the floor
    let yy = y
    while (fitsAt(board, o, x, yy - 1)) yy--
    if (yy < y) visit(k, enc(rot, x, yy, -1), 4)
    // rotations with SRS+ kicks: the first test that fits wins
    if (type !== 'O') {
      for (let t = 0; t < 3; t++) {
        const to = (rot + TURNS[t]) % 4
        const tests = kicks[rot][t]
        for (let i = 0; i < tests.length; i += 2) {
          const nx = x + tests[i]
          const ny = y + tests[i + 1]
          if (fitsAt(board, offs[to], nx, ny)) {
            visit(k, enc(to, nx, ny, t === 2 ? i / 2 + 6 : i / 2), 5 + t)
            break
          }
        }
      }
    }
  }

  return qn
}

/** Canonical key of the cells a piece covers (S/Z/I rotations that cover the same cells match). */
export function cellsKey(cells: readonly (readonly [number, number])[]): string {
  return cells
    .map(([x, y]) => y * 16 + x)
    .sort((a, b) => a - b)
    .join(',')
}
