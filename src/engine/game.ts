/**
 * Core game logic as pure functions over an immutable GameState.
 * No DOM, no React. Every action returns a new state (or the same object when
 * nothing changed), so any state can be kept as an exact undo snapshot.
 *
 * Coordinates: x is the column (0 = left); y is the row counted from the BOTTOM
 * (0 = floor). A piece's (x, y) is the top-left cell of its bounding box.
 *
 * The board is a Uint8Array that is never mutated after it is created: a lock
 * copies it. Treat `state.board` as read-only.
 */
import { DEFAULT_RULES, type Rules } from '../config/rules'
import { BOX_SIZE, PIECES, type PieceType, type Rotation, SHAPES, kickTests } from './pieces'
import { type BagState, drawPiece, newBag } from './rng'
import { type ClearResult, type Counters, NO_COUNTERS, resolveLock } from './scoring'

export const WIDTH = 10
export const VISIBLE = 20
/** total rows including the hidden buffer above the visible field */
export const HEIGHT = 40
/** box top row on spawn: pieces appear in rows 21–22 (1-indexed), just above the field, like TETR.IO */
export const SPAWN_Y = 21
/** queue entries kept ready (previews + lookahead headroom) */
const QUEUE_KEEP = 7

export type Board = Uint8Array
export type Cell = [number, number]

export interface Piece {
  readonly type: PieceType
  readonly rot: Rotation
  readonly x: number
  readonly y: number
}

export interface ActivePiece extends Piece {
  /** the last action that changed the piece was a rotation (spin detection needs this) */
  readonly rotated: boolean
  /** index of the kick test used by that rotation (0 = no kick), -1 if none */
  readonly kick: number
  /** that rotation was a 180 (its kick table is different: see detectSpin) */
  readonly flip?: boolean
}

/** Lock-delay bookkeeping for the current piece (gravity 'normal' only). */
export interface LockState {
  readonly timer: number
  readonly resets: number
  readonly lowest: number
  /** touched down since the last new low */
  readonly touched: boolean
  readonly gravityAcc: number
}

export interface Stats {
  /** pieces placed */
  readonly pieces: number
  readonly lines: number
  readonly holds: number
  readonly attack: number
  /** longest displayed B2B reached */
  readonly maxB2B: number
  /** count per clear label for spins, quads and all clears ("TSD", "Quad", "S-Spin Mini", …) */
  readonly clears: Readonly<Record<string, number>>
  readonly surgeSent: number
}

/** What a lock did. */
export interface Placement {
  readonly piece: ActivePiece
  readonly lines: number
  readonly result: ClearResult
  /** pieces placed when this happened (1-based) */
  readonly n: number
}

/** how many recent clears/spins the state keeps for the HUD */
const RECENT_KEEP = 12

export type GameOver = false | 'blockout' | 'lockout'

export interface GameState {
  readonly rules: Rules
  readonly seed: number
  readonly board: Board
  readonly active: ActivePiece | null
  readonly hold: PieceType | null
  readonly holdUsed: boolean
  readonly queue: readonly PieceType[]
  readonly bag: BagState
  readonly over: GameOver
  readonly lock: LockState
  /** increments on every spawn (including hold swaps); input uses it to notice new pieces */
  readonly pieceId: number
  /** game time in ms, only advanced by tick() */
  readonly time: number
  readonly stats: Stats
  readonly counters: Counters
  readonly last: Placement | null
  /** recent placements that cleared lines or spun, newest first */
  readonly recent: readonly Placement[]
}

export interface NewGameOptions {
  seed: number
  rules?: Partial<Rules>
  /** forced first pieces (e.g. "TILJSZO"); the seeded bag continues after them */
  customQueue?: readonly PieceType[]
}

const PIECE_CODE: Record<PieceType, number> = Object.fromEntries(PIECES.map((t, i) => [t, i + 1])) as Record<
  PieceType,
  number
>
/** board value → piece type (1-based, 0 = empty, 8 = garbage) */
export const CODE_PIECE: readonly (PieceType | null)[] = [null, ...PIECES, null]
export const GARBAGE = 8

// --- board helpers ------------------------------------------------------------

