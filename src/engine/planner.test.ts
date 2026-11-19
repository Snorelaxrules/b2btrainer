import { describe, expect, it } from 'vitest'
import { boardFromRows, emptyBoard } from './game'
import { searchPlans, tSlotLines } from './planner'
import { sealedHoles } from './features'

const NO_STREAK = { b2b: -1, combo: -1 }

/** TSD slot at columns 0–2 under an overhang at (0,2) */
const TSD_READY = boardFromRows([
  '#.........',
  '##........',
  '#...######',
  '##.#######',
])

describe('sealed holes', () => {
  it('a boxed-in cell is sealed; an overhang open to the side is not', () => {
    expect(sealedHoles(boardFromRows(['###.......', '#.#.......', '###.......']))).toBe(1)
    expect(sealedHoles(boardFromRows(['##........', '#.........', '###.......']))).toBe(0)
    // a TSD slot's cavity is reachable through the slot, so it is not sealed
    expect(sealedHoles(boardFromRows(['#.........', '##........', '#...######', '##.#######']))).toBe(0)
  })
})

describe('T-slot detection', () => {
  it('sees a TSD slot', () => {
    expect(tSlotLines(TSD_READY)).toBe(2)
  })
  it('an open well is not a slot', () => {
    expect(tSlotLines(boardFromRows(['#...######', '##.#######']))).toBe(0)
  })
})

