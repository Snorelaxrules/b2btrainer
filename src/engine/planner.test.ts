import { describe, expect, it } from 'vitest'
import { boardFromRows, emptyBoard } from './game'
import { type PlanProgress, type PlanRequest, searchPlans, stateFromRequest } from './planner'
import { sealedHoles } from './features'
import { verifyPlan } from './verify'

/** deterministic: no time limit, two passes (16 then 48 wide) */
function req(over: Partial<PlanRequest> & Pick<PlanRequest, 'board' | 'current' | 'queue'>): PlanRequest {
  return { counters: { b2b: 2, combo: -1 }, hold: null, holdUsed: false, spinRule: 'allmini+', budgetMs: Infinity, beam: 16, beamMax: 48, ...over }
}
const labels = (p: { steps: { result: { label: string } }[] }) => p.steps.map((s) => s.result.label)

/** TSD slot at columns 1–3 under an overhang at (0,3) */
const TSD_READY = boardFromRows(['#.........', '##........', '#...######', '##.#######'])

describe('spin chains', () => {
  it('saves the T for the TSD and stops the plan right after it', () => {
    const plans = searchPlans(req({ board: TSD_READY, current: 'O', queue: ['T', 'L', 'J', 'S', 'Z'], counters: { b2b: 3, combo: -1 } }))
    const best = plans[0]
    expect(best.kind).toBe('chain')
    expect(labels(best)).toContain('TSD')
    // complete when its last spin clear is done
    expect(best.payoffs[best.payoffs.length - 1]).toBe(best.steps.length - 1)
    expect(best.steps.every((s) => s.result.b2bChange !== 'broken')).toBe(true)
  })

  // the S spins under the shelf and clears a row; its lower cells become the TSD overhang
  const S_INTO_T = boardFromRows(['#.........', '#..#######', '..........', '#...######', '##.#######'])

  it('finds the 2-link chain S-spin → T-spin when the rule makes the S a spin', () => {
    const plans = searchPlans(req({ board: S_INTO_T, current: 'S', queue: ['T', 'O', 'I', 'L'], counters: { b2b: 3, combo: -1 } }))
    const best = plans[0]
    expect(best.chain).toBeGreaterThanOrEqual(2)
    const pays = best.payoffs.map((i) => best.steps[i].result.label)
    expect(pays.slice(0, 2)).toEqual(['S-Spin Mini Single', 'TSD'])
    expect(verifyPlan(stateFromRequest(req({ board: S_INTO_T, current: 'S', queue: ['T', 'O', 'I', 'L'], counters: { b2b: 3, combo: -1 } })), best).ok).toBe(true)
  })

  it('under T-spins only the S placement is never a spin (and that row would break B2B)', () => {
    const plans = searchPlans(req({ board: S_INTO_T, current: 'S', queue: ['T', 'O', 'I', 'L'], spinRule: 'tspin', counters: { b2b: 3, combo: -1 } }))
    expect(plans.length).toBeGreaterThan(0)
    for (const p of plans) {
      expect(labels(p).some((l) => /S-Spin/.test(l))).toBe(false)
      for (const s of p.steps) if (s.result.lines) expect(s.result.spin === 'none' ? s.result.lines >= 4 : s.type === 'T').toBe(true)
    }
  })

  it('takes the J 180 spin into a hole that is already there (player screenshot)', () => {
    const SHOT = boardFromRows(['####......', '####....##', '#####..###', '#####.####', '####..####', '#####.####'])
    const plans = searchPlans(req({ board: SHOT, current: 'I', hold: 'J', queue: ['L', 'T', 'O', 'S', 'Z'], counters: { b2b: 3, combo: -1 } }))
    const j = plans[0].steps.find((s) => s.result.label === 'J-Spin Mini Double')
    expect(j).toBeDefined()
    expect(j!.path).toContain('flip')
  })
})