export function emptyBoard(): Board {
  return new Uint8Array(WIDTH * HEIGHT)
}

export function cellAt(board: Board, x: number, y: number): number {
  return board[y * WIDTH + x]
}

/** out of bounds counts as filled (walls and floor) */
export function occupied(board: Board, x: number, y: number): boolean {
  if (x < 0 || x >= WIDTH || y < 0) return true
  if (y >= HEIGHT) return false
  return board[y * WIDTH + x] !== 0
}

export function pieceCells(p: Piece): Cell[] {
  return SHAPES[p.type][p.rot].map(([cx, cy]): Cell => [p.x + cx, p.y - cy])
}

export function fits(board: Board, p: Piece): boolean {
  for (const [cx, cy] of SHAPES[p.type][p.rot]) {
    const x = p.x + cx
    const y = p.y - cy
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return false
    if (board[y * WIDTH + x]) return false
  }
  return true
}

export function dropPosition<P extends Piece>(board: Board, p: P): P {
  let y = p.y
  while (fits(board, { ...p, y: y - 1 })) y--
  return y === p.y ? p : { ...p, y }
}

export function isGrounded(board: Board, p: Piece): boolean {
  return !fits(board, { ...p, y: p.y - 1 })
}

export function spawnPiece(type: PieceType): ActivePiece {
  return { type, rot: 0, x: BOX_SIZE[type] === 2 ? 4 : 3, y: SPAWN_Y, rotated: false, kick: -1 }
}

/** Write a piece into a copy of the board. */
export function placeOnBoard(board: Board, p: Piece): Board {
  const out = board.slice()
  for (const [x, y] of pieceCells(p)) out[y * WIDTH + x] = PIECE_CODE[p.type]
  return out
}

/** Remove full rows (in place on a fresh board). Returns the number cleared. */
export function clearLines(board: Board): number {
  let cleared = 0
  for (let y = 0; y < HEIGHT; ) {
    let full = true
    for (let x = 0; x < WIDTH; x++) {
      if (!board[y * WIDTH + x]) {
        full = false
        break
      }
    }
    if (full) {
      board.copyWithin(y * WIDTH, (y + 1) * WIDTH)
      board.fill(0, (HEIGHT - 1) * WIDTH)
      cleared++
    } else {
      y++
    }
  }
  return cleared
}

/** Board from rows written top-down ('#' or a piece letter = filled, anything else empty); the last string is row 0. */
export function boardFromRows(rows: readonly string[]): Board {
  const b = emptyBoard()
  rows.forEach((row, i) => {
    const y = rows.length - 1 - i
    for (let x = 0; x < WIDTH; x++) {
      const ch = row[x]
      if (!ch || ch === '.' || ch === ' ' || ch === '_') continue
      const t = PIECES.indexOf(ch as PieceType)
      b[y * WIDTH + x] = t >= 0 ? t + 1 : GARBAGE
    }
  })
  return b
}

// --- queue --------------------------------------------------------------------

export function parseQueue(text: string): PieceType[] {
  return [...text.toUpperCase()].filter((c): c is PieceType => (PIECES as readonly string[]).includes(c))
}

function fillQueue(queue: readonly PieceType[], bag: BagState) {
  const q = [...queue]
  let b = bag
  while (q.length < QUEUE_KEEP) {
    const d = drawPiece(b)
    q.push(d.piece)
    b = d.bag
  }
  return { queue: q, bag: b }
}

// --- lifecycle ------------------------------------------------------------------

const FRESH_LOCK: LockState = { timer: 0, resets: 0, lowest: Infinity, touched: false, gravityAcc: 0 }

function bottomRow(p: Piece) {
  let m = Infinity
  for (const [, y] of pieceCells(p)) if (y < m) m = y
  return m
}

