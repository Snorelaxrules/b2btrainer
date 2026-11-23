/**
 * Spin-chain planner: searches sequences of placements (with hold) over the
 * KNOWN pieces only (piece in hand, hold, visible queue) that complete one or
 * more B2B-keeping spin clears in a row while keeping the stack clean.
 *
 * - Nodes are full game states: board, piece in hand, hold (+ used flag), queue
 *   index, B2B and combo. Children are every reachable placement (real move
 *   search, SRS+ kicks) of the piece in hand, or of the hold / next piece via hold.
 * - Hard prunes only: a placement that breaks B2B, leaves the stack above the
 *   height limit, or seals off a new hole is never part of a plan.
 * - Partial plans are ranked by what they achieved, plus the spin slots their
 *   stack offers the pieces still coming, minus a light stack tie-breaker.
 * - A plan is complete right after a B2B-keeping clear (spin or quad); it may
 *   go on to chain up to `maxChain` spins. Complete plans are scored on their
 *   END stack plus totals (planScore.ts). With no clear in reach, the best
 *   setups (stacks with a slot ready for a known piece) are returned instead.
 * - Iterative widening under a time budget: a narrow pass first (always
 *   finished), then wider passes until the budget runs out; the best plans so
 *   far are reported after each pass. A transposition key drops repeat states.
 * - Every plan returned has been replayed through the real engine (verify.ts).
 *
 * Pure (no DOM); runs in a Web Worker in the app.
 */
import { PLAN_SCORE, PLAN_SEARCH, type PlanScoreConfig, type PlanSearchConfig } from '../config/planScore'
import type { SpinRule } from '../config/scoring'
import { classifyPockets, heights, sealedCells, sealedHoles } from './features'
import { type Candidate, findPlacements } from './finder'
import {
  type ActivePiece,
  type Board,
  type Cell,
  type GameState,
  HEIGHT,
  VISIBLE,
  WIDTH,
  clearLines,
  newGame,
  placeOnBoard,
  spawnPiece,
} from './game'
import type { Move } from './movegen'
import { type PlanScore, type ScoreTerm, scorePlan } from './planScore'
import { PIECES, type PieceType, SHAPES } from './pieces'
import type { ClearResult, Counters } from './scoring'
import { slots } from './slots'
import { verifyPlan } from './verify'

export interface PlanRequest {
  board: Board
  counters: Counters
  current: PieceType
  hold: PieceType | null
  holdUsed: boolean
  /** upcoming pieces (the visible previews) */
  queue: readonly PieceType[]
  /** the active spin rule: decides which placements are spins that keep B2B */
  spinRule: SpinRule
  /** most pieces a plan may place (default: every known piece) */
  depth?: number
  /** time budget in ms (default PLAN_SEARCH.budgetMs; Infinity = run every pass up to beamMax) */
  budgetMs?: number
  /** first-pass beam width (default PLAN_SEARCH.beamStart) */
  beam?: number
  /** widest pass (default PLAN_SEARCH.beamMax) */
  beamMax?: number
  /** most spin clears per plan (default PLAN_SEARCH.maxChain) */
  maxChain?: number
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
  /** why this step costs something, when it does (e.g. "leaves a hole no piece can reach") */
  note?: string
}

export interface Plan {
  /** 'chain': ends with a B2B-keeping clear; 'setup': no clear in reach, builds toward one */
  kind: 'chain' | 'setup'
  steps: PlanStep[]
  /** indices of the steps that clear B2B-safely (spins, quads) */
  payoffs: number[]
  /** spin clears in the plan */
  chain: number
  attack: number
  /** total of the score terms */
  score: number
  /** per-feature contributions (src/config/planScore.ts) */
  terms: ScoreTerm[]
  /** awkward cells (unreachable or spin-only) the plan leaves that weren't there before */
  awkward: number
  /** the plan the player was already following */
  followed?: boolean
  summary: string
}

export interface PlanProgress {
  /** passes finished (each wider than the last) */
  pass: number
  beam: number
  plans: Plan[]
  nodes: number
  ms: number
  /** candidate plans rejected by engine verification so far in this search */
  discarded: number
}

export interface SearchOptions {
  /** replay every plan through the real engine before returning it (default true) */
  verify?: boolean
  score?: PlanScoreConfig
  search?: PlanSearchConfig
}

