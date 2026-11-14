/**
 * Lookahead planner: beam search over the current piece, hold and the visible
 * queue for placement sequences that build and cash in spins without breaking
 * back-to-back. Pure (no DOM); runs inside a Web Worker in the app.
 *
 * Each search node is a board + B2B/combo counters + which pieces are left.
 * Children are every reachable placement (spin finder) of the piece in hand,
 * and of the hold piece (or next piece if hold is empty) via hold.
 * Nodes are ranked by `score`: what the plan has achieved so far plus a static
 * evaluation of the board it leaves (holes, bumpiness, height, open T-slots).
 */
import type { SpinRule } from '../config/scoring'
import { type Candidate, findPlacements } from './finder'
import { type ActivePiece, type Board, type Cell, HEIGHT, VISIBLE, WIDTH } from './game'
import type { Move } from './movegen'
import { type PieceType, SHAPES } from './pieces'
import type { ClearResult, Counters } from './scoring'

export interface PlanRequest {
  board: Board
  counters: Counters
  current: PieceType
  hold: PieceType | null
  holdUsed: boolean
  /** upcoming pieces (the visible previews) */
  queue: readonly PieceType[]
  /** pieces to place, 1–6 */
  depth: number
  /** nodes kept per depth */
  beam: number
  spinRule: SpinRule
  /** a plan the player is following: its remaining steps, to score and keep stable */
  follow?: readonly FollowStep[]
}

export interface FollowStep {
  piece: ActivePiece
  viaHold: boolean
}

export interface PlanStep {
  /** 1-based */
  n: number
  type: PieceType
  piece: ActivePiece
  viaHold: boolean
  path: Move[]
  result: ClearResult
  /** cells in the coordinates of the board the plan started from (earlier line clears undone) */
  cells: Cell[]
}

export interface Plan {
  steps: PlanStep[]
  /** indices of the steps that cash in (B2B-keeping clears: spins, quads) */
  payoffs: number[]
  /** the biggest of those, or -1 */
  payoff: number
  attack: number
  /** B2B-keeping clears (spins, quads) in the plan */
  b2bClears: number
  breaks: number
  /** T-slot left open at the end (lines a T-spin there would clear), 0 if none */
  slotAfter: number
  score: number
  /** the plan the player was already following */
  followed?: boolean
  summary: string
}

export interface PlanProgress {
  depthDone: number
  plans: Plan[]
  nodes: number
  ms: number
}

// --- weights ------------------------------------------------------------------------

export const WEIGHTS = {
  attack: 2,
  b2bClear: 6,
  /** breaking an active streak (and any plain clear while a streak is alive) */
  b2bBreak: 30,
  /** plain line clear with no streak to lose: wasteful but harmless */
  plainClear: 2,
  holes: 4,
  bumpiness: 0.35,
  height: 0.15,
  /** extra per row of max height above `dangerRow` */
  danger: 3,
  dangerRow: 12,
  /** open T-slot, per line it would clear, when a T is still coming */
  tSlot: 5,
  /** open T-slot when no T is left in the horizon (still worth something) */
  tSlotNoT: 2,
}

const cellSetKey = (cells: readonly Cell[]) =>
  cells
    .map(([x, y]) => y * 16 + x)
    .sort((a, b) => a - b)
    .join(',')

// --- fast board features ------------------------------------------------------------------

function heights(board: Board): number[] {
  const h = new Array<number>(WIDTH).fill(0)
  for (let x = 0; x < WIDTH; x++) {
    for (let y = VISIBLE + 3; y >= 0; y--) {
      if (board[y * WIDTH + x]) {
        h[x] = y + 1
        break
      }
    }
  }
  return h
}

function filled(board: Board, x: number, y: number) {
  if (x < 0 || x >= WIDTH || y < 0) return true
  if (y >= HEIGHT) return false
  return board[y * WIDTH + x] !== 0
}

const T_FRONT: Record<number, [number, number]> = { 0: [0, 1], 1: [1, 2], 2: [2, 3], 3: [3, 0] }
const T_CORNERS: [number, number][] = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
]

/**
 * Lines a full T-spin would clear in the best open T-slot (0 if none).
 * Only looks near the surface; requires 3 corners, both facing corners, a roof
 * over at least one cell, and the T resting there.
 */
