/**
 * Canvas 2D renderer: hold (left), board (centre), next queue (right) in one canvas.
 * Reads a GameState and draws it; never touches React.
 */
import { PIECE_COLORS, THEME } from '../config/theme'
import { CODE_PIECE, type GameState, type Piece, WIDTH, cellAt, ghost, pieceCells } from '../engine/game'
import { type PieceType, SHAPES } from '../engine/pieces'
import { surgeFor } from '../engine/scoring'

/** rows drawn: the 20 visible plus this many of the hidden buffer (where pieces spawn) */
export const BUFFER_SHOWN = 3
const ROWS = 20 + BUFFER_SHOWN
const SIDE = 5 // side panel width in cells
const GAP = 0.6
const TOP = 0.2
/** layout in cell units */
export const LAYOUT_COLS = SIDE + GAP + WIDTH + GAP + SIDE
export const LAYOUT_ROWS = ROWS + TOP * 2

/** Extra layers drawn on top of the game (the spin finder hooks in here). */
export interface Overlay {
  draw(ctx: CanvasRenderingContext2D, view: BoardView): void
}

/** Geometry of the board on the canvas, for overlays and hit testing. */
export interface BoardView {
  cell: number
  left: number
  top: number
  rows: number
  /** canvas-pixel rectangle of board cell (x, y) (y from the bottom) */
  rect(x: number, y: number): [number, number, number, number]
  /** board cell under a CSS-pixel point on the canvas, or null */
  cellAt(px: number, py: number): [number, number] | null
}

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private cell = 24
  private width = 0
  private height = 0
  view: BoardView

  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D unavailable')
    this.ctx = ctx
    this.view = this.makeView()
  }

  /** Fit into a CSS box; keeps the backing store at device resolution. */
  resize(cssWidth: number, cssHeight: number, dpr = window.devicePixelRatio || 1) {
    const cell = Math.max(8, Math.floor(Math.min(cssWidth / LAYOUT_COLS, cssHeight / LAYOUT_ROWS)))
    this.width = Math.round(cell * LAYOUT_COLS)
    this.height = Math.round(cell * LAYOUT_ROWS)
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.canvas.width = Math.round(this.width * dpr)
    this.canvas.height = Math.round(this.height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.cell = cell
    this.view = this.makeView()
  }

  private makeView(): BoardView {
    const cell = this.cell
    const left = (SIDE + GAP) * cell
    const top = TOP * cell
    return {
      cell,
      left,
      top,
      rows: ROWS,
      rect: (x, y) => [left + x * cell, top + (ROWS - 1 - y) * cell, cell, cell],
      cellAt: (px, py) => {
        const x = Math.floor((px - left) / cell)
        const y = ROWS - 1 - Math.floor((py - top) / cell)
        return x >= 0 && x < WIDTH && y >= 0 && y < ROWS ? [x, y] : null
      },
    }
  }

  draw(s: GameState, overlays: readonly Overlay[] = []) {
    const { ctx, cell } = this
    const v = this.view
    ctx.clearRect(0, 0, this.width, this.height)

    // well
    ctx.fillStyle = THEME.well
    ctx.fillRect(v.left, v.top, WIDTH * cell, ROWS * cell)
    ctx.fillStyle = THEME.buffer
    ctx.fillRect(v.left, v.top, WIDTH * cell, BUFFER_SHOWN * cell)
    ctx.strokeStyle = THEME.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 1; x < WIDTH; x++) {
      const px = Math.round(v.left + x * cell) + 0.5
      ctx.moveTo(px, v.top + BUFFER_SHOWN * cell)
      ctx.lineTo(px, v.top + ROWS * cell)
    }
    for (let y = BUFFER_SHOWN + 1; y < ROWS; y++) {
      const py = Math.round(v.top + y * cell) + 0.5
      ctx.moveTo(v.left, py)
      ctx.lineTo(v.left + WIDTH * cell, py)
    }
    ctx.stroke()

    // locked cells
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const c = cellAt(s.board, x, y)
        if (!c) continue
        const t = CODE_PIECE[c]
        const color = s.over ? THEME.dead : t ? PIECE_COLORS[t] : THEME.garbage
        this.block(...v.rect(x, y), color)
      }
    }

    // plan / finder overlays sit under the ghost and the live piece
    for (const o of overlays) o.draw(ctx, v)

    // ghost + active
    const g = ghost(s)
    if (s.active && g) {
      this.pieceGhost(g, PIECE_COLORS[g.type])
      for (const [x, y] of pieceCells(s.active)) if (y < ROWS) this.block(...v.rect(x, y), PIECE_COLORS[s.active.type])
    }

    // field outline (open at the top: the buffer is part of the playfield)
    ctx.strokeStyle = THEME.wellEdge
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(v.left - 1, v.top + BUFFER_SHOWN * cell)
    ctx.lineTo(v.left - 1, v.top + ROWS * cell + 1)
    ctx.lineTo(v.left + WIDTH * cell + 1, v.top + ROWS * cell + 1)
    ctx.lineTo(v.left + WIDTH * cell + 1, v.top + BUFFER_SHOWN * cell)
    ctx.stroke()

    // hold and next
    const sideW = SIDE * cell
    this.label('HOLD', 0, v.top + BUFFER_SHOWN * cell)
    if (s.hold) this.mini(s.hold, 0, v.top + (BUFFER_SHOWN + 0.6) * cell, sideW, s.holdUsed)
    this.counters(s, v.top + (BUFFER_SHOWN + 4.4) * cell, sideW)
    const nx = v.left + WIDTH * cell + GAP * cell
    this.label('NEXT', nx, v.top + BUFFER_SHOWN * cell)
    s.queue.slice(0, s.rules.previews).forEach((t, i) => {
      this.mini(t, nx, v.top + (BUFFER_SHOWN + 0.6 + i * 2.8) * cell, sideW, false)
    })
  }

  /** big B2B and Surge numbers under the hold box */
  private counters(s: GameState, y: number, w: number) {
    const { ctx, cell } = this
    const b2b = s.counters.b2b
    const surge = surgeFor(b2b)
    const big = (label: string, value: string, color: string, top: number) => {
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillStyle = THEME.label
      ctx.font = `600 ${Math.round(cell * 0.5)}px ui-sans-serif, system-ui, sans-serif`
      ctx.fillText(label, w - cell * 0.3, top)
      ctx.fillStyle = color
      ctx.font = `800 ${Math.round(cell * 1.7)}px ui-sans-serif, system-ui, sans-serif`
      ctx.fillText(value, w - cell * 0.3, top + cell * 0.6)
      ctx.textAlign = 'left'
    }
    big('B2B', b2b >= 1 ? `×${b2b}` : '0', b2b >= 1 ? '#7ee08a' : 'rgba(255,255,255,0.25)', y)
    big('SURGE', String(surge), surge ? '#ffb347' : 'rgba(255,255,255,0.25)', y + cell * 3)
    if (s.counters.combo >= 1) big('COMBO', String(s.counters.combo), '#e6e8ee', y + cell * 6)
  }

  private label(text: string, x: number, y: number) {
    const { ctx, cell } = this
    ctx.fillStyle = THEME.label
    ctx.font = `600 ${Math.round(cell * 0.5)}px ui-sans-serif, system-ui, sans-serif`
    ctx.textBaseline = 'bottom'
    ctx.fillText(text, x + cell * 0.3, y)
  }

  /** a piece centred in a SIDE-wide, 2.6-cell-tall box */
  private mini(t: PieceType, x: number, y: number, w: number, dim: boolean) {
    const { ctx } = this
    const c = this.cell * 0.8
    const cells = SHAPES[t][0]
    const xs = cells.map(([cx]) => cx)
    const ys = cells.map(([, cy]) => cy)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const pw = (Math.max(...xs) - minX + 1) * c
    const ph = (Math.max(...ys) - minY + 1) * c
    const ox = x + (w - pw) / 2
    const oy = y + (this.cell * 2.6 - ph) / 2
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.fillRect(x + this.cell * 0.2, y, w - this.cell * 0.4, this.cell * 2.6)
    for (const [cx, cy] of cells) {
      this.block(ox + (cx - minX) * c, oy + (cy - minY) * c, c, c, dim ? THEME.dead : PIECE_COLORS[t])
    }
  }

  private block(x: number, y: number, w: number, h: number, color: string) {
    const { ctx } = this
    ctx.fillStyle = color
    ctx.fillRect(x + 0.5, y + 0.5, w - 1, h - 1)
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    ctx.fillRect(x + 0.5, y + 0.5, w - 1, Math.max(2, h * 0.14))
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.fillRect(x + 0.5, y + h - 0.5 - Math.max(2, h * 0.12), w - 1, Math.max(2, h * 0.12))
  }

  /** Ghost: translucent fill plus a bright outline so it reads over the stack and overlays. */
  private pieceGhost(p: Piece, color: string) {
    const { ctx } = this
    const v = this.view
    const cells = pieceCells(p).filter(([, y]) => y < ROWS)
    const has = (x: number, y: number) => cells.some(([cx, cy]) => cx === x && cy === y)
    ctx.save()
    ctx.globalAlpha = THEME.ghostAlpha
    ctx.fillStyle = color
    for (const [x, y] of cells) {
      const [px, py, w, h] = v.rect(x, y)
      ctx.fillRect(px + 1, py + 1, w - 2, h - 2)
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    for (const [x, y] of cells) {
      const [px, py, w, h] = v.rect(x, y)
      const l = px + 1, r = px + w - 1, t = py + 1, b = py + h - 1
      if (!has(x, y + 1)) { ctx.moveTo(l, t); ctx.lineTo(r, t) }
      if (!has(x, y - 1)) { ctx.moveTo(l, b); ctx.lineTo(r, b) }
      if (!has(x - 1, y)) { ctx.moveTo(l, t); ctx.lineTo(l, b) }
      if (!has(x + 1, y)) { ctx.moveTo(r, t); ctx.lineTo(r, b) }
    }
    ctx.stroke()
    ctx.restore()
  }
}
