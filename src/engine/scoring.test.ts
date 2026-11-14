import { describe, expect, it } from 'vitest'
import { type ActivePiece, type GameState, boardFromRows, hardDrop, newGame, rotate, spawnPiece } from './game'
import { NO_COUNTERS, detectSpin, resolveLock, scoreClear, surgeFor, surgeSegments } from './scoring'
import { Session } from './session'

const T = (rot: 0 | 1 | 2 | 3, x: number, y: number, kick = 0): ActivePiece => ({
  type: 'T',
  rot,
  x,
  y,
  rotated: true,
  kick,
})

/** T pointing down into a slot at columns 3–5; both bottom corners filled, top-left overhang. */
const TSD_BOARD = boardFromRows([
  '####......', // row 2: overhang at (3,2)
  '###...####', // row 1
  '####.#####', // row 0
])
/** same slot with the bottom-right corner open: 3 corners but only one facing */
const MINI_BOARD = boardFromRows([
  '######....', // row 2: (3,2) and (5,2) filled
  '###...####',
  '####..####',
])

describe('T-spin detection (3-corner rule)', () => {
  it('both facing corners + one more = full T-spin', () => {
    expect(detectSpin(TSD_BOARD, T(2, 3, 2), 'tspin')).toBe('full')
  })

  it('three corners but one facing corner open = mini', () => {
    expect(detectSpin(MINI_BOARD, T(2, 3, 2), 'tspin')).toBe('mini')
  })

  it('a mini is upgraded to full when the 5th kick test was used', () => {
    expect(detectSpin(MINI_BOARD, T(2, 3, 2, 4), 'tspin')).toBe('full')
  })

  it('a 180 whose 5th test was used stays a mini (only 90° TST/fin kicks upgrade)', () => {
    expect(detectSpin(MINI_BOARD, { ...T(2, 3, 2, 4), flip: true }, 'tspin')).toBe('mini')
  })

  it('not a spin when the last action was not a rotation', () => {
    expect(detectSpin(TSD_BOARD, { ...T(2, 3, 2), rotated: false }, 'tspin')).toBe('none')
  })

  it('fewer than three corners = no spin', () => {
    const open = boardFromRows(['..........', '###...####', '####.#####'])
    expect(detectSpin(open, T(2, 3, 2), 'tspin')).toBe('none')
  })
})

describe('all-spin rules (immobile test)', () => {
  // S locked in a notch: can't move left (wall), right, or up (overhang)
  const board = boardFromRows([
    '##########', // row 2: overhang
    '#..#######', // row 1
    '..########', // row 0
  ])
  const S: ActivePiece = { type: 'S', rot: 0, x: 0, y: 1, rotated: true, kick: 0 }

  it('T-spins only: an immobile S is not a spin', () => {
    expect(detectSpin(board, S, 'tspin')).toBe('none')
  })
  it('All-Mini+: an immobile S is a mini', () => {
    expect(detectSpin(board, S, 'allmini+')).toBe('mini')
  })
  it('All-spin: an immobile S is a full spin', () => {
    expect(detectSpin(board, S, 'allspin')).toBe('full')
  })
  it('a mobile S is never a spin', () => {
    expect(detectSpin(boardFromRows(['..........']), { ...S, y: 5 }, 'allspin')).toBe('none')
  })
  it('All-Mini+: S-spin mini double sends 1 and starts B2B', () => {
    const r = scoreClear('S', 'mini', 2, false, NO_COUNTERS)
    expect(r).toMatchObject({ label: 'S-Spin Mini Double', attack: 1, b2bChange: 'started', difficult: true })
  })
})

describe('B2B transitions', () => {
  it('starts on the first difficult clear (no bonus yet)', () => {
    const r = scoreClear('T', 'full', 2, false, NO_COUNTERS)
    expect(r).toMatchObject({ label: 'TSD', attack: 4, b2bChange: 'started', after: { b2b: 0, combo: 0 } })
  })

  it('keeps on a quad or spin, with +1 attack', () => {
    const r = scoreClear('I', 'none', 4, false, { b2b: 0, combo: -1 })
    expect(r).toMatchObject({ label: 'Quad', attack: 5, b2bChange: 'kept', after: { b2b: 1 } })
  })

  it('spin minis keep B2B', () => {
    const r = scoreClear('T', 'mini', 1, false, { b2b: 3, combo: -1 })
    expect(r).toMatchObject({ label: 'TSMS', attack: 1, b2bChange: 'kept', after: { b2b: 4 } })
  })

  it('breaks on a non-difficult clear', () => {
    const r = scoreClear('L', 'none', 2, false, { b2b: 2, combo: -1 })
    expect(r).toMatchObject({ attack: 1, b2bChange: 'broken', surge: 0, after: { b2b: -1 } })
  })

  it('non-clearing placements (including spins) leave B2B alone and reset combo', () => {
    const r = scoreClear('T', 'full', 0, false, { b2b: 5, combo: 3 })
    expect(r).toMatchObject({ label: 'T-Spin', attack: 0, b2bChange: 'unchanged', after: { b2b: 5, combo: -1 } })
  })
})