export function tSlotLines(board: Board, h: number[] = heights(board)): number {
  let best = 0
  for (let rot = 1; rot <= 3; rot++) {
    const cells = SHAPES.T[rot]
    for (let bx = -1; bx < WIDTH - 1; bx++) {
      let lo = Infinity
      let hi = 0
      for (let c = bx; c < bx + 3; c++) {
        if (c < 0 || c >= WIDTH) continue
        lo = Math.min(lo, h[c])
        hi = Math.max(hi, h[c])
      }
      for (let by = Math.max(1, lo - 2); by <= Math.min(VISIBLE, hi + 1); by++) {
        // fits?
        let ok = true
        for (const [cx, cy] of cells) {
          if (filled(board, bx + cx, by - cy)) {
            ok = false
            break
          }
        }
        if (!ok) continue
        // resting?
        let grounded = false
        for (const [cx, cy] of cells) if (filled(board, bx + cx, by - cy - 1)) grounded = true
        if (!grounded) continue
        // corners
        const f = T_CORNERS.map(([dx, dy]) => filled(board, bx + dx, by - dy))
        if (f.filter(Boolean).length < 3) continue
        const [a, b] = T_FRONT[rot]
        if (!f[a] || !f[b]) continue
        // roof: something above one of its cells (otherwise it is just a hole you can drop into)
        let roof = false
        for (const [cx, cy] of cells) {
          const x = bx + cx
          for (let y = by - cy + 1; y < h[x] && !roof; y++) if (filled(board, x, y)) roof = true
        }
        if (!roof) continue
        // lines it would clear
        let lines = 0
        const rows = new Set(cells.map(([, cy]) => by - cy))
        for (const y of rows) {
          let full = true
          for (let x = 0; x < WIDTH && full; x++) {
            if (filled(board, x, y)) continue
            if (!cells.some(([cx, cy]) => bx + cx === x && by - cy === y)) full = false
          }
          if (full) lines++
        }
        if (lines > best) best = lines
      }
    }
  }
  return best
}

export interface BoardEval {
  holes: number
  bumpiness: number
  height: number
  maxHeight: number
  slot: number
}

export function evaluateBoard(board: Board): BoardEval {
  const h = heights(board)
  let holes = 0
  for (let x = 0; x < WIDTH; x++) for (let y = 0; y < h[x]; y++) if (!board[y * WIDTH + x]) holes++
  let bump = 0
  for (let x = 0; x < WIDTH - 1; x++) bump += Math.abs(h[x] - h[x + 1])
  const height = h.reduce((a, b) => a + b, 0)
  const slot = tSlotLines(board, h)
  // a T-slot's own cavity is not a "hole" worth penalising: it is the point
  return { holes: Math.max(0, holes - (slot ? 1 : 0)), bumpiness: bump, height, maxHeight: Math.max(...h), slot }
}

// --- search ----------------------------------------------------------------------------------

interface Node {
  board: Board
  counters: Counters
  /** piece in hand, null when the known queue ran out */
  current: PieceType | null
  hold: PieceType | null
  /** hold may be used for `current` */
  canHold: boolean
  /** next unread queue index */
  next: number
  steps: PlanStep[]
  /** original-board row for each row of `board` (to map cells back) */
  rows: number[]
  attack: number
  b2bClears: number
  breaks: number
  plain: number
  eval: BoardEval
  score: number
  /** identifies the first placement (for diversity in the beam) */
  first: string
}

function tLeft(n: Node, queue: readonly PieceType[]): boolean {
  if (n.current === 'T' || n.hold === 'T') return true
  for (let i = n.next; i < queue.length; i++) if (queue[i] === 'T') return true
  return false
}

function scoreNode(n: Node, queue: readonly PieceType[]): number {
  const w = WEIGHTS
  const e = n.eval
  let s = n.attack * w.attack + n.b2bClears * w.b2bClear - n.breaks * w.b2bBreak - n.plain * w.plainClear
  s -= e.holes * w.holes + e.bumpiness * w.bumpiness + e.height * w.height
  if (e.maxHeight > w.dangerRow) s -= (e.maxHeight - w.dangerRow) * w.danger
  if (e.slot) s += e.slot * (tLeft(n, queue) ? w.tSlot : w.tSlotNoT)
  return s
}

function boardKey(n: Node): string {
  // cheap FNV-1a over the board, plus hold/counters/progress
  let h = 0x811c9dc5
  const b = n.board
  const top = Math.min(HEIGHT, VISIBLE + 4) * WIDTH
  for (let i = 0; i < top; i++) {
    h ^= b[i] ? 1 : 0
    h = Math.imul(h, 0x01000193)
  }
  return `${h >>> 0}|${n.hold}|${n.current}|${n.next}|${n.counters.b2b}|${n.counters.combo}`
}

