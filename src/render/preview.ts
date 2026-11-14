/** Small static board drawing for the spin-finder preview (board after the lock). */
import { PIECE_COLORS, THEME } from '../config/theme'
import { type Board, CODE_PIECE, type Cell, WIDTH } from '../engine/game'

export function drawBoardPreview(canvas: HTMLCanvasElement, board: Board, highlight: readonly Cell[], cell = 13) {
  // crop to the stack: a few empty rows above the highest block, between 8 and 20 rows
  let top = 0
  for (let i = 0; i < board.length; i++) if (board[i]) top = Math.floor(i / WIDTH) + 1
  const rows = Math.min(20, Math.max(8, top + 3))
  const dpr = window.devicePixelRatio || 1
  const w = WIDTH * cell
  const h = rows * cell
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = THEME.well
  ctx.fillRect(0, 0, w, h)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const c = board[y * WIDTH + x]
      if (!c) continue
      const t = CODE_PIECE[c]
      ctx.fillStyle = t ? PIECE_COLORS[t] : THEME.garbage
      ctx.globalAlpha = 0.85
      ctx.fillRect(x * cell + 0.5, (rows - 1 - y) * cell + 0.5, cell - 1, cell - 1)
    }
  }
  ctx.globalAlpha = 1
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  for (const [x, y] of highlight) {
    if (y >= rows) continue
    ctx.strokeRect(x * cell + 1.25, (rows - 1 - y) * cell + 1.25, cell - 2.5, cell - 2.5)
  }
  ctx.strokeStyle = THEME.wellEdge
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
}
