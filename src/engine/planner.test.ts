import { describe, expect, it } from 'vitest'
import { boardFromRows, emptyBoard } from './game'
import { searchPlans, tSlotLines } from './planner'

/** TSD slot at columns 0–2 under an overhang at (0,2) */
const TSD_READY = boardFromRows([
  '#.........',
  '##........',
  '#...######',
  '##.#######',
])

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
})