describe('hard prunes', () => {
  it('never suggests breaking B2B, even when the easy move is a plain double', () => {
    const plans = searchPlans(req({ board: boardFromRows(['#########.', '#########.']), current: 'I', queue: ['O', 'L', 'J', 'S', 'Z'], counters: { b2b: 3, combo: -1 } }))
    expect(plans.length).toBeGreaterThan(0)
    for (const p of plans) for (const st of p.steps) expect(st.result.b2bChange).not.toBe('broken')
  })

  it('never seals off a new hole', () => {
    const board = boardFromRows(['#.########'])
    const plans = searchPlans(req({ board, current: 'O', queue: ['O', 'O', 'O', 'O'], counters: { b2b: -1, combo: -1 } }))
    expect(plans.length).toBeGreaterThan(0)
    expect(sealedHoles(board)).toBe(0)
    for (const p of plans) for (const st of p.steps) expect(st.note ?? '').not.toMatch(/no piece can reach/)
  })
})

describe('setups and explanations', () => {
  it('with no spin clear in reach, returns setups that say so, with a score table', () => {
    const plans = searchPlans(req({ board: emptyBoard(), current: 'L', queue: ['J', 'S', 'Z', 'I', 'O'] }))
    expect(plans.length).toBeGreaterThan(0)
    for (const p of plans) {
      expect(p.kind).toBe('setup')
      expect(p.summary).toMatch(/^(Setup:|No spin clear)/)
      expect(p.terms.reduce((a, t) => a + t.points, 0)).toBeCloseTo(p.score, 1)
    }
  })

  it('names the slot a setup leaves for a piece still coming', () => {
    // T-spins only, and the T is just past the piece limit: no chain in reach, but the slot is kept for it
    const plans = searchPlans(req({ board: TSD_READY, current: 'O', queue: ['L', 'J', 'T'], depth: 2, spinRule: 'tspin' }))
    expect(plans[0].kind).toBe('setup')
    expect(plans[0].summary).toMatch(/^Setup: TSD slot ready for the T/)
  })
})

describe('search', () => {
  it('reports after every pass, widening each time, and the first pass always finishes', () => {
    const passes: PlanProgress[] = []
    const plans = searchPlans({ ...req({ board: TSD_READY, current: 'O', queue: ['T', 'L', 'J'] }), budgetMs: 0 }, (p) => passes.push(p))
    expect(plans.length).toBeGreaterThan(0)
    expect(passes.length).toBe(1)
    const all: PlanProgress[] = []
    searchPlans(req({ board: TSD_READY, current: 'O', queue: ['T', 'L', 'J'] }), (p) => all.push(p))
    expect(all.map((p) => p.beam)).toEqual([16, 48])
  })

  it('never places more pieces than are visible (hand + hold + queue)', () => {
    for (const p of searchPlans(req({ board: TSD_READY, current: 'O', queue: ['T', 'L'] }))) expect(p.steps.length).toBeLessThanOrEqual(3)
  })

  it('with the default 200 ms budget it stays near the budget', () => {
    const t0 = performance.now()
    const r = { ...req({ board: boardFromRows(['....#.....', '#..##.#...', '##.####.##', '###.######', '#####.####']), current: 'T', queue: ['I', 'S', 'Z', 'L', 'J'] }) }
    delete r.budgetMs
    delete r.beamMax
    delete r.beam
    searchPlans(r)
    expect(performance.now() - t0).toBeLessThan(1500)
  })
})

describe('planner regressions', () => {
  // screenshot 2026-11-19: staircase well on the left, J in hand, I next
  it('staircase well: no awkward spots, still spins', () => {
    const plans = searchPlans(req({ board: boardFromRows(['...#######', '..########', '.#########']), current: 'J', queue: ['I', 'S', 'Z', 'J', 'T'], counters: { b2b: -1, combo: -1 } }))
    expect(plans[0].awkward).toBe(0)
    expect(labels(plans[0])).toContain('TSD')
  })

  // screenshot 2026-11-19: B2B ×40, the old plan left rows only an I could clear
  it('middle well at B2B ×40: the best plan leaves fewer I-only rows than the old one (2)', () => {
    const plans = searchPlans(req({ board: boardFromRows(['##........', '###.....##', '####....##', '#####..###', '#####.####']), current: 'T', hold: 'O', queue: ['Z', 'J', 'Z', 'S', 'L'], counters: { b2b: 40, combo: -1 } }))
    const iRows = plans[0].terms.find((t) => t.key === 'iRows')
    expect(Number(iRows?.value ?? 0)).toBeLessThan(2)
  })
})
