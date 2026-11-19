/**
 * Plan scoring: features of a plan's END stack plus its totals, each turned into
 * a named term so every score can be explained (UI table, headless harness).
 * Weights live in src/config/planScore.ts.
 */
import { PLAN_SCORE, type PlanScoreConfig } from '../config/planScore'
import type { SpinRule } from '../config/scoring'
import { classifyPockets, heights } from './features'
import { type Board, HEIGHT, WIDTH, clearLines, placeOnBoard } from './game'
import { cellsInto, forEachResting } from './movegen'
import { PIECES, type PieceType, type Rotation } from './pieces'
import type { ClearResult } from './scoring'
import { type Slot, allSlots } from './slots'

// --- stack features -------------------------------------------------------------------

export interface StackFeatures {
  heights: number[]
  maxHeight: number
  /** empty cells under a block in their column */
  covered: number
  /** covered cells no piece can ever reach (sealed off, or open but unreachable) */
  sealed: number
  /** rows that hold such a cell: each must be dug out later, usually by a non-spin clear */
  unsafeDigRows: number
  /** covered, reachable cells that are not part of any spin slot */
  overhangs: number
  /** covered cells that ARE part of a spin slot (not penalised) */
  slotCovered: number
  bumpiness: number
  bumpSquared: number
  /** summed depth beyond the threshold of 1-wide wells */
  iWellExcess: number
  /** rows whose only gap is one uncovered cell no spin slot uses (cleared only by a vertical fill) */
  iRows: number
  /** piece types with at least one clean placement */
  clean: PieceType[]
  /** only the I has a clean placement */
  iOnly: boolean
  /** spin-clear slots per piece type under the rule */
  slots: Record<PieceType, Slot[]>
}

/** Number of covered empty cells (empty, with a block somewhere above in the column). */
function coveredCount(board: Board, h: readonly number[]): number {
  let n = 0
  for (let x = 0; x < WIDTH; x++) for (let y = 0; y < h[x]; y++) if (!board[y * WIDTH + x]) n++
  return n
}

/**
 * Piece types with at least one clean placement: one that covers no empty cell
 * (after its own line clears) and stays under the height limit.
 */
export function cleanPieces(board: Board, cfg: PlanScoreConfig = PLAN_SCORE, h = heights(board)): PieceType[] {
  const before = coveredCount(board, h)
  const cells = new Int8Array(8)
  const low = new Int8Array(WIDTH)
  const out: PieceType[] = []
  for (const type of PIECES) {
    let ok = false
    forEachResting(board, type, (rot, x, y) => {
      if (ok) return
      cellsInto(type, rot, x, y, cells)
      let top = 0
      low.fill(127)
      for (let k = 0; k < 8; k += 2) {
        const cx = cells[k]
        const cy = cells[k + 1]
        if (cy < low[cx]) low[cx] = cy
        if (cy + 1 > top) top = cy + 1
      }
      if (top > cfg.heightLimit) return
      let gap = false
      for (let cx = 0; cx < WIDTH && !gap; cx++) if (low[cx] !== 127 && low[cx] > h[cx]) gap = true
      if (!gap) {
        ok = true
        return
      }
      // it leaves a gap under itself; its own line clears may still uncover it
      const after = placeOnBoard(board, { type, rot: rot as Rotation, x, y })
      if (!clearLines(after)) return
      if (coveredCount(after, heights(after)) <= before) ok = true
    })
    if (ok) out.push(type)
  }
  return out
}

