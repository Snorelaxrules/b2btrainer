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
import { type MiniSpinMode, type Plan, type PlanRequest, replayPlan } from '../engine/planner'
import { verifyPlan } from '../engine/verify'
import type { WorkerIn, WorkerOut } from '../search/planner.worker'

export interface PlannerSettings {
  /** pieces to plan, 1–6 */
  depth: number
  /** beam width */
  beam: number
  /** "stuck piece" mini spins: off / only into overhangs already on the board / any */
  miniSpins: MiniSpinMode
}

export const BEAM_PRESETS = [
  { label: 'Fast', beam: 40 },
  { label: 'Normal', beam: 100 },
  { label: 'Deep', beam: 250 },
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
  depthDone = 0
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
      beam: this.settings.beam,
      spinRule,
      miniSpins: this.settings.miniSpins,
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
   * Lock onto `plan` with its remaining `steps`, re-scored and verified on the
   * live state `s`. Returns false if the rest is no longer playable.
   */
  private lock(s: GameState, spinRule: SpinRule, steps: Plan['steps'], firstViaHold?: boolean): boolean {
    const req = this.requestFor(s, spinRule)
    if (!req) return false
    const follow = steps.map((st, i) => ({ piece: st.piece, viaHold: i === 0 && firstViaHold !== undefined ? firstViaHold : st.viaHold }))
    const next = replayPlan(req, follow)
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

  /** A piece locked. */
  onPlace(before: GameState, after: GameState, spinRule: SpinRule) {
    if (!this.active) return
    const placed = after.last?.piece
    const fresh = after.stats.pieces === before.stats.pieces + 1
    // which shown plan (if any) did the player just play step 1 of?
    const candidates = this.following ? this.plans.slice(0, 1) : this.plans
    const hit =
      fresh && placed
        ? candidates.find((p) => p.steps[0]?.type === placed.type && cellsKey(p.steps[0].cells) === cellsKey(pieceCells(placed)))
        : undefined
    if (!hit) {
      this.off(this.following ? 'Left the plan. Press P for a new one.' : '')
      return
    }
    const rest = hit.steps.slice(1)
    if (!rest.length) {
      const pay = hit.steps[hit.payoff]
      this.off(pay ? `Plan complete: ${pay.result.label} +${pay.result.attack}. Press P for the next one.` : 'Plan complete.')
      return
    }
    if (!this.lock(after, spinRule, rest)) this.off('The rest of the plan is no longer possible. Press P to replan.')
  }

  /** The player held. Committing to a plan whose step 1 is a hold locks it; otherwise this leaves the plan. */
  onHold(s: GameState, spinRule: SpinRule) {
    if (!this.active) return
    const candidates = this.following ? this.plans.slice(0, 1) : this.plans
    const idx = candidates.findIndex((p) => p.steps[0]?.viaHold && p.steps[0].type === s.active?.type)
    if (idx < 0) {
      this.off(this.following ? 'Left the plan. Press P for a new one.' : '')
      return
    }
    // the held piece is now in hand: step 1 no longer needs (or allows) a hold key
    if (!this.lock(s, spinRule, candidates[idx].steps, false)) this.off('The plan is no longer possible. Press P to replan.')
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
    this.depthDone = 0
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
      this.depthDone = m.depthDone
      this.ms = m.ms
      if (m.plans.length) this.plans = m.plans
    } else {
      this.plans = m.plans
      this.ms = m.ms
      this.running = false
      this.depthDone = this.settings.depth
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