/**
 * A real game state equal to the request: the position the plan must be playable from.
 * Pieces beyond `req.queue` are filled by the engine from an arbitrary bag; a plan
 * that touched them would fail verification on piece type, so it can't rely on them.
 */
export function stateFromRequest(req: PlanRequest): GameState {
  const g = newGame({ seed: 1, rules: { spinRule: req.spinRule, gravity: 'none' } })
  return {
    ...g,
    board: req.board,
    counters: req.counters,
    active: spawnPiece(req.current),
    hold: req.hold,
    holdUsed: req.holdUsed,
    queue: [...req.queue, ...PIECES],
  }
}

const cellSetKey = (cells: readonly Cell[]) =>
  cells
    .map(([x, y]) => y * 16 + x)
    .sort((a, b) => a - b)
    .join(',')

// --- cheap stack features (every child) ---------------------------------------------------

interface Cheap {
  covered: number
  sealed: number
  bump: number
  bumpSq: number
  iWell: number
  iRows: number
  maxHeight: number
}

function cheapEval(board: Board, cfg: PlanScoreConfig): Cheap {
  const h = heights(board)
  let covered = 0
  for (let x = 0; x < WIDTH; x++) for (let y = 0; y < h[x]; y++) if (!board[y * WIDTH + x]) covered++
  let bump = 0
  let bumpSq = 0
  for (let x = 0; x + 1 < WIDTH; x++) {
    const d = Math.abs(h[x] - h[x + 1])
    bump += d
    bumpSq += d * d
  }
  let iWell = 0
  for (let x = 0; x < WIDTH; x++) {
    const depth = Math.min(x > 0 ? h[x - 1] : Infinity, x < WIDTH - 1 ? h[x + 1] : Infinity) - h[x]
    if (depth > cfg.iWellDepth && depth !== Infinity) iWell += depth - cfg.iWellDepth
  }
  const maxHeight = Math.max(...h)
  let iRows = 0
  for (let y = 0; y < maxHeight; y++) {
    let gaps = 0
    let gap = -1
    for (let x = 0; x < WIDTH && gaps < 2; x++)
      if (!board[y * WIDTH + x]) {
        gaps++
        gap = x
      }
    if (gaps === 1 && y >= h[gap]) iRows++
  }
  return { covered, sealed: covered ? sealedHoles(board, h) : 0, bump, bumpSq, iWell, iRows, maxHeight }
}

function tieBreak(c: Cheap, cfg: PlanScoreConfig, s: PlanSearchConfig): number {
  return (
    s.partialStack *
    (c.covered * cfg.overhang +
      c.bump * cfg.bumpiness +
      c.bumpSq * cfg.bumpSquared +
      c.iWell * cfg.iWell +
      c.iRows * cfg.iRow +
      Math.max(0, c.maxHeight - cfg.safetyMargin) * cfg.danger)
  )
}

// --- optimistic T-slot shape (no move search) --------------------------------------------

function filledAt(board: Board, x: number, y: number) {
  if (x < 0 || x >= WIDTH || y < 0) return true
  if (y >= HEIGHT) return false
  return board[y * WIDTH + x] !== 0
}
const T_FRONT: Record<number, [number, number]> = { 1: [1, 2], 2: [2, 3], 3: [3, 0] }
const T_CORNERS: [number, number][] = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
]

/** Lines the best T-spin-shaped spot would clear, by shape alone (an upper bound for the real check). */
function tShapeLines(board: Board): number {
  const h = heights(board)
  let best = 0
  for (let rot = 1; rot <= 3; rot++) {
    const cells = SHAPES.T[rot]
    for (let bx = -1; bx < WIDTH - 1; bx++) {
      let lo = Infinity
      let hi = 0
      for (let c = Math.max(0, bx); c < Math.min(WIDTH, bx + 3); c++) {
        lo = Math.min(lo, h[c])
        hi = Math.max(hi, h[c])
      }
      for (let by = Math.max(1, lo - 2); by <= Math.min(VISIBLE, hi + 1); by++) {
        if (cells.some(([cx, cy]) => filledAt(board, bx + cx, by - cy))) continue
        if (!cells.some(([cx, cy]) => filledAt(board, bx + cx, by - cy - 1))) continue
        const f = T_CORNERS.map(([dx, dy]) => filledAt(board, bx + dx, by - dy))
        if (f.filter(Boolean).length < 3) continue
        const [a, b] = T_FRONT[rot]
        if (!f[a] || !f[b]) continue
        let lines = 0
        for (const y of new Set(cells.map(([, cy]) => by - cy))) {
          let full = true
          for (let x = 0; x < WIDTH && full; x++)
            if (!filledAt(board, x, y) && !cells.some(([cx, cy]) => bx + cx === x && by - cy === y)) full = false
          if (full) lines++
        }
        if (lines > best) best = lines
      }
    }
  }
  return best
}

