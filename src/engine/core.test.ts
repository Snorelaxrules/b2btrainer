import { describe, expect, it } from 'vitest'
import {
  type ActivePiece,
  type GameState,
  boardFromRows,
  cellAt,
  fits,
  hardDrop,
  hold,
  moveX,
  newGame,
  parseQueue,
  pieceCells,
  rotate,
  softDrop,
  spawnPiece,
  tick,
} from './game'
import { drawPiece, newBag } from './rng'
import { Session } from './session'
import { InputController } from '../input/controller'
import { PIECES, type PieceType } from './pieces'

const sorted = (cells: [number, number][]) => [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])

function stateWith(type: PieceType, rows: string[] = [], at?: Partial<ActivePiece>): GameState {
  const s = newGame({ seed: 1 })
  return { ...s, board: boardFromRows(rows), active: { ...spawnPiece(type), ...at } }
}

describe('SRS+ kicks', () => {
  it('T-spin triple: 0 → L takes the fifth kick (+1, −2) into the slot and clears three lines', () => {
    let s = stateWith(
      'T',
      [
        '..#.......', // row 4: overhang
        '...#######', // row 3
        '##.#######', // row 2
        '#..#######', // row 1
        '##.#######', // row 0
      ],
      { rot: 0, x: 0, y: 4 },
    )
    expect(fits(s.board, s.active!)).toBe(true)
    s = rotate(s, -1)
    expect(s.active).toMatchObject({ rot: 3, x: 1, y: 2, kick: 4, rotated: true })
    expect(sorted(pieceCells(s.active!))).toEqual([[1, 1], [2, 0], [2, 1], [2, 2]])
    s = hardDrop(s)
    expect(s.stats.lines).toBe(3)
    expect(cellAt(s.board, 2, 1)).toBeTruthy()
    expect(cellAt(s.board, 0, 0)).toBe(0)
  })

  it('I piece 0 → R uses the SRS+ second test (+1, 0), not SRS (−2, 0)', () => {
    const s = rotate(stateWith('I', ['.....#....'], { x: 3, y: 3 }), 1)
    expect(s.active).toMatchObject({ rot: 1, x: 4, y: 3, kick: 1 })
    expect(sorted(pieceCells(s.active!))).toEqual([[6, 0], [6, 1], [6, 2], [6, 3]])
  })

  it('I piece kicks off the right wall rotating R → 0', () => {
    const s = rotate(stateWith('I', [], { rot: 1, x: 7, y: 5 }), -1)
    expect(s.active).toMatchObject({ rot: 0, x: 6, y: 5, kick: 1 })
  })

  it('O piece never kicks', () => {
    const s0 = stateWith('O')
    const s = rotate(s0, 1)
    expect(s.active).toMatchObject({ x: s0.active!.x, y: s0.active!.y, rot: 1 })
  })
})

describe('180 rotation', () => {
  it('rotates in place when there is room', () => {
    const s0 = stateWith('T')
    const s = rotate(s0, 2)
    expect(s.active).toMatchObject({ rot: 2, x: s0.active!.x, y: s0.active!.y, kick: 0 })
  })

  it('kicks up one row when flipping a T on the floor (0 → 2 first test)', () => {
    const s = rotate(stateWith('T', [], { x: 3, y: 1 }), 2)
    expect(s.active).toMatchObject({ rot: 2, x: 3, y: 2, kick: 1 })
  })

  it('R → L uses the 180 table (+1, 0 off the left wall)', () => {
    const s = rotate(stateWith('T', [], { rot: 1, x: -1, y: 3 }), 2)
    expect(s.active).toMatchObject({ rot: 3, x: 0, y: 3, kick: 1 })
  })
})

