/**
 * Draws the selected lookahead plan on the board as numbered pieces:
 * step 1 brightest, later steps fainter, the payoff (B2B clear) outlined green.
 * Hold steps are tagged "H" next to their number.
 */
import type { PlannerController } from '../app/planner'
import { PIECE_COLORS } from '../config/theme'
import type { Cell } from '../engine/game'
import type { BoardView, Overlay } from './renderer'

const PAYOFF = '#4ade80'

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

export class PlanOverlay implements Overlay {
  private planner: PlannerController
  constructor(planner: PlannerController) {
    this.planner = planner
  }

  draw(ctx: CanvasRenderingContext2D, view: BoardView) {
    const pl = this.planner
    const plan = pl.settings.enabled ? pl.plan : null
    if (!plan) return
    ctx.save()
    ctx.lineJoin = 'round'
    plan.steps.forEach((step, i) => {
      const color = PIECE_COLORS[step.type]
      const first = i === 0
      const isPayoff = plan.payoffs.includes(i)
      ctx.globalAlpha = first ? 0.6 : 0.32
      ctx.fillStyle = color
      for (const [x, y] of step.cells) {
        if (y >= view.rows) continue
        const [px, py, w, h] = view.rect(x, y)
        ctx.fillRect(px + 1, py + 1, w - 2, h - 2)
      }
      ctx.globalAlpha = 1
      ctx.setLineDash(first ? [] : [4, 3])
      ctx.strokeStyle = color
      ctx.lineWidth = first ? 2.5 : 1.5
      outline(ctx, step.cells, view, 1.5)
      if (isPayoff) {
        ctx.setLineDash([])
        ctx.strokeStyle = PAYOFF
        ctx.lineWidth = 3.5
        outline(ctx, step.cells, view, -1)
      }
      // number badge on the top-most, left-most cell
      const [bx, by] = [...step.cells].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
      if (by < view.rows) {
        const [px, py, w] = view.rect(bx, by)
        const label = `${step.n}${step.viaHold ? 'H' : ''}`
        ctx.font = `800 ${Math.round(w * 0.55)}px ui-sans-serif, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineWidth = 3
        ctx.setLineDash([])
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'
        ctx.strokeText(label, px + w / 2, py + w / 2)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(label, px + w / 2, py + w / 2)
      }
    })
    ctx.restore()
  }
}
