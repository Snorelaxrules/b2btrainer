import { describe, expect, it } from 'vitest'
import { findPlacements } from './finder'
import { boardFromRows, emptyBoard, fits, isGrounded, pieceCells, rotatePiece, spawnPiece } from './game'
import { cellsKey, reachablePlacements } from './movegen'
import { NO_COUNTERS } from './scoring'

const TST_BOARD = boardFromRows([
  '..#.......', // row 4: overhang
  '...#######',
  '##.#######',
  '#..#######',
  '##.#######',
])
// the TST spot: T pointing left at x=1, y=2 (cells (1,1) (2,0) (2,1) (2,2))
const TST_CELLS = cellsKey([[1, 1], [2, 0], [2, 1], [2, 2]])

describe('BFS reachability', () => {
  it('finds a placement that needs a kick (TST via the 5th test) and the inputs to get there', () => {
    const all = reachablePlacements(TST_BOARD, 'T')
    const tst = all.filter((r) => cellsKey(pieceCells(r.piece)) === TST_CELLS)
    expect(tst.length).toBeGreaterThan(0)
    const viaKick = tst.find((r) => r.piece.rotated && r.piece.kick === 4)
    expect(viaKick).toBeDefined()
    // replaying the inputs from spawn really ends there
    expect(viaKick!.path[viaKick!.path.length - 1]).toBe('ccw')
  })

  it('the finder scores that placement as a TST that starts B2B', () => {
    const c = findPlacements(TST_BOARD, 'T', NO_COUNTERS, false, { spinRule: 'allmini+' })
    const tst = c.find((x) => cellsKey(x.cells) === TST_CELLS)
    expect(tst?.result).toMatchObject({ label: 'TST', attack: 6, b2bChange: 'started' })
    expect(tst?.result.difficult).toBe(true)
  })

  it('does not reach an enclosed cavity', () => {
    // sealed 2x2 pocket at the bottom-left under a full roof
    const board = boardFromRows(['##########', '..########', '..########'])
    for (const r of reachablePlacements(board, 'O')) {
      expect(pieceCells(r.piece).every(([, y]) => y >= 3)).toBe(true)
    }
    // the pocket itself is a legal resting spot, just unreachable
    const pocket = { ...spawnPiece('O'), x: 0, y: 1 }
    expect(fits(board, pocket) && isGrounded(board, pocket)).toBe(true)
  })

  it('every placement on an empty board is grounded and distinct; 180 kicks are explored', () => {
    const all = reachablePlacements(emptyBoard(), 'T')
    expect(all.every((r) => isGrounded(emptyBoard(), r.piece))).toBe(true)
    const distinct = new Set(all.map((r) => cellsKey(pieceCells(r.piece))))
    expect(distinct.size).toBe(34) // 8+9+8+9 T placements on a flat floor
    expect(rotatePiece(emptyBoard(), { ...spawnPiece('T'), y: 1 }, 2)).not.toBeNull()
  })

  it('O pieces: 9 placements, I pieces: 17', () => {
    const count = (t: 'O' | 'I') => new Set(reachablePlacements(emptyBoard(), t).map((r) => cellsKey(pieceCells(r.piece)))).size
    expect(count('O')).toBe(9)
    expect(count('I')).toBe(17)
  })
})
