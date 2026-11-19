/**
 * On-demand spin planner for the UI.
 *
 * The game plays normally until the player presses P. Then the planner analyses
 * the current position (worker) and shows up to three plans. Committing to a
 * plan (placing its step 1, or holding when its step 1 says hold) LOCKS it:
 * each matching placement advances it without any new search. The planner
 * switches itself off when the plan completes, when the player leaves it, or
 * when it stops being possible; P switches it off at any time.
 *
 * Every plan shown is verified: worker results are replayed through the real
 * engine before they are posted, and locked plans are re-verified against the
 * live game state after every step.
 *
 * Planner state is remembered per turn-start GameState so undo/redo restores it.
 */
import type { SpinRule } from '../config/scoring'
import { type GameState, pieceCells } from '../engine/game'
import { type Plan, type PlanRequest, type Target, completePlan } from '../engine/planner'
import { type Board, type Cell, HEIGHT, WIDTH } from '../engine/game'
import { verifyPlan } from '../engine/verify'
import type { WorkerIn, WorkerOut } from '../search/planner.worker'

export interface PlannerSettings {
  /** most pieces a plan may use, 1–6 */
  depth: number
  /** search time budget in ms */
  budgetMs: number
}

export const BUDGET_PRESETS = [
  { label: 'Quick', ms: 200 },
  { label: 'Normal', ms: 600 },
  { label: 'Deep', ms: 2000 },
]

const cellsKey = (cells: readonly (readonly [number, number])[]) =>
  cells
    .map(([x, y]) => y * 16 + x)
    .sort((a, b) => a - b)
    .join(',')

interface Snapshot {
  active: boolean
  plans: Plan[]
  selected: number
  following: boolean
}

export class PlannerController {
  settings: PlannerSettings
  /** P is on: plans are shown for this position */
  active = false
  plans: Plan[] = []
  selected = 0
  /** committed to plans[0] */
  following = false
  running = false
  /** search passes finished (each wider than the last) */
  pass = 0
  ms = 0
  /** why the planner last switched off or replanned, shown in the panel */
  note = ''
  /** plans rejected by engine verification this session (dev diagnostics) */
  discardedTotal = 0
  private discardedThisSearch = 0
  private worker: Worker | null = null
  private reqId = 0
  private reqState: GameState | null = null
  private cache = new WeakMap<GameState, Snapshot>()
  version = 0
  private listeners = new Set<() => void>()

