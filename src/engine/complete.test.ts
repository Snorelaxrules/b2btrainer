import { describe, expect, it } from 'vitest'
import { findPlacements } from './finder'
import * as G from './game'
import { type PlanRequest, completePlan, stateFromRequest } from './planner'
import { verifyPlan } from './verify'
import { remapAfterClear } from '../app/planner'

const key = (cells: readonly (readonly [number, number])[]) => cells.map(([x, y]) => `${x},${y}`).sort().join(' ')

const TSD = G.boardFromRows(['#.........', '##........', '#...######', '##.#######'])

function req(over: Partial<PlanRequest>): PlanRequest {
  return { board: TSD, counters: { b2b: 2, combo: -1 }, current: 'L', hold: null, holdUsed: false, queue: ['J', 'T', 'O', 'S', 'Z'], depth: 5, beam: 60, spinRule: 'allmini+', ...over }
}

describe('finishing a setup out of order', () => {
  // a setup: L and J somewhere on the right, then the TSD
  const r = req({})
  const l = findPlacements(TSD, 'L', r.counters, false, { spinRule: 'allmini+' }).find((c) => key(c.cells) === key([[7, 2], [8, 2], [9, 2], [9, 3]]))!
  const j = findPlacements(l.board, 'J', r.counters, false, { spinRule: 'allmini+' }).find((c) => key(c.cells) === key([[4, 2], [5, 2], [6, 2], [4, 3]]))!

  it('setup exists', () => {
    expect(l).toBeDefined()
    expect(j).toBeDefined()
  })

  it('targets listed J-first are re-ordered to the pieces actually coming (L in hand, then J)', () => {
    const plan = completePlan(r, [
      { type: 'J', cells: j.cells },
      { type: 'L', cells: l.cells },
    ])
    expect(plan).not.toBeNull()
    expect(plan!.steps.map((s) => s.type)).toEqual(['L', 'J'])
    expect(plan!.steps.every((s) => !s.viaHold)).toBe(true)
    expect(verifyPlan(stateFromRequest(r), plan!)).toEqual({ ok: true })
  })

  it('uses hold when that is the only way to get the order to work', () => {
    // J is in hand and the queue offers L next: J first, or hold J and place L first
    const r2 = req({ current: 'J', queue: ['L', 'T', 'O', 'S', 'Z'] })
    const plan = completePlan(r2, [
      { type: 'L', cells: l.cells },
      { type: 'J', cells: j.cells },
    ])
    expect(plan).not.toBeNull()
    expect(verifyPlan(stateFromRequest(r2), plan!)).toEqual({ ok: true })
    expect(new Set(plan!.steps.map((s) => key(s.cells)))).toEqual(new Set([key(l.cells), key(j.cells)]))
  })

  it('returns null when the pieces left cannot place a target', () => {
    expect(completePlan(req({ current: 'O', queue: ['S', 'Z', 'I', 'O', 'S'] }), [{ type: 'L', cells: l.cells }])).toBeNull()
  })
})

describe('remapAfterClear', () => {
  it('moves targets above a cleared row down, and drops a plan that needed a cleared row', () => {
    const board = G.boardFromRows(['#########.'])
    const iCells: [number, number][] = [[9, 0], [9, 1], [9, 2], [9, 3]]
    const above = [{ type: 'O' as const, cells: [[0, 1], [1, 1], [0, 2], [1, 2]] as [number, number][] }]
    expect(remapAfterClear(board, iCells, above)).toEqual([{ type: 'O', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] }])
    expect(remapAfterClear(board, iCells, [{ type: 'O', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] }])).toBeNull()
    expect(remapAfterClear(G.emptyBoard(), [[0, 0]], above)).toBe(above)
  })
})