describe('7-bag', () => {
  it('deals every piece once per bag and is deterministic for a seed', () => {
    const deal = (seed: number, n: number) => {
      let b = newBag(seed)
      const out: PieceType[] = []
      for (let i = 0; i < n; i++) {
        const d = drawPiece(b)
        out.push(d.piece)
        b = d.bag
      }
      return out
    }
    const a = deal(12345, 70)
    expect(deal(12345, 70)).toEqual(a)
    expect(deal(54321, 70)).not.toEqual(a)
    for (let i = 0; i < 70; i += 7) expect([...a.slice(i, i + 7)].sort()).toEqual([...PIECES].sort())
  })

  it('custom queue forces the first pieces, then the seeded bag continues', () => {
    const plain = newGame({ seed: 7 })
    const custom = newGame({ seed: 7, customQueue: parseQueue('tt o') })
    expect(custom.active!.type).toBe('T')
    expect(custom.queue.slice(0, 2)).toEqual(['T', 'O'])
    // after the forced pieces comes exactly the unforced game's sequence
    expect(custom.queue.slice(2, 6)).toEqual([plain.active!.type, ...plain.queue.slice(0, 3)])
  })
})

describe('hold and game over', () => {
  it('hold is one use per piece and swaps with the held piece', () => {
    const s0 = newGame({ seed: 3 })
    const first = s0.active!.type
    const s1 = hold(s0)
    expect(s1.hold).toBe(first)
    expect(s1.active!.type).toBe(s0.queue[0])
    expect(hold(s1)).toBe(s1)
    const s2 = hold(hardDrop(s1))
    expect(s2.active!.type).toBe(first)
  })

  it('block out when the spawn area is filled', () => {
    const s = newGame({ seed: 1 })
    // columns 3–6 filled up through row 20: every spawn overlaps
    const blocked = { ...s, board: boardFromRows(Array(21).fill('...####...')) }
    const after = hardDrop({ ...blocked, active: { ...spawnPiece('I'), rot: 1, x: -2, y: 25 } })
    expect(after.over).toBe('blockout')
  })

  it('lock out when a piece locks entirely above the visible field', () => {
    const s = newGame({ seed: 1 })
    const tall = { ...s, board: boardFromRows(Array(21).fill('#.........')), active: { ...spawnPiece('O'), x: 0, y: 22 } }
    // O on top of column 0's 21-high tower lands in rows 21–22: fully hidden
    expect(hardDrop(tall).over).toBe('lockout')
  })
})

describe('gravity', () => {
  it('none: time passing never moves or locks the piece', () => {
    const s = newGame({ seed: 1 })
    expect(tick(s, 60_000)).toBe(s)
  })

  it('normal: locks 0.5 s after touching down', () => {
    let s = softDrop(newGame({ seed: 1, rules: { gravity: 'normal' } }))
    s = tick(s, 499)
    expect(s.stats.pieces).toBe(0)
    s = tick(s, 1)
    expect(s.stats.pieces).toBe(1)
  })
})

describe('handling', () => {
  const PRO = { das: 75, arr: 0, dcd: 0, sdf: Infinity, carryDas: true }

  it('DAS 75 ms, ARR 0: taps once, then slides to the wall once charged', () => {
    const game = new Session({ seed: 1, customQueue: ['T'] })
    const input = new InputController(PRO)
    input.press('moveRight', 0, game)
    expect(game.state.active!.x).toBe(4)
    input.update(74, game)
    expect(game.state.active!.x).toBe(4)
    input.update(75, game)
    expect(game.state.active!.x).toBe(7)
  })

  it('newest direction wins; releasing it falls back to the other and re-charges', () => {
    const game = new Session({ seed: 1, customQueue: ['T'] })
    const input = new InputController(PRO)
    input.press('moveLeft', 0, game)
    input.press('moveRight', 10, game)
    input.update(84, game)
    expect(game.state.active!.x).toBe(3)
    input.update(85, game)
    expect(game.state.active!.x).toBe(7)
    input.release('moveRight', 100)
    input.update(174, game)
    expect(game.state.active!.x).toBe(7)
    input.update(175, game)
    expect(game.state.active!.x).toBe(0)
  })

  it('DAS charge survives rotation, hold and new pieces (DCD 0)', () => {
    const game = new Session({ seed: 1, customQueue: ['T', 'T', 'T'] })
    const input = new InputController(PRO)
    input.press('moveLeft', 0, game)
    input.update(80, game)
    input.press('rotateCW', 90, game)
    expect(Math.min(...pieceCells(game.state.active!).map(([x]) => x))).toBe(0)
    input.press('hardDrop', 100, game)
    expect(Math.min(...pieceCells(game.state.active!).map(([x]) => x))).toBe(0)
    input.press('hold', 110, game)
    expect(Math.min(...pieceCells(game.state.active!).map(([x]) => x))).toBe(0)
  })

  it('infinite soft drop reaches the floor without locking', () => {
    const game = new Session({ seed: 1 })
    const input = new InputController(PRO)
    input.press('softDrop', 0, game)
    expect(Math.min(...pieceCells(game.state.active!).map(([, y]) => y))).toBe(0)
    expect(game.state.stats.pieces).toBe(0)
  })
})