  constructor(settings: PlannerSettings) {
    this.settings = settings
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  getVersion = () => this.version
  private bump() {
    this.version++
    for (const fn of this.listeners) fn()
  }

  get plan(): Plan | null {
    return this.active ? (this.plans[this.selected] ?? null) : null
  }

  private requestFor(s: GameState, spinRule: SpinRule): PlanRequest | null {
    if (!s.active || s.over) return null
    return {
      board: s.board,
      counters: s.counters,
      current: s.active.type,
      hold: s.hold,
      holdUsed: s.holdUsed,
      queue: s.queue.slice(0, s.rules.previews),
      depth: this.settings.depth,
      budgetMs: this.settings.budgetMs,
      spinRule,
    }
  }

  private remember(s: GameState) {
    this.cache.set(s, { active: this.active, plans: this.plans, selected: this.selected, following: this.following })
  }

  /** P: analyse the current position, or switch off. */
  toggle(s: GameState, spinRule: SpinRule) {
    if (this.active) this.off('')
    else this.search(s, spinRule)
  }

  off(note: string) {
    this.cancel()
    this.active = false
    this.following = false
    this.plans = []
    this.selected = 0
    this.note = note
    this.bump()
  }

  /**
   * Lock onto a setup: finish `targets` (piece + cells, in the coordinates of
   * `s`) in whatever order the remaining pieces allow, verified on the live
   * state. Returns false if no order works any more.
   */
  private lock(s: GameState, spinRule: SpinRule, targets: Target[]): boolean {
    const req = this.requestFor(s, spinRule)
    if (!req) return false
    const next = completePlan(req, targets)
    if (!next || !verifyPlan(s, next).ok) {
      if (next) this.discardedTotal++
      return false
    }
    this.cancel()
    this.plans = [next]
    this.selected = 0
    this.following = true
    this.note = ''
    this.remember(s)
    this.bump()
    return true
  }

  /** Shown plans to match a move against: the locked one, else the selected one first. */
  private candidatePlans(): Plan[] {
    if (this.following) return this.plans.slice(0, 1)
    const sel = this.plans[this.selected]
    return sel ? [sel, ...this.plans.filter((p) => p !== sel)] : this.plans
  }

  /**
   * A piece locked. If it went exactly where ANY step of a shown plan puts that
   * piece (in order or not), keep the setup: the remaining steps are re-ordered
   * to fit the pieces left. Otherwise the player has left the plan.
   */
  onPlace(before: GameState, after: GameState, spinRule: SpinRule) {
    if (!this.active) return
    const placed = after.last?.piece
    if (!placed || after.stats.pieces !== before.stats.pieces + 1) return
    const cells = pieceCells(placed)
    const key = cellsKey(cells)
    for (const plan of this.candidatePlans()) {
      const i = plan.steps.findIndex((st) => st.type === placed.type && cellsKey(st.cells) === key)
      if (i < 0) continue
      const rest = remapAfterClear(
        before.board,
        cells,
        plan.steps.filter((_, j) => j !== i).map((st) => ({ type: st.type, cells: st.cells })),
      )
      if (rest && !rest.length) {
        const pays = plan.payoffs.map((j) => plan.steps[j].result)
        this.off(
          pays.length
            ? `Plan complete: ${pays.map((r) => `${r.label} +${r.attack}`).join(' → ')}. Press P for the next one.`
            : 'Setup complete. Press P for the next step.',
        )
        return
      }
      if (rest && this.lock(after, spinRule, rest)) return
      this.off("The pieces left can't finish this setup any more. Press P to replan.")
      return
    }
    this.off(this.following ? 'Left the plan. Press P for a new one.' : '')
  }

  /** The player held: keep the setup if the remaining pieces can still finish it. */
  onHold(s: GameState, spinRule: SpinRule) {
    if (!this.active) return
    for (const plan of this.candidatePlans()) {
      if (this.lock(s, spinRule, plan.steps.map((st) => ({ type: st.type, cells: st.cells })))) return
    }
    this.off(this.following ? "The pieces left can't finish this setup. Press P to replan." : '')
  }

  /** Undo / redo / Shift+Tab: restore the planner as it was at that position. */
  onRestore(s: GameState) {
    const snap = this.cache.get(s)
    this.cancel()
    if (snap) {
      this.active = snap.active
      this.plans = snap.plans
      this.selected = snap.selected
      this.following = snap.following
    } else {
      this.active = false
      this.following = false
      this.plans = []
    }
    this.note = ''
    this.bump()
  }

  cycle(dir: 1 | -1) {
    if (!this.active || this.following || this.plans.length < 2) return
    this.selected = (this.selected + dir + this.plans.length) % this.plans.length
    if (this.reqState && !this.running) this.remember(this.reqState)
    this.bump()
  }

  select(i: number) {
    if (this.following || i === this.selected || !this.plans[i]) return
    this.selected = i
    if (this.reqState && !this.running) this.remember(this.reqState)
    this.bump()
  }

  setSettings(patch: Partial<PlannerSettings>, s: GameState, spinRule: SpinRule) {
    this.settings = { ...this.settings, ...patch }
    if (this.active && !this.following) this.search(s, spinRule)
    else this.bump()
  }

  /** Analyse `s` (cancelling any search in flight). */
  search(s: GameState, spinRule: SpinRule) {
    this.cancel()
    this.active = true
    this.following = false
    this.plans = []
    this.selected = 0
    this.pass = 0
    this.discardedThisSearch = 0
    this.note = ''
    const req = this.requestFor(s, spinRule)
    this.reqState = s
    if (!req) {
      this.note = 'Nothing to plan (game over).'
      this.bump()
      return
    }
    const id = ++this.reqId
    this.running = true
    this.bump()
    this.ensureWorker().postMessage({ id, req } satisfies WorkerIn)
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../search/planner.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<WorkerOut>) => this.receive(e.data)
      this.worker.onerror = (e) => {
        e.preventDefault()
        this.running = false
        this.note = 'Planner crashed; press P to retry.'
        this.bump()
      }
    }
    return this.worker
  }

  private receive(m: WorkerOut) {
    if (m.id !== this.reqId) return
    this.discardedTotal += m.discarded - this.discardedThisSearch
    this.discardedThisSearch = m.discarded
    if (m.kind === 'progress') {
      this.pass = m.pass
      this.ms = m.ms
      if (m.plans.length) this.plans = m.plans
    } else {
      this.plans = m.plans
      this.ms = m.ms
      this.running = false
      if (!m.plans.length) this.note = 'No playable plan found from here.'
      if (this.reqState) this.remember(this.reqState)
    }
    if (this.selected >= this.plans.length) this.selected = 0
    this.bump()
  }

  private cancel() {
    if (this.worker && this.running) {
      this.worker.terminate()
      this.worker = null
    }
    this.reqId++
    this.running = false
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    this.running = false
  }
}

/**
 * Targets after a lock of `cells` on `board`: rows that lock clears are gone,
 * cells above them move down. Null if a target needed a row that was cleared.
 */
export function remapAfterClear(board: Board, cells: readonly Cell[], targets: Target[]): Target[] | null {
  const filled = (x: number, y: number) => board[y * WIDTH + x] !== 0 || cells.some(([cx, cy]) => cx === x && cy === y)
  const cleared: number[] = []
  for (let y = 0; y < HEIGHT; y++) {
    let full = true
    for (let x = 0; x < WIDTH && full; x++) if (!filled(x, y)) full = false
    if (full) cleared.push(y)
  }
  if (!cleared.length) return targets
  const out: Target[] = []
  for (const t of targets) {
    if (t.cells.some(([, y]) => cleared.includes(y))) return null
    out.push({ type: t.type, cells: t.cells.map(([x, y]): Cell => [x, y - cleared.filter((r) => r < y).length]) })
  }
  return out
}