// --- search nodes ------------------------------------------------------------------------------

interface Node {
  board: Board
  counters: Counters
  /** piece in hand, null when the known queue ran out */
  current: PieceType | null
  hold: PieceType | null
  canHold: boolean
  /** next unread queue index */
  next: number
  steps: PlanStep[]
  /** original-board row for each row of `board` (to map cells back) */
  rows: number[]
  attack: number
  chain: number
  full: number
  tWasted: number
  cheap: Cheap
  /** achieved totals as score points */
  achieved: number
  /** spin-slot value for the pieces still known to come (optimistic until confirmed) */
  potential: number
  confirmed: boolean
  rank: number
  /** identifies the first placement (diversity) */
  first: string
  hash: number
}

function boardHash(b: Board): number {
  let h = 0x811c9dc5
  const top = Math.min(HEIGHT, VISIBLE + 4) * WIDTH
  for (let i = 0; i < top; i++) {
    h ^= b[i] ? 1 : 0
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Transposition key: same board, same pieces left, same counters → same future. */
const stateKey = (n: Node) => `${n.hash}|${n.next}|${n.current}|${n.hold}|${+n.canHold}|${n.counters.b2b}|${n.counters.combo}`

/** Known pieces not yet placed, nearest first (hold, hand, queue). */
function remainingOf(n: Node, queue: readonly PieceType[]): PieceType[] {
  const out: PieceType[] = []
  if (n.hold) out.push(n.hold)
  if (n.current) out.push(n.current)
  for (let i = n.next; i < queue.length; i++) out.push(queue[i])
  return out
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

class Search {
  readonly cfg: PlanScoreConfig
  readonly s: PlanSearchConfig
  readonly req: PlanRequest
  readonly maxChain: number
  private potentialMemo = new Map<string, number>()
  private scoreMemo = new Map<string, PlanScore>()
  nodes = 0

  constructor(req: PlanRequest, opts: SearchOptions) {
    this.req = req
    this.cfg = opts.score ?? PLAN_SCORE
    this.s = opts.search ?? PLAN_SEARCH
    this.maxChain = req.maxChain ?? this.s.maxChain
  }

  root(): Node {
    const req = this.req
    const n: Node = {
      board: req.board,
      counters: req.counters,
      current: req.current,
      hold: req.hold,
      canHold: !req.holdUsed,
      next: 0,
      steps: [],
      rows: Array.from({ length: HEIGHT }, (_, i) => i),
      attack: 0,
      chain: 0,
      full: 0,
      tWasted: 0,
      cheap: cheapEval(req.board, this.cfg),
      achieved: 0,
      potential: 0,
      confirmed: false,
      rank: 0,
      first: '',
      hash: boardHash(req.board),
    }
    this.confirm(n)
    return n
  }

  /** Child state after placing candidate `c` via transition `t`. */
  apply(n: Node, c: Candidate, t: Transition): Node {
    const r = c.result
    let rows = n.rows
    if (r.lines) {
      const cleared = new Set<number>()
      for (const [, y] of c.cells) {
        let full = true
        for (let x = 0; x < WIDTH && full; x++)
          if (!n.board[y * WIDTH + x] && !c.cells.some(([cx, cy]) => cx === x && cy === y)) full = false
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
    const spinClear = r.lines > 0 && r.spin !== 'none'
    const cfg = this.cfg
    const chain = n.chain + (spinClear ? 1 : 0)
    const full = n.full + (spinClear && r.spin === 'full' ? 1 : 0)
    const links = full + (chain - full) * cfg.chainMiniFactor
    const attack = n.attack + r.attack
    const tWasted = n.tWasted + (c.piece.type === 'T' && !spinClear ? 1 : 0)
    const pieces = n.steps.length + 1
    const holds = n.steps.filter((s) => s.viaHold).length + (c.viaHold ? 1 : 0)
    const child: Node = {
      board: c.board,
      counters: r.after,
      current: t.nextCurrent,
      hold: t.hold,
      canHold: true,
      next: t.next,
      steps: [...n.steps, step],
      rows,
      attack,
      chain,
      full,
      tWasted,
      cheap: cheapEval(c.board, cfg),
      achieved:
        attack * cfg.attack +
        links * cfg.chainLink +
        Math.max(0, links - 1) * cfg.chainBonus +
        full * cfg.fullSpin -
        pieces * cfg.piecesUsed -
        holds * cfg.holdUsed -
        tWasted * cfg.tWasted,
      potential: 0,
      confirmed: false,
      rank: 0,
      first: n.steps.length ? n.first : `${c.viaHold ? 'h' : ''}${cellSetKey(c.cells)}`,
      hash: boardHash(c.board),
    }
    child.potential = this.optimisticPotential(child)
    child.rank = child.achieved + child.potential - tieBreak(child.cheap, cfg, this.s)
    return child
  }

  private optimisticPotential(n: Node): number {
    const left = remainingOf(n, this.req.queue)
    const cfg = this.cfg
    let best = 0
    if (left.includes('T')) best = tShapeLines(n.board)
    if (this.req.spinRule !== 'tspin' && left.some((t) => t !== 'T' && t !== 'O'))
      best = Math.max(best, this.req.spinRule === 'allspin' ? 2 : 2 * cfg.slotMiniFactor)
    return best * cfg.slotKnown
  }

  /** Replace the optimistic slot value with the real one (move search per piece type left). */
  confirm(n: Node) {
    if (n.confirmed) return
    const types = [...new Set(remainingOf(n, this.req.queue))].sort().join('')
    const key = `${n.hash}|${types}`
    let v = this.potentialMemo.get(key)
    if (v === undefined) {
      v = 0
      for (const t of types as Iterable<PieceType>) {
        for (const sl of slots(n.board, t, this.req.spinRule)) {
          const val = sl.lines * (sl.spin === 'full' ? 1 : this.cfg.slotMiniFactor)
          if (val > v) v = val
        }
      }
      v *= this.cfg.slotKnown
      this.potentialMemo.set(key, v)
    }
    n.potential = v
    n.confirmed = true
    n.rank = n.achieved + n.potential - tieBreak(n.cheap, this.cfg, this.s)
  }

  /** Children of a node after the hard prunes. */
  expand(n: Node): Node[] {
    const out: Node[] = []
    if (n.chain >= this.maxChain) return out
    for (const t of transitions(n, this.req.queue)) {
      for (const c of findPlacements(n.board, t.type, n.counters, t.viaHold, { spinRule: this.req.spinRule })) {
        // never part of a plan: breaking back-to-back
        if (c.result.b2bChange === 'broken') continue
        const child = this.apply(n, c, t)
        // too tall, or a hole sealed off that the known pieces left can't reopen
        if (child.cheap.maxHeight > this.cfg.heightLimit) continue
        if (child.cheap.sealed > n.cheap.sealed && !reopenable(child.board, remainingOf(child, this.req.queue).length)) continue
        out.push(child)
      }
    }
    this.nodes += out.length
    return out
  }

  /** Full end-state score (memoised: different orders often reach the same end). */
  fullScore(n: Node): PlanScore {
    const remaining = remainingOf(n, this.req.queue)
    const key = `${n.hash}|${remaining.join('')}|${n.steps.map((s) => `${s.type}${s.result.label}${s.result.attack}`).join(',')}`
    let sc = this.scoreMemo.get(key)
    if (!sc) {
      sc = scorePlan({ steps: n.steps, endBoard: n.board, remaining, rule: this.req.spinRule }, this.cfg)
      this.scoreMemo.set(key, sc)
    }
    return sc
  }
}

/**
 * Could `pieces` more pieces reopen every sealed hole? A hole opens once every
 * row holding a block above it in its column is cleared; those rows' empty
 * cells must all be filled, at 4 cells a piece. (A bound, not a plan: it keeps
 * setups like a spin that seals a cell the next spin clears out.)
 */
function reopenable(board: Board, pieces: number): boolean {
  const rows = new Set<number>()
  for (const i of sealedCells(board)) {
    const x = i % WIDTH
    for (let y = (i - x) / WIDTH + 1; y < HEIGHT; y++) if (board[y * WIDTH + x]) rows.add(y)
  }
  let need = 0
  for (const y of rows) for (let x = 0; x < WIDTH; x++) if (!board[y * WIDTH + x]) need++
  return need <= pieces * 4
}

const isPayoff = (r: ClearResult) => r.lines > 0 && r.difficult && r.b2bChange !== 'broken'

/**
 * Search for plans. Calls `onProgress` after each pass with the best plans so
 * far. Returns up to `top` verified plans with distinct first moves.
 */
export function searchPlans(req: PlanRequest, onProgress?: (p: PlanProgress) => void, top = 3, opts: SearchOptions = {}): Plan[] {
  const t0 = performance.now()
  const S = new Search(req, opts)
  const cfgS = S.s
  const budget = req.budgetMs ?? cfgS.budgetMs
  const deadline = t0 + budget
  const beamMax = req.beamMax ?? cfgS.beamMax
  const known = 1 + (req.hold ? 1 : 0) + req.queue.length
  const maxPieces = Math.max(1, Math.min(req.depth ?? known, known))
  const verify = opts.verify !== false
  const start = verify ? stateFromRequest(req) : null
  const tally = { discarded: 0 }

  // plans found across passes: complete chains, and setup candidates
  const chains = new Map<string, Node>()
  const setups = new Map<string, Node>()
  const keep = (pool: Map<string, Node>, n: Node) => {
    const k = `${n.first}|${stateKey(n)}`
    const cur = pool.get(k)
    if (!cur || cur.rank < n.rank) pool.set(k, n)
  }

  let plans: Plan[] = []
  let pass = 0
  for (let beamW = req.beam ?? cfgS.beamStart; ; beamW *= 3) {
    const finished = runPass(S, beamW, maxPieces, pass === 0 ? Infinity : deadline, (n) => {
      if (n.steps.length && isPayoff(n.steps[n.steps.length - 1].result)) keep(chains, n)
      else if (!n.chain) keep(setups, n)
    })
    pass++
    plans = finalize(S, chains, setups, top, start, tally)
    onProgress?.({ pass, beam: beamW, plans, nodes: S.nodes, ms: performance.now() - t0, discarded: tally.discarded })
    if (!finished || beamW * 3 > beamMax || performance.now() >= deadline) break
  }
  return plans
}

/**
 * One beam pass to `maxPieces`. Each level: rank children, confirm slot values
 * lazily best-first (confirming only lowers the optimistic T value; non-T slot
 * values are bounded the same way), admit with a transposition check and a
 * per-first-move cap. Returns false if the deadline cut it short.
 */
function runPass(S: Search, beamW: number, maxPieces: number, deadline: number, seen: (n: Node) => void): boolean {
  let beam: Node[] = [S.root()]
  for (let d = 1; d <= maxPieces; d++) {
    const children: Node[] = []
    for (const n of beam) {
      if (performance.now() > deadline) return false
      children.push(...S.expand(n))
    }
    if (!children.length) break
    children.sort((a, b) => b.rank - a.rank)
    const admitted = new Set<string>()
    const perFirst = new Map<string, number>()
    const cap = Math.max(2, Math.ceil(beamW / 3))
    const pool: Node[] = [] // confirmed, best last
    const insert = (c: Node) => {
      let lo = 0
      let hi = pool.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (pool[mid].rank <= c.rank) lo = mid + 1
        else hi = mid
      }
      pool.splice(lo, 0, c)
    }
    let budget = beamW * 3
    let i = 0
    beam = []
    const admit = (c: Node) => {
      const k = stateKey(c)
      if (admitted.has(k)) return
      const used = perFirst.get(c.first) ?? 0
      if (used >= cap) return
      admitted.add(k)
      perFirst.set(c.first, used + 1)
      S.confirm(c)
      beam.push(c)
      seen(c)
    }
    while (beam.length < beamW) {
      const nextOpt = i < children.length && budget > 0 ? children[i].rank : -Infinity
      if (pool.length && pool[pool.length - 1].rank >= nextOpt) admit(pool.pop() as Node)
      else if (i < children.length) {
        const c = children[i++]
        if (admitted.has(stateKey(c))) continue
        if (budget > 0) {
          budget--
          S.confirm(c)
          insert(c)
        } else admit(c)
      } else break
    }
    // completed chains count even when they didn't make the beam
    for (const c of children)
      if (isPayoff(c.steps[c.steps.length - 1].result)) {
        S.confirm(c)
        seen(c)
      }
  }
  return true
}

/** Fully score the best candidates, verify, explain; distinct first moves. */
function finalize(
  S: Search,
  chains: Map<string, Node>,
  setups: Map<string, Node>,
  top: number,
  start: GameState | null,
  tally: { discarded: number },
): Plan[] {
  // a finished plan never leaves more sealed holes than it started with (mid-plan
  // it may seal one that a later clear reopens)
  const rootSealed = sealedHoles(S.req.board)
  const ok = (n: Node) => n.cheap.sealed <= rootSealed
  const chainList = [...chains.values()].filter(ok)
  const pool = chainList.length ? chainList : [...setups.values()].filter(ok)
  const kind = chainList.length ? 'chain' : 'setup'
  pool.sort((a, b) => b.rank - a.rank)
  // finalists: the best by rank, but no first move takes more than its share
  const per = new Map<string, number>()
  const picked: Node[] = []
  for (const n of pool) {
    const k = per.get(n.first) ?? 0
    if (k >= S.s.finalists) continue
    per.set(n.first, k + 1)
    picked.push(n)
    if (picked.length >= top * S.s.finalists * 2) break
  }
  const scored = picked.map((n) => ({ n, sc: S.fullScore(n) }))
  scored.sort((a, b) => b.sc.total - a.sc.total)
  const out: Plan[] = []
  const firsts = new Set<string>()
  // the same placements in another order are the same plan (the player can follow either)
  const sets = new Set<string>()
  for (const { n, sc } of scored) {
    if (firsts.has(n.first)) continue
    const set = n.steps.map((s) => `${s.type}:${cellSetKey(s.cells)}`).sort().join('|')
    if (sets.has(set)) continue
    const p = toPlan(n, sc, kind)
    if (start && !verifyPlan(start, p).ok) {
      tally.discarded++
      continue
    }
    firsts.add(n.first)
    sets.add(set)
    annotate(p, S.req.board, sc, remainingOf(n, S.req.queue))
    out.push(p)
    if (out.length >= top) break
  }
  const seen = new Map<string, number>()
  for (const p of out) {
    const k = (seen.get(p.summary) ?? 0) + 1
    seen.set(p.summary, k)
    if (k > 1) p.summary += ` (variant ${k})`
  }
  return out
}

function toPlan(n: Node, sc: PlanScore, kind: Plan['kind'], followed = false): Plan {
  const payoffs: number[] = []
  n.steps.forEach((s, i) => {
    if (isPayoff(s.result)) payoffs.push(i)
  })
  return {
    kind,
    steps: n.steps.map((s) => ({ ...s, note: undefined })),
    payoffs,
    chain: n.chain,
    attack: n.attack,
    score: sc.total,
    terms: sc.terms,
    awkward: 0,
    followed,
    summary: '',
  }
}

// --- explanations ------------------------------------------------------------------------

const article = (t: string) => (t === 'I' || t === 'L' || t === 'O' || t === 'S' ? 'an' : 'a')

function describe(p: Plan, sc: PlanScore, remaining: readonly PieceType[]): string {
  const seq = p.steps.map((s) => `${s.viaHold ? 'hold→' : ''}${s.type}`).join(', ')
  if (p.payoffs.length) {
    const parts = p.payoffs.map((i) => `${p.steps[i].result.label} +${p.steps[i].result.attack}`)
    const last = p.steps[p.payoffs[p.payoffs.length - 1]].result
    const b2b = last.b2bChange === 'started' ? 'starts B2B' : `B2B ×${last.after.b2b}`
    return `${parts.join(' → ')} · ${b2b} · ${seq}`
  }
  // a setup: name the best slot it leaves for a piece we know is coming
  let best: { label: string; type: PieceType; v: number } | null = null
  for (const t of new Set(remaining)) {
    for (const s of sc.features.slots[t]) {
      const v = s.lines * (s.spin === 'full' ? 2 : 1)
      if (!best || v > best.v) best = { label: s.label, type: t, v }
    }
  }
  if (best) return `Setup: ${best.label} slot ready for the ${best.type} · ${seq}`
  const awk = p.awkward ? `, leaves ${p.awkward} awkward spot${p.awkward > 1 ? 's' : ''}` : ''
  return `No spin clear with these pieces: cleanest stacking${awk} · ${seq}`
}

/**
 * Explain a plan: replay its steps from the starting board, track every
 * awkward cell (sealed, unreachable, or spin-only) in starting-board coordinates
 * through line clears, and note each step that creates one the plan leaves
 * behind (a spin slot's own cavity is the point of a setup, so not counted).
 */
function annotate(p: Plan, root: Board, sc: PlanScore, remaining: readonly PieceType[]) {
  type Kind = string[] | 'sealed' | 'dead'
  let board = root
  let rows = Array.from({ length: HEIGHT }, (_, i) => i)
  const awkwardNow = (b: Board) => {
    const m = new Map<string, Kind>()
    for (const [i, kind] of classifyPockets(b, undefined, true).awkward ?? []) {
      const x = i % WIDTH
      m.set(`${x},${rows[(i - x) / WIDTH]}`, kind)
    }
    return m
  }
  const before = awkwardNow(board)
  const created: Map<string, Kind>[] = []
  let prev = before
  for (const st of p.steps) {
    const placed = placeOnBoard(board, st.piece)
    const cleared: number[] = []
    for (let y = 0; y < HEIGHT; y++) {
      let full = true
      for (let x = 0; x < WIDTH && full; x++) if (!placed[y * WIDTH + x]) full = false
      if (full) cleared.push(y)
    }
    if (cleared.length) {
      const kept = rows.filter((_, y) => !cleared.includes(y))
      let top = rows[rows.length - 1]
      while (kept.length < rows.length) kept.push(++top)
      rows = kept
    }
    clearLines(placed)
    board = placed
    const now = awkwardNow(board)
    created.push(new Map([...now].filter(([k]) => !prev.has(k))))
    prev = now
  }
  // cells of spin slots on the end stack, in starting-board coordinates
  const slotCells = new Set<string>()
  for (const list of Object.values(sc.features.slots)) for (const s of list) for (const [x, y] of s.cells) slotCells.add(`${x},${rows[y]}`)
  const left = new Map([...prev].filter(([k]) => !before.has(k) && !slotCells.has(k)))
  p.steps.forEach((st, i) => {
    const mine = [...created[i]].filter(([k]) => left.has(k)).map(([, kind]) => kind)
    if (!mine.length) return
    const holes = mine.filter((k) => !Array.isArray(k)).length
    if (holes) st.note = `leaves ${holes === 1 ? 'a hole' : `${holes} holes`} no piece can reach`
    else {
      const who = [...new Set(mine.flat() as string[])].sort()
      st.note = who.length ? `leaves a pocket only ${article(who[0])} ${who.join(' or ')} spin can fill` : 'leaves a pocket only a spin can fill'
    }
  })
  p.awkward = left.size
  p.summary = describe(p, sc, remaining)
}

// --- following a plan --------------------------------------------------------------------

/** A placement still to be made: a piece and the cells it should cover (starting-board coordinates). */
export interface Target {
  type: PieceType
  cells: readonly Cell[]
}

/**
 * Finish a plan in any order: find a sequence that places every target with
 * the pieces available (piece in hand, hold, queue), each at a reachable spot,
 * never breaking B2B. Tries the given order first, so an in-order follower
 * gets the original plan back. Null if no order works.
 */
export function completePlan(req: PlanRequest, targets: readonly Target[], opts: SearchOptions = {}): Plan | null {
  const S = new Search(req, opts)
  const want = targets.map((t) => ({ type: t.type, key: cellSetKey([...t.cells]) }))
  const dfs = (n: Node, left: typeof want): Node | null => {
    if (!left.length) return n
    for (const t of transitions(n, req.queue)) {
      for (let i = 0; i < left.length; i++) {
        if (left[i].type !== t.type) continue
        const c = findPlacements(n.board, t.type, n.counters, t.viaHold, { spinRule: req.spinRule }).find(
          (c) => cellSetKey(c.cells.map(([x, y]): Cell => [x, n.rows[y]])) === left[i].key,
        )
        if (!c || c.result.b2bChange === 'broken') continue
        const done = dfs(S.apply(n, c, t), [...left.slice(0, i), ...left.slice(i + 1)])
        if (done) return done
      }
    }
    return null
  }
  const end = dfs(S.root(), want)
  if (!end) return null
  const sc = S.fullScore(end)
  const p = toPlan(end, sc, end.chain || end.steps.some((s) => isPayoff(s.result)) ? 'chain' : 'setup', true)
  annotate(p, req.board, sc, remainingOf(end, req.queue))
  return p
}