function apply(n: Node, c: Candidate, nextCurrent: PieceType | null, hold: PieceType | null, next: number, queue: readonly PieceType[]): Node {
  const r = c.result
  // map rows: drop cleared rows from the mapping
  let rows = n.rows
  if (r.lines) {
    const cleared = new Set<number>()
    for (const [, y] of c.cells) {
      let full = true
      for (let x = 0; x < WIDTH && full; x++) {
        if (!n.board[y * WIDTH + x] && !c.cells.some(([cx, cy]) => cx === x && cy === y)) full = false
      }
      if (full) cleared.add(y)
    }
    const kept = rows.filter((_, i) => !cleared.has(i))
    let top = rows[rows.length - 1]
    while (kept.length < rows.length) kept.push(++top)
    rows = kept
  }
  const step: PlanStep = {
    n: n.steps.length + 1,
    type: c.piece.type,
    piece: c.piece,
    viaHold: c.viaHold,
    path: c.path,
    result: r,
    cells: c.cells.map(([x, y]): Cell => [x, n.rows[y]]),
  }
  const keeps = r.lines > 0 && r.difficult
  const child: Node = {
    board: c.board,
    counters: r.after,
    current: nextCurrent,
    hold,
    canHold: true,
    next,
    steps: [...n.steps, step],
    rows,
    attack: n.attack + r.attack,
    b2bClears: n.b2bClears + (keeps ? 1 : 0),
    breaks: n.breaks + (r.b2bChange === 'broken' ? 1 : 0),
    plain: n.plain + (r.lines > 0 && !r.difficult && r.b2bChange !== 'broken' ? 1 : 0),
    eval: evaluateBoard(c.board),
    score: 0,
    first: n.steps.length ? n.first : `${c.viaHold ? 'h' : ''}${cellSetKey(c.cells)}`,
  }
  child.score = scoreNode(child, queue)
  return child
}

interface Transition {
  type: PieceType
  viaHold: boolean
  nextCurrent: PieceType | null
  hold: PieceType | null
  next: number
}

/** The piece choices at a node: the piece in hand, or (via hold) the held / next piece. */
function transitions(n: Node, queue: readonly PieceType[]): Transition[] {
  const cur = n.current
  if (!cur) return []
  const draw = (i: number) => (i < queue.length ? queue[i] : null)
  const out: Transition[] = [{ type: cur, viaHold: false, nextCurrent: draw(n.next), hold: n.hold, next: n.next + 1 }]
  if (n.canHold) {
    const other = n.hold ?? draw(n.next)
    const after = n.hold ? n.next : n.next + 1
    if (other && other !== cur) out.push({ type: other, viaHold: true, nextCurrent: draw(after), hold: cur, next: after + 1 })
  }
  return out
}

function expand(n: Node, queue: readonly PieceType[], spinRule: SpinRule): Node[] {
  const out: Node[] = []
  for (const t of transitions(n, queue)) {
    for (const c of findPlacements(n.board, t.type, n.counters, t.viaHold, { spinRule })) {
      out.push(apply(n, c, t.nextCurrent, t.hold, t.next, queue))
    }
  }
  return out
}

function describe(p: Omit<Plan, 'summary'>): string {
  if (p.payoffs.length) {
    const parts = p.payoffs.map((i) => {
      const s = p.steps[i]
      return `${s.result.label} +${s.result.attack} (${s.n})`
    })
    const last = p.steps[p.payoffs[p.payoffs.length - 1]].result
    const b2b = last.b2bChange === 'started' ? 'starts B2B' : `B2B ×${last.after.b2b}`
    return `${parts.join(' → ')} · ${b2b}`
  }
  if (p.slotAfter) return `Builds a ${['', 'TSS', 'TSD', 'TST'][p.slotAfter]} slot`
  return 'Clean stacking'
}

function toPlan(n: Node, followed = false): Plan {
  const payoffs: number[] = []
  n.steps.forEach((s, i) => {
    if (s.result.lines > 0 && s.result.difficult) payoffs.push(i)
  })
  let payoff = -1
  for (const i of payoffs) if (payoff < 0 || n.steps[i].result.attack > n.steps[payoff].result.attack) payoff = i
  const base = {
    // show the steps up to the last payoff; after it the plan is just filler
    steps: payoffs.length ? n.steps.slice(0, payoffs[payoffs.length - 1] + 1) : n.steps,
    payoffs,
    payoff,
    attack: n.attack,
    b2bClears: n.b2bClears,
    breaks: n.breaks,
    slotAfter: n.eval.slot,
    score: n.score,
    followed,
  }
  return { ...base, summary: describe(base) }
}

