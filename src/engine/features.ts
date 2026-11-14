/**
 * Board features shared by the spin finder and the planner.
 */
import { type Board, HEIGHT, VISIBLE, WIDTH } from './game'

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

/**
 * Sealed holes: empty cells below the stack surface that open air cannot reach
 * (flood fill through empty cells from above the highest block, 4-connected).
 * Overhangs, tucks and spin slots stay connected to the open area, so they are
 * not sealed; a cell boxed in on every side is.
 */
export function sealedHoles(board: Board, h: number[] = heights(board)): number {
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
  let sealed = 0
  for (let x = 0; x < WIDTH; x++) for (let y = 0; y < h[x]; y++) if (!board[y * WIDTH + x] && !seen[y * WIDTH + x]) sealed++
  return sealed
}

