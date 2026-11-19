/**
 * Position / fixture files: a board, the known pieces and the rules, as JSON.
 * Shared by the headless harness (npm run plan) and the fixture runner.
 *
 * {
 *   "name": "TSD on a staircase",
 *   "ruleset": "allmini+",                // "tspin" | "allmini+" | "allspin"
 *   "board": ["##........", "###.....##"], // rows top-down; '.' empty, anything else filled
 *   "queue": "TZJZSL",                    // FIRST piece is the one in hand (string or array)
 *   "hold": "O",                          // or null / omitted
 *   "b2b": 40,                            // optional: B2B shown in game (×n); -1 or omitted = no streak
 *   "combo": -1,                          // optional
 *   "expected": { "minChainLength": 2, "expectedClears": ["S-Spin Mini Single", "TSD"] }
 * }
 */
import type { SpinRule } from '../config/scoring'
import { type Board, WIDTH, boardFromRows, parseQueue } from '../engine/game'
import { PIECES, type PieceType } from '../engine/pieces'
import type { Counters } from '../engine/scoring'

export interface Expected {
  /** the best plan must contain at least this many spin clears */
  minChainLength?: number
  /** clear labels that must appear, in order, in the best plan (e.g. "TSD", "S-Spin Mini Single") */
  expectedClears?: string[]
}

export interface Position {
  name: string
  ruleset: SpinRule
  board: Board
  rows: string[]
  current: PieceType
  queue: PieceType[]
  hold: PieceType | null
  holdUsed: boolean
  counters: Counters
  expected?: Expected
  notes?: string
}

const RULES: readonly SpinRule[] = ['tspin', 'allmini+', 'allspin']

export function parsePosition(raw: unknown, source = 'position'): Position {
  const fail = (msg: string): never => {
    throw new Error(`${source}: ${msg}`)
  }
  if (!raw || typeof raw !== 'object') fail('expected a JSON object')
  const o = raw as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name : source
  const ruleset = (o.ruleset ?? 'allmini+') as SpinRule
  if (!RULES.includes(ruleset)) fail(`ruleset must be one of ${RULES.join(', ')}`)
  if (!Array.isArray(o.board) || !o.board.every((r) => typeof r === 'string')) fail('board must be an array of row strings')
  const rows = o.board as string[]
  rows.forEach((r, i) => {
    if (r.length !== WIDTH) fail(`board row ${i + 1} is ${r.length} wide, expected ${WIDTH}`)
  })
  const qText = Array.isArray(o.queue) ? o.queue.join('') : typeof o.queue === 'string' ? o.queue : fail('queue is required')
  const pieces = parseQueue(qText as string)
  if (pieces.length !== (qText as string).replace(/[\s,]/g, '').length) fail(`queue has unknown pieces: "${qText}"`)
  if (!pieces.length) fail('queue needs at least the piece in hand')
  let hold: PieceType | null = null
  if (o.hold != null && o.hold !== '') {
    const h = String(o.hold).toUpperCase()
    if (!(PIECES as readonly string[]).includes(h)) fail(`hold "${o.hold}" is not a piece`)
    hold = h as PieceType
  }
  const b2b = o.b2b == null ? -1 : Number(o.b2b)
  const combo = o.combo == null ? -1 : Number(o.combo)
  if (!Number.isInteger(b2b) || b2b < -1) fail('b2b must be an integer ≥ -1')
  if (!Number.isInteger(combo) || combo < -1) fail('combo must be an integer ≥ -1')
  let expected: Expected | undefined
  if (o.expected != null) {
    const e = o.expected as Record<string, unknown>
    expected = {}
    if (e.minChainLength != null) expected.minChainLength = Number(e.minChainLength)
    if (e.expectedClears != null) {
      if (!Array.isArray(e.expectedClears)) fail('expected.expectedClears must be an array of labels')
      expected.expectedClears = (e.expectedClears as unknown[]).map(String)
    }
  }
  return {
    name,
    ruleset,
    board: boardFromRows(rows),
    rows,
    current: pieces[0],
    queue: pieces.slice(1),
    hold,
    holdUsed: o.holdUsed === true,
    counters: { b2b, combo },
    expected,
    notes: typeof o.notes === 'string' ? o.notes : undefined,
  }
}