function rootNode(req: PlanRequest): Node {
  const root: Node = {
    board: req.board,
    counters: req.counters,
    current: req.current,
    hold: req.hold,
    canHold: !req.holdUsed,
    next: 0,
    steps: [],
    rows: Array.from({ length: HEIGHT }, (_, i) => i),
    attack: 0,
    b2bClears: 0,
    breaks: 0,
    plain: 0,
    eval: evaluateBoard(req.board),
    score: 0,
    first: '',
  }
  root.score = scoreNode(root, req.queue)
  return root
}

/** Replay a followed plan on the current state; null if any step is no longer possible. */
function replay(req: PlanRequest, follow: readonly FollowStep[]): Node | null {
  let n = rootNode(req)
  for (const f of follow) {
    const t = transitions(n, req.queue).find((x) => x.viaHold === f.viaHold)
    if (!t || t.type !== f.piece.type) return null
    const want = cellSetKey(SHAPES[f.piece.type][f.piece.rot].map(([cx, cy]): Cell => [f.piece.x + cx, f.piece.y - cy]))
    const c = findPlacements(n.board, t.type, n.counters, t.viaHold, { spinRule: req.spinRule }).find(
      (x) => cellSetKey(x.cells) === want,
    )
    if (!c) return null
    n = apply(n, c, t.nextCurrent, t.hold, t.next, req.queue)
  }
  return n
}

/**
 * Beam search. Calls `onProgress` after each depth with the best plans so far.
 * Returns the final top plans (distinct first moves).
 */
export function searchPlans(req: PlanRequest, onProgress?: (p: PlanProgress) => void, top = 3): Plan[] {
  const t0 = performance.now()
  let beam: Node[] = [rootNode(req)]
  let nodes = 0
  let plans: Plan[] = []
  const depth = Math.max(1, Math.min(6, req.depth))
  // a plan the player is following is scored first and shown straight away
  const followed = req.follow?.length ? replay(req, req.follow) : null
  const fp = followed ? toPlan(followed, true) : null
  if (fp) onProgress?.({ depthDone: 0, plans: [fp], nodes: 0, ms: performance.now() - t0 })
  for (let d = 1; d <= depth; d++) {
    const children: Node[] = []
    for (const n of beam) {
      const kids = expand(n, req.queue, req.spinRule)
      nodes += kids.length
      children.push(...kids)
    }
    if (!children.length) break
    children.sort((a, b) => b.score - a.score)
    // keep the best nodes, but no first move may take more than a third of the
    // beam, so alternative plans survive to the end
    const seen = new Set<string>()
    const perFirst = new Map<string, number>()
    const cap = Math.max(2, Math.ceil(req.beam / 3))
    beam = []
    for (const c of children) {
      const k = boardKey(c)
      if (seen.has(k)) continue
      const used = perFirst.get(c.first) ?? 0
      if (used >= cap) continue
      seen.add(k)
      perFirst.set(c.first, used + 1)
      beam.push(c)
      if (beam.length >= req.beam) break
    }
    plans = pickPlans(beam, top)
    onProgress?.({ depthDone: d, plans, nodes, ms: performance.now() - t0 })
  }
  // keep following unless something clearly better turned up
  if (fp && (!plans[0] || fp.score >= plans[0].score - 3)) {
    plans = [fp, ...plans.filter((p) => !samePlan(p, fp))].slice(0, top)
  }
  return plans
}

function samePlan(a: Plan, b: Plan) {
  const s = (p: Plan) => p.steps.map((x) => `${x.viaHold ? 'h' : ''}${x.cells.join(';')}`).join('|')
  return s(a) === s(b)
}

function pickPlans(beam: Node[], top: number): Plan[] {
  const out: Plan[] = []
  const firsts = new Set<string>()
  for (const n of beam) {
    const p = toPlan(n)
    const f = p.steps[0]
    const k = f ? `${f.viaHold}|${f.cells.join(';')}` : ''
    if (firsts.has(k)) continue
    firsts.add(k)
    out.push(p)
    if (out.length >= top) break
  }
  return out
}
