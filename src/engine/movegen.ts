/**
 * Move generation: every final placement reachable from spawn with the real
 * move set, plus the shortest key sequence to get there.
 *
 * Search space: (x, y, rotation, how the piece got there). The last part is
 * -1 for a shift/drop, or the kick index of the rotation that produced the
 * state, because spin detection depends on it. BFS gives each such state its
 * fewest-inputs path.
 *
 * Moves (one input each): tap ←/→, DAS ←/→ (slide to the wall), soft drop
 * (infinite SDF: to the floor), rotate CW / CCW / 180 with SRS+ kicks.
 * Assumes unlimited time: no gravity, no lock delay, no move-reset limit.
 * Not modelled: soft drop held *while* DAS slides (falling into the first gap).
 */
import { type ActivePiece, type Board, type Piece, fits, isGrounded, rotatePiece, spawnPiece } from './game'
import type { PieceType } from './pieces'

export type Move = 'left' | 'right' | 'dasLeft' | 'dasRight' | 'softDrop' | 'cw' | 'ccw' | 'flip'

export const MOVE_LABEL: Record<Move | 'hold' | 'hardDrop', string> = {
  left: '←',
  right: '→',
  dasLeft: '⇤ DAS',
  dasRight: 'DAS ⇥',
  softDrop: '↓',
  cw: '↻ CW',
  ccw: '↺ CCW',
  flip: '180',
  hold: 'Hold',
  hardDrop: 'Drop',
}

export interface Reachable {
  /** the piece at rest, with rotated/kick describing its last move */
  piece: ActivePiece
  /** inputs from spawn, excluding the final hard drop (a trailing soft drop is dropped: hard drop covers it) */
  path: Move[]
}

const X_OFF = 4
function key(x: number, y: number, rot: number, rk: number) {
  return (((rot * 32 + (x + X_OFF)) * 64 + y) * 8) + (rk + 1)
}

interface Node {
  p: ActivePiece
  prev: number
  move: Move | null
}

/** All grounded states reachable from `start` (default: the spawn position). */
export function reachablePlacements(board: Board, type: PieceType, start?: ActivePiece): Reachable[] {
  const s0 = start ?? spawnPiece(type)
  if (!fits(board, s0)) return []
  const nodes = new Map<number, Node>()
  const k0 = key(s0.x, s0.y, s0.rot, s0.rotated ? s0.kick : -1)
  nodes.set(k0, { p: s0, prev: -1, move: null })
  const queue: number[] = [k0]

  const visit = (from: number, p: ActivePiece, move: Move) => {
    const k = key(p.x, p.y, p.rot, p.rotated ? p.kick : -1)
    if (nodes.has(k)) return
    nodes.set(k, { p, prev: from, move })
    queue.push(k)
  }
  const shifted = (p: Piece, x: number, y: number): ActivePiece => ({ type: p.type, rot: p.rot, x, y, rotated: false, kick: -1 })

  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi]
    const { p } = nodes.get(k) as Node
    // taps
    if (fits(board, { ...p, x: p.x - 1 })) visit(k, shifted(p, p.x - 1, p.y), 'left')
    if (fits(board, { ...p, x: p.x + 1 })) visit(k, shifted(p, p.x + 1, p.y), 'right')
    // DAS to the wall (only distinct from a tap if it travels 2+)
    let lx = p.x
    while (fits(board, { ...p, x: lx - 1 })) lx--
    if (lx < p.x - 1) visit(k, shifted(p, lx, p.y), 'dasLeft')
    let rx = p.x
    while (fits(board, { ...p, x: rx + 1 })) rx++
    if (rx > p.x + 1) visit(k, shifted(p, rx, p.y), 'dasRight')
    // soft drop to the floor
    let y = p.y
    while (fits(board, { ...p, y: y - 1 })) y--
    if (y < p.y) visit(k, shifted(p, p.x, y), 'softDrop')
    // rotations
    if (p.type !== 'O') {
      for (const [turn, move] of [
        [1, 'cw'],
        [-1, 'ccw'],
        [2, 'flip'],
      ] as const) {
        const r = rotatePiece(board, p, turn)
        if (r) visit(k, r, move)
      }
    }
  }

  const out: Reachable[] = []
  for (const [k, node] of nodes) {
    if (!isGrounded(board, node.p)) continue
    const path: Move[] = []
    for (let c: number = k; ; ) {
      const n = nodes.get(c) as Node
      if (n.move === null) break
      path.push(n.move)
      c = n.prev
    }
    path.reverse()
    if (path[path.length - 1] === 'softDrop') path.pop()
    out.push({ piece: node.p, path })
  }
  return out
}

/** Canonical key of the cells a piece covers (S/Z/I rotations that cover the same cells match). */
export function cellsKey(cells: readonly (readonly [number, number])[]): string {
  return cells
    .map(([x, y]) => y * 16 + x)
    .sort((a, b) => a - b)
    .join(',')
}
