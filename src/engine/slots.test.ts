import { describe, expect, it } from 'vitest'
import { boardFromRows } from './game'
import { NO_COUNTERS, resolveLock } from './scoring'
import { allSlots, slotTypes, slots } from './slots'

/** TSD slot: T pointing down into the 3-wide notch, overhang at (0,3) */
const TSD = boardFromRows(['#.........', '##........', '#...######', '##.#######'])
/** TST slot: 3-deep column at x=1 with a side notch at row 1, wall-side roof */
const TST = boardFromRows(['##........', '#.........', '#.########', '#..#######', '#.########'])
/** S-spin slot: the S rotates into the stepped notch under the overhang and clears 2 */
const S_SLOT = boardFromRows(['##........', '#.........', '#..#######', '##.#######'])
/** a plain stack: nothing to spin into */
const FLAT = boardFromRows(['##........', '####......', '#####.####'])

describe('slots()', () => {
  it('finds the TSD in a standard TSD slot', () => {
    const t = slots(TSD, 'T', 'allmini+')
    expect(t[0]).toMatchObject({ label: 'TSD', spin: 'full', lines: 2 })
    // the same slot is a TSD under every rule
    expect(slots(TSD, 'T', 'tspin')[0].label).toBe('TSD')
  })

  it('finds the TST (5th-kick upgrade) in a TST slot', () => {
    const t = slots(TST, 'T', 'tspin')
    expect(t.map((s) => s.label)).toContain('TST')
    const tst = t.find((s) => s.label === 'TST')!
    expect(tst.piece.kick).toBe(4)
    expect(tst.piece.flip).toBe(false)
  })

  it('finds an S-spin that clears lines, and the rule decides what it is worth', () => {
    expect(slots(S_SLOT, 'S', 'allmini+')[0]).toMatchObject({ label: 'S-Spin Mini Double', spin: 'mini', lines: 2 })
    expect(slots(S_SLOT, 'S', 'allspin')[0]).toMatchObject({ label: 'S-Spin Double', spin: 'full' })
    // under T-spins only, an S placement is never a spin
    expect(slots(S_SLOT, 'S', 'tspin')).toEqual([])
    expect(slotTypes(S_SLOT, 'tspin')).not.toContain('S')
  })

  it('a board with no spin slots has none for any piece', () => {
    for (const rule of ['tspin', 'allmini+', 'allspin'] as const) {
      const all = allSlots(FLAT, rule)
      expect(Object.values(all).every((s) => s.length === 0)).toBe(true)
    }
  })

  it('O never spins while O-spins are off', () => {
    expect(slots(S_SLOT, 'O', 'allspin')).toEqual([])
  })

  it('continuation: which pieces have a slot before and after a spin clear', () => {
    expect(slotTypes(TSD, 'tspin')).toEqual(['T'])
    const tsd = slots(TSD, 'T', 'tspin')[0]
    const after = resolveLock(TSD, tsd.piece, NO_COUNTERS, 'tspin')
    expect(after.result.label).toBe('TSD')
    expect(slotTypes(after.board, 'allmini+')).toEqual([])
  })

  it('every slot is a real spin clear when the engine locks it', () => {
    for (const [board, rule] of [[TSD, 'allmini+'], [TST, 'allmini+'], [S_SLOT, 'allspin']] as const) {
      for (const list of Object.values(allSlots(board, rule))) {
        for (const s of list) {
          const { result } = resolveLock(board, s.piece, NO_COUNTERS, rule)
          expect(result.spin).toBe(s.spin)
          expect(result.lines).toBe(s.lines)
        }
      }
    }
  })

  it('is cheap enough to run for all 7 pieces per search node', () => {
    const t0 = performance.now()
    for (let i = 0; i < 50; i++) allSlots(TST, 'allmini+')
    const ms = (performance.now() - t0) / 50
    console.info(`allSlots: ${ms.toFixed(2)} ms`)
    expect(ms).toBeLessThan(10)
  })
})
