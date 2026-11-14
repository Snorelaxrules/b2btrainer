/**
 * Spin detection, back-to-back, combo and attack. Pure functions over plain data,
 * shared by the game, the spin finder, the lookahead search and the coach.
 * All numbers come from src/config/scoring.ts.
 */
import { ATTACK, SCORING, type ScoringConfig, type SpinRule } from '../config/scoring'
import { type ActivePiece, type Board, HEIGHT, type Piece, WIDTH, clearLines, fits, occupied, placeOnBoard } from './game'
import type { PieceType } from './pieces'

export type SpinKind = 'none' | 'mini' | 'full'

/** B2B / combo counters carried between placements. */
export interface Counters {
  /** -1 = no streak; 0 = one difficult clear (no bonus yet); n ≥ 1 is shown as "B2B ×n" */
  readonly b2b: number
  /** -1 = no combo; 0 = first clear of a chain; n ≥ 1 is shown as "n combo" */
  readonly combo: number
}

export const NO_COUNTERS: Counters = { b2b: -1, combo: -1 }

export type B2BChange =
  /** no line cleared: B2B untouched */
  | 'unchanged'
  /** first difficult clear: a streak begins */
  | 'started'
  /** difficult clear on an existing streak */
  | 'kept'
  /** non-difficult clear ended a streak */
  | 'broken'
  /** non-difficult clear with no streak to lose */
  | 'none'

export interface ClearResult {
  readonly lines: number
  readonly spin: SpinKind
  readonly allClear: boolean
  /** quad+ or any spin that cleared lines */
  readonly difficult: boolean
  readonly before: Counters
  readonly after: Counters
  readonly b2bChange: B2BChange
  /** lines sent, rounded per config, including surge */
  readonly attack: number
  /** surge lines released by this clear (included in attack) */
  readonly surge: number
  /** e.g. "TSD", "Quad", "S-Spin Mini Double", "Single" */
  readonly label: string
}

// --- spin detection -------------------------------------------------------------

/** T corners in box coordinates [dx, dy-down], and which two each rotation faces. */
const T_CORNERS: [number, number][] = [
  [0, 0], // top-left
  [2, 0], // top-right
  [2, 2], // bottom-right
  [0, 2], // bottom-left
]
const T_FRONT: Record<number, [number, number]> = { 0: [0, 1], 1: [1, 2], 2: [2, 3], 3: [3, 0] }

function immobile(board: Board, p: Piece): boolean {
  return (
    !fits(board, { ...p, x: p.x - 1 }) && !fits(board, { ...p, x: p.x + 1 }) && !fits(board, { ...p, y: p.y + 1 })
  )
}

/**
 * Why a spin counts: 'corner' = a T passing the 3-corner rule (a real T-spin or
 * T-spin mini); 'immobile' = any piece (T included) that only counts because it
 * can't move after rotating (All-Mini+ / all-spin). Call only for actual spins.
 */
export function spinBasis(board: Board, p: Piece): 'corner' | 'immobile' {
  if (p.type !== 'T') return 'immobile'
  let n = 0
  for (const [dx, dy] of T_CORNERS) if (occupied(board, p.x + dx, p.y - dy)) n++
  return n >= 3 ? 'corner' : 'immobile'
}

/**
 * Spin kind for `p` locking on `board` (the board before the piece is placed).
 * Requires that the last action was a rotation (p.rotated).
 */
export function detectSpin(board: Board, p: ActivePiece, rule: SpinRule, cfg: ScoringConfig = SCORING): SpinKind {
  if (!p.rotated) return 'none'
  if (p.type === 'T') {
    const filled = T_CORNERS.map(([dx, dy]) => occupied(board, p.x + dx, p.y - dy))
    const count = filled.filter(Boolean).length
    if (count >= 3) {
      const [a, b] = T_FRONT[p.rot]
      if (filled[a] && filled[b]) return 'full'
      // TST / fin kick: the 5th test of a 90° rotation. (A 180's 5th test is a plain sideways nudge.)
      if (cfg.fifthKickUpgrades && p.kick === 4 && !p.flip) return 'full'
      return 'mini'
    }
    if (rule === 'allmini+' && immobile(board, p)) return 'mini'
    return 'none'
  }
  if (rule === 'tspin') return 'none'
  if (p.type === 'O' && !cfg.oSpins) return 'none'
  if (!immobile(board, p)) return 'none'
  return rule === 'allspin' ? 'full' : 'mini'
}

// --- attack -----------------------------------------------------------------------

