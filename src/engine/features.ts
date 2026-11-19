/**
 * Board features shared by the spin finder and the planner.
 */
import { type Board, HEIGHT, VISIBLE, WIDTH } from './game'
import { cellsInto, fitsState, forEachResting } from './movegen'

/** Column heights (row index above the top block; 0 = empty column). */
export function heights(board: Board): number[] {
  const h = new Array<number>(WIDTH).fill(0)
  for (let x = 0; x < WIDTH; x++) {
    for (let y = VISIBLE + 3; y >= 0; y--) {
      if (board[y * WIDTH + x]) {
        h[x] = y + 1
        break
      }
    }
  }
  return h
}

/** Flood fill through empty cells from the open row above the stack (4-connected). */
function floodOpen(board: Board, h: number[]): Uint8Array {
  const top = Math.min(HEIGHT - 1, Math.max(...h))
  const seen = new Uint8Array(WIDTH * (top + 1))
  const stack: number[] = []
  for (let x = 0; x < WIDTH; x++) {
    const i = top * WIDTH + x
    if (!board[i]) {
      seen[i] = 1
      stack.push(i)
    }
  }
  while (stack.length) {
    const i = stack.pop() as number
    const x = i % WIDTH
    const y = (i - x) / WIDTH
    const visit = (nx: number, ny: number) => {
      if (nx < 0 || nx >= WIDTH || ny < 0 || ny > top) return
      const j = ny * WIDTH + nx
      if (seen[j] || board[j]) return
      seen[j] = 1
      stack.push(j)
    }
    visit(x - 1, y)
    visit(x + 1, y)
    visit(x, y - 1)
    visit(x, y + 1)
  }
  return seen
}

/**
 * Sealed holes: empty cells below the stack surface that open air cannot reach
 * (flood fill through empty cells from above the highest block, 4-connected).
 * Overhangs, tucks and spin slots stay connected to the open area, so they are
 * not sealed; a cell boxed in on every side is.
 */
export function sealedHoles(board: Board, h: number[] = heights(board)): number {
  return sealedCells(board, h).length
}

/** The sealed cells themselves (indices y*WIDTH+x). */
export function sealedCells(board: Board, h: number[] = heights(board)): number[] {
  const seen = floodOpen(board, h)
  const out: number[] = []
  for (let x = 0; x < WIDTH; x++)
    for (let y = 0; y < h[x]; y++) if (!board[y * WIDTH + x] && !seen[y * WIDTH + x]) out.push(y * WIDTH + x)
  return out
}


export interface Pockets {
  /** covered cells some piece can slide, drop or rotate into without needing a spin */
  tuck: number
  /** covered cells only a spin (a piece stuck after rotating in) can fill */
  spinOnly: number
  /** covered cells open to the air that no piece can ever reach */
  dead: number
  /**
   * With `detail`: every awkward cell (index y*WIDTH+x) → 'sealed' (cut off from the
   * open area), 'dead' (open but unreachable) or the pieces that can only spin into it.
   */
  awkward?: Map<number, string[] | 'sealed' | 'dead'>
}

/**
 * Classify covered-but-open cells (under a block in their column, yet connected
 * to the open area) by what can actually fill them, using the real move search
 * for every piece. "Spin" here is physical (a piece that can't move once rotated
 * in), whatever the scoring rules, because that's what makes a pocket awkward.
 */
export function classifyPockets(board: Board, h: number[] = heights(board), detail = false): Pockets {
  const seen = floodOpen(board, h)
  const awkward = detail ? new Map<number, string[] | 'sealed' | 'dead'>() : undefined
  if (awkward) {
    for (let x = 0; x < WIDTH; x++)
      for (let y = 0; y < h[x]; y++) {
        const i = y * WIDTH + x
        if (!board[i] && !seen[i]) awkward.set(i, 'sealed')
      }
  }
  const cls = new Map<number, number>() // cell → 0 unreached, 1 spin only, 2 tuck
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < h[x]; y++) {
      const i = y * WIDTH + x
      if (!board[i] && seen[i]) cls.set(i, 0)
    }
  }
  if (!cls.size) return { tuck: 0, spinOnly: 0, dead: 0, awkward }
  let open = cls.size // cells not yet known to be tuck-fillable
  const fillers = new Map<number, Set<string>>()
  const cells = new Int8Array(8)
  const filled = (x: number, y: number) => x < 0 || x >= WIDTH || y < 0 || (y < HEIGHT && board[y * WIDTH + x] !== 0)
  for (const type of TYPES) {
    forEachResting(board, type, (rot, x, y, rk) => {
      if (!open) return
      cellsInto(type, rot, x, y, cells)
      let touches = false
      for (let k = 0; k < 8 && !touches; k += 2) {
        const c = cls.get(cells[k + 1] * WIDTH + cells[k])
        if (c !== undefined && c < 2) touches = true
      }
      if (!touches) return
      // physically a spin: rotated in and stuck there (any piece), or a T with 3 corners
      let spin = false
      if (rk >= 0) {
        spin =
          !fitsState(board, type, rot, x - 1, y) && !fitsState(board, type, rot, x + 1, y) && !fitsState(board, type, rot, x, y + 1)
        if (!spin && type === 'T') {
          const n = +filled(x, y) + +filled(x + 2, y) + +filled(x, y - 2) + +filled(x + 2, y - 2)
          spin = n >= 3
        }
      }
      for (let k = 0; k < 8; k += 2) {
        const i = cells[k + 1] * WIDTH + cells[k]
        const c = cls.get(i)
        if (c === undefined || c === 2) continue
        if (!spin) {
          cls.set(i, 2)
          open--
        } else {
          if (c === 0) cls.set(i, 1)
          if (detail) {
            const f = fillers.get(i) ?? new Set<string>()
            f.add(type)
            fillers.set(i, f)
          }
        }
      }
    })
    if (!open) break
  }
  let tuck = 0
  let spinOnly = 0
  let dead = 0
  for (const [i, c] of cls) {
    if (c === 2) tuck++
    else if (c === 1) {
      spinOnly++
      awkward?.set(i, [...(fillers.get(i) ?? [])].sort())
    } else {
      dead++
      awkward?.set(i, 'dead')
    }
  }
  return { tuck, spinOnly, dead, awkward }
}

const TYPES = ['T', 'L', 'J', 'I', 'S', 'Z', 'O'] as const
