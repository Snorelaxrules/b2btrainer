import { describe, expect, it } from 'vitest'
import { type Candidate, findPlacements } from './finder'
import * as G from './game'
import { type Plan, type PlanRequest, type PlanStep, searchPlans, stateFromRequest } from './planner'
import { NO_COUNTERS } from './scoring'
import { verifyPlan } from './verify'

const key = (cells: readonly (readonly [number, number])[]) =>
  cells
    .map(([x, y]) => y * 16 + x)
    .sort((a, b) => a - b)
    .join(',')

/** Build a plan by hand from candidates (each evaluated however the caller chose). */
function planOf(cands: { c: Candidate; type: G.ActivePiece['type'] }[]): Plan {
  const steps: PlanStep[] = cands.map(({ c, type }, i) => ({
    n: i + 1,
    type,
    piece: c.piece,
    viaHold: c.viaHold,
    path: c.path,
    result: c.result,
    cells: c.cells,
    sealed: 0,
  }))
  return { steps, payoffs: [], payoff: -1, attack: 0, b2bClears: 0, breaks: 0, slotAfter: 0, newSealed: 0, score: 0, summary: 'hand-made' }
}

/** TSD slot at columns 1–3 (T points down into column 2), roofed at (1,2)… open above columns 2–3. */
const TSD_BOARD = G.boardFromRows([
  '#.........',
  '##........',
  '#...######',
  '##.#######',
])

function request(over: Partial<PlanRequest>): PlanRequest {
  return {
    board: TSD_BOARD,
    counters: { b2b: 2, combo: -1 },
    current: 'O',
    hold: null,
    holdUsed: false,
    queue: ['T', 'L', 'J', 'S', 'Z'],
    depth: 3,
    beam: 60,
    spinRule: 'allmini+',
    ...over,
  }
}

describe('blocked by an earlier placement', () => {
  const req = request({})
  const start = stateFromRequest(req)
  // the TSD, evaluated on the ORIGINAL board
  const tsd = findPlacements(TSD_BOARD, 'T', req.counters, false, { spinRule: 'allmini+' }).find(
    (c) => c.result.label === 'TSD',
  )!
  // an O dropped into the slot's opening (columns 2–3, rows 1–2): it plugs the T's spot
  const lid = findPlacements(TSD_BOARD, 'O', req.counters, false, { spinRule: 'allmini+' }).find(
    (c) => key(c.cells) === key([[2, 1], [3, 1], [2, 2], [3, 2]]),
  )!

  it('setup is as described', () => {
    expect(tsd).toBeDefined()
    expect(lid).toBeDefined()
  })

  it('a plan whose later step was evaluated on a stale board (O lid, then TSD) is rejected', () => {
    const stale = planOf([
      { c: lid, type: 'O' },
      { c: tsd, type: 'T' },
    ])
    const v = verifyPlan(start, stale)
    expect(v.ok).toBe(false)
    expect(v.step).toBe(2)
  })

  it('the planner never proposes it: every plan replays, and none puts the lid on before the TSD', () => {
    const plans = searchPlans(req, undefined, 3, { verify: false })
    expect(plans.length).toBeGreaterThan(0)
    for (const p of plans) {
      expect(verifyPlan(start, p)).toEqual({ ok: true })
      const lidAt = p.steps.findIndex((s) => key(s.cells) === key(lid.cells))
      const tsdAt = p.steps.findIndex((s) => s.result.label === 'TSD')
      if (lidAt >= 0 && tsdAt >= 0) expect(lidAt).toBeGreaterThan(tsdAt)
    }
    // and the best plan cashes the TSD (holding the O to get the T first)
    expect(plans[0].steps.some((s) => s.result.label === 'TSD')).toBe(true)
  })
})

describe('hold changes the order', () => {
  // current O, empty hold, queue T L J…: the TSD needs the T, which only arrives first via hold
  const req = request({})
  const start = stateFromRequest(req)
  const cands = (board: G.Board, t: G.ActivePiece['type'], viaHold: boolean, counters = req.counters) =>
    findPlacements(board, t, counters, viaHold, { spinRule: 'allmini+' })

  it('rejects a plan that forgets an empty hold consumes the next piece', () => {
    // step 1: hold O, place T (correct). step 2 claims "T again" or "O" without hold: wrong,
    // after holding into an empty hold the next piece in hand is L.
    const t1 = cands(TSD_BOARD, 'T', true).find((c) => c.result.label === 'TSD')!
    const wrong = cands(t1.board, 'O', false, t1.result.after)[0]
    const plan = planOf([
      { c: t1, type: 'T' },
      { c: wrong, type: 'O' },
    ])
    const v = verifyPlan(start, plan)
    expect(v).toMatchObject({ ok: false, step: 2 })
    expect(v.reason).toMatch(/expected O in hand, got L/)
  })

  it('rejects a second hold in the same turn and a hold when it is already used', () => {
    const t1 = cands(TSD_BOARD, 'T', true).find((c) => c.result.label === 'TSD')!
    const used = { ...start, holdUsed: true }
    expect(verifyPlan(used, planOf([{ c: t1, type: 'T' }]))).toMatchObject({ ok: false, step: 1 })
  })

  it('the planner gets the order right: hold O, TSD with T, then the O comes back from hold', () => {
    const plans = searchPlans({ ...req, depth: 3 }, undefined, 3, { verify: false })
    const best = plans[0]
    expect(verifyPlan(start, best)).toEqual({ ok: true })
    expect(best.steps[0]).toMatchObject({ type: 'T', viaHold: true })
    expect(best.steps[0].result.label).toBe('TSD')
    // every plan's piece order matches what the engine actually deals
    for (const p of plans) expect(verifyPlan(start, p)).toEqual({ ok: true })
  })

  it('with hold already used at the root, no plan holds on step 1', () => {
    const r2 = request({ current: 'T', hold: 'O', holdUsed: true })
    const s2 = stateFromRequest(r2)
    for (const p of searchPlans(r2, undefined, 3, { verify: false })) {
      expect(p.steps[0].viaHold).toBe(false)
      expect(verifyPlan(s2, p)).toEqual({ ok: true })
    }
  })
})

describe('only known pieces', () => {
  it('never places more pieces than are visible (current + hold + queue)', () => {
    const r = request({ queue: ['T', 'L'], depth: 6 })
    for (const p of searchPlans(r, undefined, 3)) expect(p.steps.length).toBeLessThanOrEqual(3)
  })

  it('a plan that needs a piece beyond the visible queue fails verification on piece type', () => {
    // the engine fills unseen queue slots from an arbitrary bag; a plan can't count on them
    const r = request({ queue: ['T'] })
    const start = stateFromRequest(r)
    const t = findPlacements(TSD_BOARD, 'T', NO_COUNTERS, true, { spinRule: 'allmini+' })[0]
    const guess = start.queue[1] === 'I' ? 'J' : 'I'
    const g = findPlacements(t.board, guess, NO_COUNTERS, false, { spinRule: 'allmini+' })[0]
    expect(
      verifyPlan(
        start,
        planOf([
          { c: t, type: 'T' },
          { c: g, type: guess },
        ]),
      ).ok,
    ).toBe(false)
  })
})