export function stackFeatures(board: Board, rule: SpinRule, cfg: PlanScoreConfig = PLAN_SCORE): StackFeatures {
  const h = heights(board)
  const maxHeight = Math.max(...h)
  const slots = allSlots(board, rule)
  const slotCells = new Set<number>()
  const slotCols = new Set<number>()
  for (const list of Object.values(slots))
    for (const s of list)
      for (const [x, y] of s.cells) {
        slotCells.add(y * WIDTH + x)
        slotCols.add(x)
      }

  // covered cells: unreachable ones are "sealed"; reachable ones are slot cells or overhangs
  let covered = 0
  let sealed = 0
  let overhangs = 0
  let slotCovered = 0
  const digRows = new Set<number>()
  const covers = coveredCount(board, h)
  const awkward = covers ? (classifyPockets(board, h, true).awkward ?? new Map()) : new Map()
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < h[x]; y++) {
      const i = y * WIDTH + x
      if (board[i]) continue
      covered++
      const a = awkward.get(i)
      if (a === 'sealed' || a === 'dead') {
        sealed++
        digRows.add(y)
      } else if (slotCells.has(i)) slotCovered++
      else overhangs++
    }
  }

  // surface, ignoring the columns spin slots use (their shape is the point)
  let bumpiness = 0
  let bumpSquared = 0
  for (let x = 0; x + 1 < WIDTH; x++) {
    if (slotCols.has(x) || slotCols.has(x + 1)) continue
    const d = Math.abs(h[x] - h[x + 1])
    bumpiness += d
    bumpSquared += d * d
  }

  let iWellExcess = 0
  for (let x = 0; x < WIDTH; x++) {
    const l = x > 0 ? h[x - 1] : Infinity
    const r = x < WIDTH - 1 ? h[x + 1] : Infinity
    const depth = Math.min(l, r) - h[x]
    if (depth > cfg.iWellDepth && depth !== Infinity) iWellExcess += depth - cfg.iWellDepth
  }

  // rows waiting on a straight-down fill of one column
  let iRows = 0
  for (let y = 0; y < maxHeight; y++) {
    let gap = -1
    let gaps = 0
    for (let x = 0; x < WIDTH && gaps < 2; x++) {
      if (!board[y * WIDTH + x]) {
        gaps++
        gap = x
      }
    }
    // one gap in the row (so 1 wide), open above, and no spin slot fills it
    if (gaps !== 1 || y < h[gap] || slotCells.has(y * WIDTH + gap)) continue
    iRows++
  }

  const clean = cleanPieces(board, cfg, h)
  return {
    heights: h,
    maxHeight,
    covered,
    sealed,
    unsafeDigRows: digRows.size,
    overhangs,
    slotCovered,
    bumpiness,
    bumpSquared,
    iWellExcess,
    iRows,
    clean,
    iOnly: clean.length === 1 && clean[0] === 'I',
    slots,
  }
}

// --- plan score -----------------------------------------------------------------------

export interface PlanOutcome {
  /** what each placement did, in order */
  steps: readonly { type: PieceType; result: ClearResult }[]
  /** the stack after the last placement */
  endBoard: Board
  /** known pieces still unplaced after the plan, nearest first (hold, then the queue) */
  remaining: readonly PieceType[]
  rule: SpinRule
}

export interface ScoreTerm {
  key: string
  label: string
  /** the raw feature value (count, lines, rows…) */
  value: number | string
  /** contribution to the total (signed) */
  points: number
  detail?: string
}

export interface PlanScore {
  total: number
  terms: ScoreTerm[]
  features: StackFeatures
}

/** Known pieces left after placing `placed` from [hold, current, ...queue] (first match removed per placement). */
export function remainingPieces(
  known: { current: PieceType | null; hold: PieceType | null; queue: readonly PieceType[] },
  placed: readonly PieceType[],
): PieceType[] {
  const left = [known.hold, known.current, ...known.queue].filter((t): t is PieceType => t !== null)
  for (const t of placed) {
    const i = left.indexOf(t)
    if (i >= 0) left.splice(i, 1)
  }
  return left
}

const round = (v: number) => Math.round(v * 100) / 100