const LINE_NAMES = ['', 'Single', 'Double', 'Triple', 'Quad']
const T_SHORT: Record<string, string> = {
  'full,0': 'T-Spin',
  'full,1': 'TSS',
  'full,2': 'TSD',
  'full,3': 'TST',
  'mini,0': 'T-Spin Mini',
  'mini,1': 'TSMS',
  'mini,2': 'TSMD',
  'mini,3': 'TSMT',
}

export function clearLabel(type: PieceType, spin: SpinKind, lines: number): string {
  if (spin === 'none') return LINE_NAMES[lines] ?? `${lines} lines`
  if (type === 'T') return T_SHORT[`${spin},${lines}`] ?? `T-Spin ${LINE_NAMES[lines]}`
  const name = `${type}-Spin${spin === 'mini' ? ' Mini' : ''}`
  return lines ? `${name} ${LINE_NAMES[lines]}` : name
}

function chainingBonus(b2b: number, cfg: ScoringConfig) {
  let bonus = 0
  for (const [min, v] of cfg.b2bChaining) if (b2b >= min) bonus = v
  return bonus
}

/** Surge stored at a displayed B2B count (0 below the threshold). */
export function surgeFor(b2b: number, cfg: ScoringConfig = SCORING): number {
  if (cfg.b2bMode !== 'charging' || b2b < cfg.surgeStart) return 0
  return cfg.surgeBase + (b2b - cfg.surgeStart)
}

/** Split a surge into its released segments (first ones carry the remainder). */
export function surgeSegments(total: number, cfg: ScoringConfig = SCORING): number[] {
  const n = cfg.surgeSegments
  const base = Math.floor(total / n)
  const rem = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0)).filter((v) => v > 0)
}

/** Score a lock. `lines` and `allClear` describe the clear; `spin` comes from detectSpin. */
export function scoreClear(
  type: PieceType,
  spin: SpinKind,
  lines: number,
  allClear: boolean,
  before: Counters,
  cfg: ScoringConfig = SCORING,
): ClearResult {
  const label = clearLabel(type, spin, lines)
  if (lines === 0) {
    return {
      lines,
      spin,
      allClear: false,
      difficult: false,
      before,
      after: { b2b: before.b2b, combo: -1 },
      b2bChange: 'unchanged',
      attack: 0,
      surge: 0,
      label,
    }
  }
  const difficult = lines >= 4 || spin !== 'none'
  const combo = before.combo + 1
  const table = spin === 'full' ? ATTACK.full : spin === 'mini' ? ATTACK.mini : ATTACK.normal
  let attack: number = table[Math.min(lines, table.length - 1)]

  let b2b: number
  let b2bChange: B2BChange
  let surge = 0
  if (difficult) {
    b2b = before.b2b + 1
    if (before.b2b >= 0) {
      attack += cfg.b2bMode === 'charging' ? cfg.b2bBonus : chainingBonus(b2b, cfg)
      b2bChange = 'kept'
    } else {
      b2bChange = 'started'
    }
  } else if (allClear) {
    // an All Clear never breaks B2B
    b2b = before.b2b
    b2bChange = before.b2b >= 0 ? 'kept' : 'none'
  } else {
    b2b = -1
    b2bChange = before.b2b >= 0 ? 'broken' : 'none'
    surge = surgeFor(before.b2b, cfg)
  }

  if (combo > 0) attack *= 1 + cfg.comboBonus * combo
  if (combo >= 2 && attack === 0) attack = Math.log1p(cfg.comboMinifierLog * combo)
  if (allClear) {
    attack += cfg.allClearAttack
    b2b = Math.max(b2b, 0) + cfg.allClearB2B
    if (b2bChange === 'none') b2bChange = 'started'
  }
  attack = Math.floor(attack + 1e-9) + surge

  return {
    lines,
    spin,
    allClear,
    difficult,
    before,
    after: { b2b, combo },
    b2bChange,
    attack,
    surge,
    label: allClear ? `${label} + All Clear` : label,
  }
}

// --- lock resolution ------------------------------------------------------------------

export interface LockOutcome {
  /** board after placing and clearing */
  readonly board: Board
  readonly result: ClearResult
}

function boardEmpty(board: Board) {
  for (let i = 0; i < WIDTH * HEIGHT; i++) if (board[i]) return false
  return true
}

/** Place, clear and score a piece: the one lock path used everywhere. */
export function resolveLock(
  board: Board,
  p: ActivePiece,
  before: Counters,
  rule: SpinRule,
  cfg: ScoringConfig = SCORING,
): LockOutcome {
  const spin = detectSpin(board, p, rule, cfg)
  const next = placeOnBoard(board, p)
  const lines = clearLines(next)
  const allClear = lines > 0 && boardEmpty(next)
  return { board: next, result: scoreClear(p.type, spin, lines, allClear, before, cfg) }
}