export function newGame(opts: NewGameOptions): GameState {
  const rules = { ...DEFAULT_RULES, ...opts.rules }
  const { queue, bag } = fillQueue(opts.customQueue ?? [], newBag(opts.seed))
  const base: GameState = {
    rules,
    seed: opts.seed,
    board: emptyBoard(),
    active: null,
    hold: null,
    holdUsed: false,
    queue,
    bag,
    over: false,
    lock: FRESH_LOCK,
    pieceId: 0,
    time: 0,
    stats: { pieces: 0, lines: 0, holds: 0, attack: 0, maxB2B: 0, clears: {}, surgeSent: 0 },
    counters: NO_COUNTERS,
    last: null,
    recent: [],
  }
  return spawnNext(base)
}

/** Take the next queue piece and spawn it. */
function spawnNext(s: GameState): GameState {
  const [next, ...rest] = s.queue
  const { queue, bag } = fillQueue(rest, s.bag)
  return spawn({ ...s, queue, bag }, next)
}

function spawn(s: GameState, type: PieceType): GameState {
  const p = spawnPiece(type)
  const pieceId = s.pieceId + 1
  // block out: no room at the spawn point
  if (!fits(s.board, p)) return { ...s, active: null, over: 'blockout', pieceId, lock: FRESH_LOCK }
  return { ...s, active: p, pieceId, lock: { ...FRESH_LOCK, lowest: bottomRow(p) } }
}

// --- lock delay helpers ---------------------------------------------------------------

/** New lowest row: fresh lock timer. */
function refreshLowest(lock: LockState, p: Piece): LockState | null {
  const b = bottomRow(p)
  if (b >= lock.lowest) return null
  return { ...lock, lowest: b, timer: 0, touched: false }
}

/** After a successful move/rotation: reset the lock timer while resets remain. */
function afterMove(s: GameState, p: ActivePiece): GameState {
  if (s.rules.gravity === 'none') return { ...s, active: p }
  const low = refreshLowest(s.lock, p)
  if (low) return { ...s, active: p, lock: low }
  const { lock } = s
  if (!lock.touched && !isGrounded(s.board, p)) return { ...s, active: p }
  if (lock.resets < s.rules.maxLockResets) return { ...s, active: p, lock: { ...lock, resets: lock.resets + 1, timer: 0 } }
  return { ...s, active: p }
}

// --- actions ------------------------------------------------------------------

function playable(s: GameState): s is GameState & { active: ActivePiece } {
  return !s.over && s.active !== null
}

export function moveX(s: GameState, dir: -1 | 1): GameState {
  if (!playable(s)) return s
  const p = s.active
  const c = { ...p, x: p.x + dir }
  if (!fits(s.board, c)) return s
  return afterMove(s, { ...c, rotated: false, kick: -1 })
}

/** Shift to the wall (ARR 0). Counts as one move for lock resets. */
export function slide(s: GameState, dir: -1 | 1): GameState {
  if (!playable(s)) return s
  let p = s.active
  while (fits(s.board, { ...p, x: p.x + dir })) p = { ...p, x: p.x + dir }
  if (p === s.active) return s
  return afterMove(s, { ...p, rotated: false, kick: -1 })
}

/**
 * Slide while soft dropping (ARR 0 + infinite SDF held together): one cell at a
 * time, dropping after each, so the piece falls into the first gap it passes.
 */
export function slideDown(s: GameState, dir: -1 | 1): GameState {
  if (!playable(s)) return s
  let p: Piece = dropPosition(s.board, s.active)
  while (fits(s.board, { ...p, x: p.x + dir })) p = dropPosition(s.board, { ...p, x: p.x + dir })
  if (p.x === s.active.x && p.y === s.active.y) return s
  return afterMove(s, { ...p, rotated: false, kick: -1 })
}

/** Infinite soft drop: straight to the floor without locking. */
export function softDrop(s: GameState): GameState {
  if (!playable(s)) return s
  const g = dropPosition(s.board, s.active)
  if (g === s.active) return s
  const lock = refreshLowest(s.lock, g) ?? s.lock
  return { ...s, active: { ...g, rotated: false, kick: -1 }, lock: { ...lock, gravityAcc: 0 } }
}

/** turn: 1 = clockwise, -1 = counterclockwise, 2 = 180. */
export function rotate(s: GameState, turn: 1 | -1 | 2): GameState {
  if (!playable(s)) return s
  const r = rotatePiece(s.board, s.active, turn)
  return r ? afterMove(s, r) : s
}

