import { describe, expect, it } from 'vitest'
import { boardFromRows } from './game'
import { cleanPieces, formatScore, remainingPieces, scorePlan, stackFeatures } from './planScore'
import { NO_COUNTERS, scoreClear } from './scoring'

const TSD = boardFromRows(['#.........', '##........', '#...######', '##.#######'])

describe('stack features', () => {
  it('sealed holes: a boxed-in cell is unreachable and its row must be dug; an open overhang is not', () => {
    const boxed = stackFeatures(boardFromRows(['###.......', '#.#.......', '###.......']), 'allmini+')
    expect(boxed.sealed).toBe(1)
    expect(boxed.unsafeDigRows).toBe(1)
    const open = stackFeatures(boardFromRows(['##........', '#.........', '###.......']), 'allmini+')
    expect(open.sealed).toBe(0)
    expect(open.overhangs).toBe(1)
  })

  it('B2B-unsafe dig counts rows, not cells', () => {
    // two sealed cells in one row, one in the row below
    const f = stackFeatures(boardFromRows(['##########', '#.#.######', '##.#######']), 'allmini+')
    expect(f.sealed).toBe(3)
    expect(f.unsafeDigRows).toBe(2)
  })

  it('cells under an overhang that form a spin slot are not stray overhangs', () => {
    const f = stackFeatures(TSD, 'tspin')
    expect(f.slotCovered).toBeGreaterThan(0)
    expect(f.overhangs).toBe(0)
    expect(f.sealed).toBe(0)
  })

  it('the rule decides what is a slot: an S pocket is a slot under all-mini+, a stray overhang under T-spins only', () => {
    const S_SLOT = boardFromRows(['##........', '#.........', '#..#######', '##.#######'])
    expect(stackFeatures(S_SLOT, 'allmini+').overhangs).toBe(0)
    expect(stackFeatures(S_SLOT, 'tspin').overhangs).toBeGreaterThan(0)
  })

  it('flexibility: S and Z have no clean spot on a flat stack; a step gives them one', () => {
    expect(cleanPieces(boardFromRows(['##########']))).toEqual(['I', 'O', 'T', 'J', 'L'])
    expect(cleanPieces(boardFromRows(['#.........', '##########']))).toEqual(['I', 'O', 'T', 'S', 'Z', 'J', 'L'])
  })

  it('I-dependency: deep 1-wide wells, and a stack where only an I fits cleanly', () => {
    const well = stackFeatures(boardFromRows(['####.#####', '####.#####', '####.#####', '####.#####']), 'tspin')
    expect(well.iWellExcess).toBe(2)
    const comb = stackFeatures(boardFromRows(['#.#.#.#.#.', '#.#.#.#.#.', '#.#.#.#.#.', '#.#.#.#.#.']), 'tspin')
    expect(comb.clean).toEqual(['I'])
    expect(comb.iOnly).toBe(true)
  })

  it("player's board (2026-11-19): the suggested plan leaves rows only an I can clear B2B-safe", () => {
    const start = boardFromRows(['##........', '###.....##', '####....##', '#####..###', '#####.####'])
    // the plan's end stack (T, Z, J, Z, hold→O, L): column 5 is the only gap in rows 0 and 1
    const end = boardFromRows(['##........', '###.....##', '####...###', '####...###', '####...###', '####..####', '#####.####', '#####.####'])
    expect(stackFeatures(start, 'allmini+').iRows).toBe(1)
    expect(stackFeatures(end, 'allmini+').iRows).toBe(2)
  })

  it('a well row that a spin slot fills is not I-dependent', () => {
    // TSD slot: the bottom row's only gap is under the T's foot
    expect(stackFeatures(TSD, 'tspin').iRows).toBe(0)
  })
})

describe('scorePlan', () => {
  const tsd = scoreClear('T', 'full', 2, false, { b2b: 3, combo: -1 })

  it('continuation: a T slot is worth more when a T is known to be coming', () => {
    const base = { steps: [], endBoard: TSD, rule: 'tspin' as const }
    const known = scorePlan({ ...base, remaining: ['T'] })
    const unseen = scorePlan({ ...base, remaining: ['O'] })
    const c = (s: ReturnType<typeof scorePlan>) => s.terms.find((t) => t.key === 'continuation')!.points
    expect(c(known)).toBeGreaterThan(c(unseen))
    expect(c(unseen)).toBeGreaterThan(0)
  })

  it('rewards the chain and penalises a T spent without a spin clear', () => {
    const empty = boardFromRows(['..........'])
    const spin = scorePlan({ steps: [{ type: 'T', result: tsd }], endBoard: empty, remaining: [], rule: 'tspin' })
    const wasted = scorePlan({
      steps: [{ type: 'T', result: scoreClear('T', 'none', 0, false, NO_COUNTERS) }],
      endBoard: empty,
      remaining: [],
      rule: 'tspin',
    })
    expect(spin.terms.find((t) => t.key === 'chain')!.points).toBeGreaterThan(0)
    expect(wasted.terms.find((t) => t.key === 'tWasted')!.points).toBeLessThan(0)
    expect(spin.total).toBeGreaterThan(wasted.total)
  })

  it('every term adds up to the total, and the table prints', () => {
    const s = scorePlan({ steps: [{ type: 'T', result: tsd }], endBoard: TSD, remaining: ['T', 'O'], rule: 'allmini+' })
    expect(s.terms.reduce((a, t) => a + t.points, 0)).toBeCloseTo(s.total, 1)
    expect(formatScore(s)).toMatch(/total/)
  })

  it('remaining pieces: hold first, then what the plan did not place', () => {
    expect(remainingPieces({ current: 'T', hold: 'O', queue: ['Z', 'J', 'T'] }, ['T', 'Z'])).toEqual(['O', 'J', 'T'])
  })
})