describe('surge (B2B charging)', () => {
  it('charges from B2B ×4 with 4 lines, +1 per level', () => {
    expect([3, 4, 5, 8].map((b) => surgeFor(b))).toEqual([0, 4, 5, 8])
  })

  it('releases on break, on top of the breaking clear', () => {
    const r = scoreClear('J', 'none', 1, false, { b2b: 8, combo: -1 })
    expect(r).toMatchObject({ surge: 8, attack: 8, b2bChange: 'broken' })
    expect(surgeSegments(8)).toEqual([3, 3, 2])
    expect(surgeSegments(7)).toEqual([3, 2, 2])
  })
})

describe('attack', () => {
  it('base table', () => {
    const at = (spin: 'none' | 'mini' | 'full', lines: number) => scoreClear('T', spin, lines, false, NO_COUNTERS).attack
    expect([1, 2, 3, 4].map((l) => at('none', l))).toEqual([0, 1, 2, 4])
    expect([1, 2, 3].map((l) => at('full', l))).toEqual([2, 4, 6])
    expect([1, 2].map((l) => at('mini', l))).toEqual([0, 1])
  })

  it('combo multiplies: 1-combo double = 1.25 → 1, B2B quad at 3 combo = (4+1)×1.75 → 8', () => {
    expect(scoreClear('L', 'none', 2, false, { b2b: -1, combo: 0 }).attack).toBe(1)
    expect(scoreClear('I', 'none', 4, false, { b2b: 0, combo: 2 }).attack).toBe(8)
  })

  it('zero-attack clears at combo ≥ 2 send ln(1 + 1.25·combo), rounded down', () => {
    expect(scoreClear('L', 'none', 1, false, { b2b: -1, combo: 0 }).attack).toBe(0) // combo 1: 0
    expect(scoreClear('L', 'none', 1, false, { b2b: -1, combo: 1 }).attack).toBe(1) // ln 3.5 = 1.25
    expect(scoreClear('L', 'none', 1, false, { b2b: -1, combo: 7 }).attack).toBe(2) // ln 11 = 2.40
  })

  it('all clear: +5 attack and +2 B2B, never breaks B2B', () => {
    const r = scoreClear('L', 'none', 2, true, NO_COUNTERS)
    expect(r).toMatchObject({ attack: 6, after: { b2b: 2 }, allClear: true })
    const q = scoreClear('I', 'none', 4, true, { b2b: 3, combo: -1 })
    expect(q).toMatchObject({ attack: 10, after: { b2b: 6 }, b2bChange: 'kept' })
  })

  it('resolveLock detects an all clear', () => {
    const board = boardFromRows(['#########.', '#########.', '#########.', '#########.'])
    const I: ActivePiece = { type: 'I', rot: 1, x: 7, y: 3, rotated: false, kick: -1 }
    const { result } = resolveLock(board, I, NO_COUNTERS, 'allmini+')
    expect(result).toMatchObject({ lines: 4, allClear: true, attack: 9, label: 'Quad + All Clear' })
  })
})

describe('in the game', () => {
  it('a kicked TST scores 6, then a B2B 1-combo TSD scores (4+1)×1.25 → 6; undo restores counters and attack', () => {
    const s0 = newGame({ seed: 1 })
    let s: GameState = {
      ...s0,
      board: boardFromRows(['..#.......', '...#######', '##.#######', '#..#######', '##.#######']),
      active: { ...spawnPiece('T'), x: 0, y: 4 },
    }
    s = hardDrop(rotate(s, -1))
    expect(s.last!.result).toMatchObject({ label: 'TST', attack: 6, b2bChange: 'started' })
    expect(s.counters.b2b).toBe(0)

    const session = new Session({ seed: 1 })
    session.load({ ...s, board: TSD_BOARD, active: T(2, 3, 2) })
    const before = session.state
    session.hardDrop()
    expect(session.state.last!.result).toMatchObject({ label: 'TSD', attack: 6, b2bChange: 'kept' })
    expect(session.state.stats.attack).toBe(12)
    expect(session.state.stats.clears).toMatchObject({ TST: 1, TSD: 1 })
    session.undo()
    expect(session.state).toBe(before)
    expect(session.state.counters).toEqual({ b2b: 0, combo: 0 })
    expect(session.state.stats.attack).toBe(6)
  })
})