describe('planner', () => {
  it('saves the T for the TSD while placing the other pieces cleanly, keeping B2B', () => {
    const t0 = performance.now()
    const plans = searchPlans({
      board: TSD_READY,
      counters: { b2b: 3, combo: -1 },
      current: 'O',
      hold: null,
      holdUsed: false,
      queue: ['T', 'L', 'J', 'S', 'Z'],
      depth: 5,
      beam: 100,
      spinRule: 'allmini+',
    })
    const ms = performance.now() - t0
    expect(plans.length).toBeGreaterThan(0)
    const best = plans[0]
    expect(best.breaks).toBe(0)
    const pay = best.steps[best.payoff]
    expect(pay.result.label).toBe('TSD')
    expect(pay.result.b2bChange).toBe('kept')
    expect(ms).toBeLessThan(5000)
    console.info(`planner depth 5 beam 100: ${ms.toFixed(0)} ms; best: ${best.summary}`)
  })

  it('from an empty board, never breaks B2B and builds toward a spin', () => {
    const plans = searchPlans({
      board: emptyBoard(),
      counters: { b2b: 2, combo: -1 },
      current: 'L',
      hold: null,
      holdUsed: false,
      queue: ['J', 'S', 'Z', 'I', 'T'],
      depth: 5,
      beam: 100,
      spinRule: 'allmini+',
    })
    expect(plans[0].breaks).toBe(0)
    console.info(`empty-board plan: ${plans[0].summary} | ${plans[0].steps.map((s) => `${s.type}${s.viaHold ? '(h)' : ''}:${s.result.label || '-'}`).join(' ')}`)
  })

  it('never suggests breaking B2B, even when the easy move is a plain double', () => {
    // two rows open only in the right column: an I there is a double that breaks B2B ×3
    const plans = searchPlans({
      board: boardFromRows(['#########.', '#########.']),
      counters: { b2b: 3, combo: -1 },
      current: 'I',
      hold: null,
      holdUsed: false,
      queue: ['O', 'L', 'J', 'S', 'Z'],
      depth: 5,
      beam: 60,
      spinRule: 'allmini+',
    })
    expect(plans.length).toBeGreaterThan(0)
    for (const p of plans) for (const st of p.steps) expect(st.result.b2bChange).not.toBe('broken')
  })

  it('does not seal a hole when it can stack elsewhere', () => {
    // a 1-wide gap at column 1 that O pieces can't fill: covering it would seal it
    const board = boardFromRows(['#.########'])
    const plans = searchPlans({
      board,
      counters: NO_STREAK,
      current: 'O',
      hold: null,
      holdUsed: false,
      queue: ['O', 'O', 'O', 'O'],
      depth: 5,
      beam: 60,
      spinRule: 'allmini+',
    })
    expect(plans.length).toBeGreaterThan(0)
    for (const p of plans) {
      expect(p.newSealed).toBe(0)
      for (const st of p.steps) expect(st.sealed).toBe(0)
    }
    expect(sealedHoles(board)).toBe(0)
  })

  describe('mini spins (pieces stuck under an overhang)', () => {
    // from a player's screenshot: a hole at (4,1) beside a well; a J can 180 into it
    const SHOT = boardFromRows(['####......', '####....##', '#####..###', '#####.####', '####..####', '#####.####'])
    const req = (miniSpins: 'off' | 'existing' | 'any') => ({
      board: SHOT,
      counters: { b2b: 3, combo: -1 },
      current: 'I' as const,
      hold: 'J' as const,
      holdUsed: false,
      queue: ['L', 'T', 'O', 'S', 'Z'] as ('L' | 'T' | 'O' | 'S' | 'Z')[],
      depth: 5,
      beam: 100,
      spinRule: 'allmini+' as const,
      miniSpins,
    })
    const labels = (plans: ReturnType<typeof searchPlans>) => plans.flatMap((p) => p.steps.map((s) => s.result.label))

    it('default: takes the J 180 spin into the existing hole (cleans the stack, keeps B2B)', () => {
      const plans = searchPlans(req('existing'))
      const j = plans[0].steps.find((s) => s.type === 'J')!
      expect(j.viaHold).toBe(true)
      expect(j.result.label).toBe('J-Spin Mini Double')
      expect(j.path).toContain('flip')
    }, 20000)

    it('default: never builds a cage for a stuck-piece spin (the I-spin under a J the plan placed)', () => {
      expect(labels(searchPlans(req('existing')))).not.toContain('I-Spin Mini Single')
      // (the rule itself is checked directly by the fuzz test: no stuck-piece spin under a plan-built roof)
    }, 20000)

    it("'off': no stuck-piece spin clears at all", () => {
      expect(labels(searchPlans(req('off'))).filter((l) => /Spin/.test(l) && !/^TS|^T-Spin/.test(l))).toEqual([])
    }, 20000)
  })

  it('explains itself when there is no clean option (a player\'s board with a well and a notch)', () => {
    const board = boardFromRows(['#.........', '#.........', '##.......#', '##......##', '###.....##', '####...###', '####..####', '####.#####'])
    const plans = searchPlans({ board, counters: { b2b: 2, combo: -1 }, current: 'L', hold: 'I', holdUsed: false, queue: ['O', 'J', 'S', 'I', 'Z'], depth: 5, beam: 60, spinRule: 'allmini+' })
    expect(plans.length).toBeGreaterThan(0)
    for (const p of plans) {
      // no B2B-safe clear exists here, and the summary must not pretend the stack stays clean
      expect(p.payoffs).toEqual([])
      if (p.awkward) expect(p.summary).toMatch(/least-bad stacking/)
      if (p.awkward) expect(p.steps.some((s) => s.note)).toBe(true)
    }
  })
})

describe('planner regressions', () => {
  // screenshot 2026-11-19: staircase well on the left, J in hand, I next. Look-alike
  // T-slots crowded the clean I-in-the-well line out of the confirmed front, and a
  // 6-piece horizon dropped every line that ended with a piece still in hold.
  const STAIRS = boardFromRows(['...#######', '..########', '.#########'])
  for (const [beam, depth] of [[40, 5], [40, 6], [100, 6]] as const) {
    it(`staircase well, beam ${beam} depth ${depth}: no awkward spots, still spins`, () => {
      const plans = searchPlans({
        board: STAIRS,
        counters: { b2b: -1, combo: -1 },
        current: 'J',
        hold: null,
        holdUsed: false,
        queue: ['I', 'S', 'Z', 'J', 'T'],
        depth,
        beam,
        spinRule: 'allmini+',
        miniSpins: 'existing',
      })
      expect(plans[0].awkward).toBe(0)
      expect(plans[0].steps.some((s) => s.result.label === 'TSD')).toBe(true)
    }, 20000)
  }
})