describe('undo / redo', () => {
  /** a deterministic little game: moves, rotations, holds, drops */
  function play(session: Session, steps: number) {
    for (let i = 0; i < steps; i++) {
      const n = session.state.stats.pieces
      if (n % 3 === 1) session.hold()
      if (n % 4 === 0) session.rotate(1)
      // spread pieces over the width so the stack stays low
      for (let k = 0; k < (n * 3) % 5; k++) session.moveX(n % 2 ? 1 : -1)
      session.hardDrop()
    }
    expect(session.state.over).toBe(false)
  }

  it('restores every earlier state exactly, and redo replays them', () => {
    const session = new Session({ seed: 99 })
    const states: GameState[] = [session.state]
    for (let i = 0; i < 12; i++) {
      play(session, 1)
      states.push(session.state)
    }
    for (let i = states.length - 2; i >= 0; i--) {
      expect(session.undo()).toBe(true)
      expect(session.state).toBe(states[i])
    }
    expect(session.undo()).toBe(false)
    for (let i = 1; i < states.length; i++) {
      expect(session.redo()).toBe(true)
      expect(session.state).toBe(states[i])
    }
    expect(session.redo()).toBe(false)
  })

  it('undo restores board, piece, queue, hold flag, bag RNG and counters', () => {
    const session = new Session({ seed: 5 })
    play(session, 5)
    const before = session.state
    const snapshot = structuredClone(before)
    session.hold()
    session.hardDrop()
    session.undo()
    expect(session.state).toEqual(snapshot)
    expect(session.state.holdUsed).toBe(false)
    // the bag continues identically from the restored RNG state
    session.hold()
    session.hardDrop()
    const replayed = session.state
    session.undo()
    session.hold()
    session.hardDrop()
    expect(session.state).toEqual(replayed)
  })

  it('placing after an undo discards the redo stack', () => {
    const session = new Session({ seed: 5 })
    play(session, 3)
    session.undo()
    expect(session.canRedo).toBe(true)
    session.hardDrop()
    expect(session.canRedo).toBe(false)
  })

  it('undo mid-piece (piece moved, not placed) returns to before the last placement', () => {
    const session = new Session({ seed: 5 })
    const start = session.state
    session.hardDrop()
    session.moveX(1)
    session.undo()
    expect(session.state).toBe(start)
  })

  it('undo out of game over resumes play', () => {
    const session = new Session({ seed: 1 })
    session.apply({ ...session.state, board: boardFromRows(Array(20).fill('#########.')) })
    // stack I pieces into the spawn area until the game ends
    for (let i = 0; i < 40 && !session.state.over; i++) session.hardDrop()
    expect(session.state.over).toBeTruthy()
    session.undo()
    expect(session.state.over).toBe(false)
    expect(moveX(session.state, -1)).not.toBe(session.state)
  })
})