/** Rotation with SRS+ kicks on any board; null if every test fails. */
export function rotatePiece(board: Board, p: Piece, turn: 1 | -1 | 2): ActivePiece | null {
  const to = ((p.rot + turn + 4) % 4) as Rotation
  const tests = kickTests(p.type, p.rot, to)
  for (let i = 0; i < tests.length; i++) {
    const [dx, dy] = tests[i]
    const c = { type: p.type, rot: to, x: p.x + dx, y: p.y + dy }
    if (fits(board, c)) return { ...c, rotated: true, kick: i, flip: turn === 2 }
  }
  return null
}

export function hold(s: GameState): GameState {
  if (!playable(s) || s.holdUsed) return s
  const stats = { ...s.stats, holds: s.stats.holds + 1 }
  const held = s.active.type
  const base = { ...s, hold: held, holdUsed: true, stats }
  return s.hold ? spawn(base, s.hold) : spawnNext(base)
}

export function hardDrop(s: GameState): GameState {
  if (!playable(s)) return s
  const g = dropPosition(s.board, s.active)
  // a drop that moves the piece ends any rotation-based spin
  const p: ActivePiece = g === s.active ? g : { ...g, rotated: false, kick: -1 }
  return lockPiece(s, p)
}

/** Lock `p` where it is: write it, clear lines, spawn the next piece. */
export function lockPiece(s: GameState, p: ActivePiece): GameState {
  const cells = pieceCells(p)
  const { board, result } = resolveLock(s.board, p, s.counters, s.rules.spinRule)
  const lines = result.lines
  const notable = result.spin !== 'none' || result.lines >= 4 || result.allClear
  const st = s.stats
  const stats: Stats = {
    ...st,
    pieces: st.pieces + 1,
    lines: st.lines + lines,
    attack: st.attack + result.attack,
    maxB2B: Math.max(st.maxB2B, result.after.b2b),
    clears: notable ? { ...st.clears, [result.label]: (st.clears[result.label] ?? 0) + 1 } : st.clears,
    surgeSent: st.surgeSent + result.surge,
  }
  const last: Placement = { piece: p, lines, result, n: stats.pieces }
  const recent = lines > 0 || result.spin !== 'none' ? [last, ...s.recent].slice(0, RECENT_KEEP) : s.recent
  const next: GameState = {
    ...s,
    board,
    active: null,
    holdUsed: false,
    stats,
    counters: result.after,
    last,
    recent,
  }
  // lock out: the whole piece came to rest above the visible field
  if (cells.every(([, y]) => y >= VISIBLE)) return { ...next, over: 'lockout' }
  return spawnNext(next)
}

/**
 * Advance game time: gravity and lock delay. Does nothing with gravity 'none'.
 * `softFactor` multiplies gravity for finite soft drop factors.
 */
export function tick(s: GameState, dt: number, softFactor = 1): GameState {
  if (!playable(s) || s.rules.gravity === 'none') return s
  const time = s.time + dt
  const p = s.active
  if (isGrounded(s.board, p)) {
    const lock = { ...s.lock, gravityAcc: 0, touched: true }
    if (lock.resets >= s.rules.maxLockResets) return lockPiece({ ...s, time, lock }, p)
    const timer = lock.timer + dt
    if (timer >= s.rules.lockDelay) return lockPiece({ ...s, time, lock }, p)
    return { ...s, time, lock: { ...lock, timer } }
  }
  let acc = s.lock.gravityAcc + (dt / 1000) * s.rules.gravitySpeed * softFactor
  let cur: ActivePiece = p
  let lock = s.lock
  while (acc >= 1) {
    if (!fits(s.board, { ...cur, y: cur.y - 1 })) {
      acc = 0
      break
    }
    cur = { ...cur, y: cur.y - 1, rotated: false, kick: -1 }
    acc -= 1
    lock = refreshLowest(lock, cur) ?? lock
  }
  return { ...s, time, active: cur, lock: { ...lock, gravityAcc: acc } }
}

export function ghost(s: GameState): Piece | null {
  return s.active ? dropPosition(s.board, s.active) : null
}