export function scorePlan(o: PlanOutcome, cfg: PlanScoreConfig = PLAN_SCORE): PlanScore {
  const f = stackFeatures(o.endBoard, o.rule, cfg)
  const terms: ScoreTerm[] = []
  const add = (key: string, label: string, value: number | string, points: number, detail?: string) =>
    terms.push({ key, label, value, points: round(points), detail })

  // totals
  const attack = o.steps.reduce((a, s) => a + s.result.attack, 0)
  const spins = o.steps.filter((s) => s.result.lines > 0 && s.result.spin !== 'none')
  const full = spins.filter((s) => s.result.spin === 'full').length
  const breaks = o.steps.filter((s) => s.result.b2bChange === 'broken').length
  add('attack', 'Attack sent', attack, attack * cfg.attack)
  add(
    'chain',
    'Spin chain',
    spins.length,
    spins.length * cfg.chainLink + Math.max(0, spins.length - 1) * cfg.chainBonus,
    spins.map((s) => s.result.label).join(' → ') || undefined,
  )
  add('fullSpin', 'Full spins', full, full * cfg.fullSpin)
  add('pieces', 'Pieces used', o.steps.length, -o.steps.length * cfg.piecesUsed)
  if (breaks) add('b2bBreak', 'B2B breaks', breaks, -breaks * cfg.b2bBreak)

  // end stack: cleanliness
  add('sealed', 'Unreachable holes', f.sealed, -f.sealed * cfg.sealed)
  add('unsafeDig', 'Rows to dig (B2B risk)', f.unsafeDigRows, -f.unsafeDigRows * cfg.unsafeDig)
  add('overhang', 'Stray overhangs', f.overhangs, -f.overhangs * cfg.overhang, f.slotCovered ? `${f.slotCovered} covered cell(s) belong to spin slots` : undefined)
  add(
    'surface',
    'Surface (outside slots)',
    `${f.bumpiness} / ${f.bumpSquared}²`,
    -(f.bumpiness * cfg.bumpiness + f.bumpSquared * cfg.bumpSquared),
  )

  // flexibility
  const missing = PIECES.filter((t) => !f.clean.includes(t))
  add('cleanSpots', 'Pieces with a clean spot', `${f.clean.length}/7`, -missing.length * cfg.noCleanSpot, missing.length ? `none for ${missing.join(' ')}` : undefined)
  add('iWell', 'I-dependency (deep wells)', f.iWellExcess, -f.iWellExcess * cfg.iWell)
  add('iRows', 'Rows only an I clears B2B-safe', f.iRows, -f.iRows * cfg.iRow)
  if (f.iOnly) add('iOnly', 'Only an I fits cleanly', 'yes', -cfg.iOnly)

  // continuation: spin slots on the end stack, by how sure we are the piece comes
  let cont = 0
  const notes: string[] = []
  for (const t of PIECES) {
    const list = f.slots[t]
    if (!list.length) continue
    const best = Math.max(...list.map((s) => s.lines * (s.spin === 'full' ? 1 : cfg.slotMiniFactor)))
    const known = o.remaining.includes(t)
    cont += best * (known ? cfg.slotKnown : cfg.slotUnseen)
    notes.push(`${list[0].label}${known ? '' : ' (unseen)'}`)
  }
  add('continuation', 'Next spin slots', notes.length, cont, notes.join(', ') || undefined)

  // T resource
  const tSoon = o.remaining.slice(0, cfg.tLookahead).includes('T')
  const tWasted = o.steps.filter((s) => s.type === 'T' && !(s.result.lines > 0 && s.result.spin !== 'none')).length
  if (tSoon) add('tKept', 'T kept for later', 'yes', cfg.tKept)
  if (tWasted) add('tWasted', 'T used without a spin clear', tWasted, -tWasted * cfg.tWasted)

  // safety
  const over = Math.max(0, f.maxHeight - cfg.safetyMargin)
  add('danger', `Height over ${cfg.safetyMargin}`, over, -over * cfg.danger)

  const total = round(terms.reduce((a, t) => a + t.points, 0))
  return { total, terms, features: f }
}

/** A plain-text table of the terms (headless harness, debugging). */
export function formatScore(s: PlanScore, all = false): string {
  const rows = s.terms.filter((t) => all || t.points !== 0)
  const w = Math.max(...rows.map((t) => t.label.length), 5)
  const v = Math.max(...rows.map((t) => String(t.value).length), 5)
  const line = (a: string, b: string, c: string, d = '') => `  ${a.padEnd(w)}  ${b.padStart(v)}  ${c.padStart(7)}${d ? `  ${d}` : ''}`
  return [
    line('term', 'value', 'points'),
    ...rows.map((t) => line(t.label, String(t.value), (t.points > 0 ? '+' : '') + t.points.toFixed(2), t.detail)),
    line('total', '', (s.total > 0 ? '+' : '') + s.total.toFixed(2)),
  ].join('\n')
}

/** Board rows top-down as text ('.' empty, '#' filled), trimmed to the stack. */
export function boardText(board: Board, minRows = 1): string[] {
  let top = 0
  for (let i = 0; i < WIDTH * HEIGHT; i++) if (board[i]) top = Math.floor(i / WIDTH) + 1
  const out: string[] = []
  for (let y = Math.max(top, minRows) - 1; y >= 0; y--) {
    let r = ''
    for (let x = 0; x < WIDTH; x++) r += board[y * WIDTH + x] ? '#' : '.'
    out.push(r)
  }
  return out
}
