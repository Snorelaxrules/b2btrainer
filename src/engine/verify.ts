/**
 * Plan verification: replay a suggested sequence through the real game engine
 * (the same functions the keyboard drives), pressing exactly the keys the plan
 * shows, and check that every step lands where and how the plan claims.
 */
import * as G from './game'
import type { GameState } from './game'
import type { Move } from './movegen'
import type { Plan } from './planner'

export interface VerifyResult {
  ok: boolean
  /** 1-based step that failed */
  step?: number
  reason?: string
}

const key = (cells: readonly (readonly [number, number])[]) =>
  cells
    .map(([x, y]) => y * 16 + x)
    .sort((a, b) => a - b)
    .join(',')

function press(s: GameState, m: Move): GameState {
  switch (m) {
    case 'left':
      return G.moveX(s, -1)
    case 'right':
      return G.moveX(s, 1)
    case 'dasLeft':
      return G.slide(s, -1)
    case 'dasRight':
      return G.slide(s, 1)
    case 'softDrop':
      return G.softDrop(s)
    case 'cw':
      return G.rotate(s, 1)
    case 'ccw':
      return G.rotate(s, -1)
    case 'flip':
      return G.rotate(s, 2)
  }
}

/**
 * Replay `plan` from `start`. Fails if a piece in hand is not the one the plan
 * expects, hold is unavailable, any key does nothing, the piece lands elsewhere,
 * or the clear/spin/B2B/attack differs from what the plan claims.
 */
export function verifyPlan(start: GameState, plan: Plan): VerifyResult {
  let s = start
  for (const step of plan.steps) {
    const fail = (reason: string): VerifyResult => ({ ok: false, step: step.n, reason })
    if (s.over || !s.active) return fail('game over before this step')
    if (step.viaHold) {
      if (s.holdUsed) return fail('hold already used')
      s = G.hold(s)
      if (!s.active) return fail('hold left no piece')
    }
    if (s.active.type !== step.type) return fail(`expected ${step.type} in hand, got ${s.active.type}`)
    for (const m of step.path) {
      const next = press(s, m)
      if (next === s) return fail(`key "${m}" did nothing`)
      s = next
    }
    const landing = G.dropPosition(s.board, s.active as G.ActivePiece)
    if (key(G.pieceCells(landing)) !== key(G.pieceCells(step.piece))) return fail('piece lands somewhere else')
    const before = s.stats.pieces
    s = G.hardDrop(s)
    if (s.stats.pieces !== before + 1 || !s.last) return fail('hard drop did not lock')
    const got = s.last.result
    const want = step.result
    if (got.label !== want.label || got.lines !== want.lines || got.spin !== want.spin) {
      return fail(`claimed ${want.label}, engine gave ${got.label}`)
    }
    if (got.attack !== want.attack || got.after.b2b !== want.after.b2b || got.after.combo !== want.after.combo) {
      return fail(`claimed +${want.attack} B2B ${want.after.b2b}, engine gave +${got.attack} B2B ${got.after.b2b}`)
    }
  }
  return { ok: true }
}
