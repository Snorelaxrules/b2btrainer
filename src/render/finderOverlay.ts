/**
 * Draws spin-finder candidates over the board. Categories differ by colour AND
 * stroke style so they stay readable without colour:
 *   b2b   green  solid thick outline
 *   setup yellow dashed outline
 *   break red    dotted outline + diagonal hatching
 *   other grey   thin solid outline
 * The displayed (hovered/selected) candidate is filled and outlined in white.
 * Hold-piece candidates carry a small "H" tag.
 */
import type { FinderController } from '../app/finder'
import { PIECE_COLORS } from '../config/theme'
import type { Candidate, Category } from '../engine/finder'
import type { Cell } from '../engine/game'
import type { BoardView, Overlay } from './renderer'

export const CATEGORY_STYLE: Record<Category, { color: string; width: number; dash: number[]; label: string }> = {
  b2b: { color: '#4ade80', width: 3, dash: [], label: 'B2B clear' },
  setup: { color: '#facc15', width: 2.5, dash: [6, 4], label: 'Spin setup' },
  break: { color: '#f87171', width: 2.5, dash: [2, 3], label: 'Breaks B2B' },
  other: { color: 'rgba(200,205,215,0.45)', width: 1, dash: [], label: 'Other' },
}

const DRAW_ORDER: Category[] = ['other', 'break', 'setup', 'b2b']

/** Outer edges of a set of cells, as canvas line segments. */
function outline(ctx: CanvasRenderingContext2D, cells: readonly Cell[], view: BoardView, inset: number) {
  const has = (x: number, y: number) => cells.some(([cx, cy]) => cx === x && cy === y)
  ctx.beginPath()
  for (const [x, y] of cells) {
    if (y >= view.rows) continue
    const [px, py, w, h] = view.rect(x, y)
    const l = px + inset
    const r = px + w - inset
    const t = py + inset
    const b = py + h - inset
    if (!has(x, y + 1)) {
      ctx.moveTo(l, t)
      ctx.lineTo(r, t)
    }
    if (!has(x, y - 1)) {
      ctx.moveTo(l, b)
      ctx.lineTo(r, b)
    }
    if (!has(x - 1, y)) {
      ctx.moveTo(l, t)
      ctx.lineTo(l, b)
    }
    if (!has(x + 1, y)) {
      ctx.moveTo(r, t)
      ctx.lineTo(r, b)
    }
  }
  ctx.stroke()
}

function hatch(ctx: CanvasRenderingContext2D, cells: readonly Cell[], view: BoardView, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha = 0.35
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const [x, y] of cells) {
    if (y >= view.rows) continue
    const [px, py, w, h] = view.rect(x, y)
    ctx.moveTo(px + w * 0.25, py + h * 0.75)
    ctx.lineTo(px + w * 0.75, py + h * 0.25)
  }
  ctx.stroke()
  ctx.restore()
}

function holdTag(ctx: CanvasRenderingContext2D, c: Candidate, view: BoardView, color: string) {
  // top-most, then left-most cell
  const [x, y] = [...c.cells].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
  if (y >= view.rows) return
  const [px, py, w] = view.rect(x, y)
  ctx.save()
  ctx.fillStyle = color
  ctx.font = `700 ${Math.round(w * 0.42)}px ui-sans-serif, system-ui, sans-serif`
  ctx.textBaseline = 'top'
  ctx.fillText('H', px + w * 0.12, py + w * 0.08)
  ctx.restore()
}

export class FinderOverlay implements Overlay {
  private finder: FinderController
  constructor(finder: FinderController) {
    this.finder = finder
  }

  draw(ctx: CanvasRenderingContext2D, view: BoardView) {
    const f = this.finder
    if (!f.toggles.enabled) return
    const list = f.visible()
    const shown = f.displayed()
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const inset = Math.max(2, view.cell * 0.12)
    for (const cat of DRAW_ORDER) {
      const st = CATEGORY_STYLE[cat]
      for (const c of list) {
        if (c.category !== cat || c === shown) continue
        ctx.globalAlpha = shown ? 0.45 : 0.9
        ctx.strokeStyle = st.color
        ctx.lineWidth = st.width
        ctx.setLineDash(st.dash)
        outline(ctx, c.cells, view, inset)
        if (cat === 'break') hatch(ctx, c.cells, view, st.color)
        if (c.viaHold) holdTag(ctx, c, view, st.color)
      }
    }
    if (shown) {
      const st = CATEGORY_STYLE[shown.category]
      ctx.globalAlpha = 0.5
      ctx.fillStyle = PIECE_COLORS[shown.piece.type]
      for (const [x, y] of shown.cells) {
        if (y >= view.rows) continue
        const [px, py, w, h] = view.rect(x, y)
        ctx.fillRect(px + 1, py + 1, w - 2, h - 2)
      }
      ctx.globalAlpha = 1
      ctx.setLineDash(st.dash)
      ctx.strokeStyle = st.color
      ctx.lineWidth = st.width + 3
      outline(ctx, shown.cells, view, 1)
      ctx.setLineDash([])
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5
      outline(ctx, shown.cells, view, 1)
      if (shown.viaHold) holdTag(ctx, shown, view, '#ffffff')
    }
    ctx.restore()
  }
}
