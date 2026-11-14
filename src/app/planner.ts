/**
 * Lookahead plans for the UI.
 *
 * Two modes:
 *  - searching: no plan committed yet; the worker searches after each placement
 *    and the player can browse plans A/B/C.
 *  - following: the player placed step 1 of the shown plan, so that plan is
 *    LOCKED. Each further matching placement advances it; no new search runs
 *    (so it can't be swapped out mid-setup). It ends when the plan completes,
 *    the player deviates, the plan stops being possible, or they ask for a new one.
 *
 * Planner state is remembered per turn-start GameState, so undo/redo brings the
 * plan back exactly as it was.
 */
import type { SpinRule } from '../config/scoring'
import type { GameState } from '../engine/game'
import { pieceCells } from '../engine/game'
import { type Plan, type PlanRequest, replayPlan } from '../engine/planner'
import type { WorkerIn, WorkerOut } from '../search/planner.worker'

export interface PlannerSettings {
  /** show the plan on the board */
  enabled: boolean
  /** pieces to plan, 1–6 */
  depth: number
  /** beam width */
  beam: number
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
  plans: Plan[]
  selected: number
  following: boolean
}

export class PlannerController {
  settings: PlannerSettings
  plans: Plan[] = []
  selected = 0
  /** locked onto plans[0] */
  following = false
  running = false
  depthDone = 0
  ms = 0
  /** why the last plan ended, shown briefly in the panel */
  note = ''
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
    return this.plans[this.selected] ?? null
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
    }
  }

  private remember(s: GameState) {
    this.cache.set(s, { plans: this.plans, selected: this.selected, following: this.following })
  }

  /** A piece locked: advance a matching plan, otherwise search again. */
  onPlace(before: GameState, after: GameState, spinRule: SpinRule) {
    const plan = this.plan
    const placed = after.last?.piece
    const s1 = plan?.steps[0]
    const matched =
      !!s1 &&
      !!placed &&
      after.stats.pieces === before.stats.pieces + 1 &&
      s1.type === placed.type &&
      cellsKey(s1.cells) === cellsKey(pieceCells(placed))

    if (matched && plan) {
      const rest = plan.steps.slice(1)
      if (!rest.length) {
        this.note = plan.payoffs.length ? `Plan complete: ${plan.steps[plan.payoff]?.result.label ?? ''}` : 'Plan complete'
        return this.search(after, spinRule)
      }
      const req = this.requestFor(after, spinRule)
      const next = req ? replayPlan(req, rest.map((s) => ({ piece: s.piece, viaHold: s.viaHold }))) : null
      if (next) {
        this.cancel()
        this.plans = [next]
        this.selected = 0
        this.following = true
        this.note = ''
        this.remember(after)
        this.bump()
        return
      }
      this.note = 'Plan no longer possible; replanned'
      return this.search(after, spinRule)
    }
    this.note = this.following ? 'Left the plan; replanned' : ''
    this.search(after, spinRule)
  }

  /** The player held: fine if the plan asked for it, otherwise replan. */
  onHold(s: GameState, spinRule: SpinRule) {
    if (this.plan?.steps[0]?.viaHold) {
      this.bump()
      return
    }
    this.note = this.following ? 'Left the plan; replanned' : ''
    this.search(s, spinRule)
  }

  /** Undo / redo: restore the plan that belonged to that position, if any. */
  onRestore(s: GameState, spinRule: SpinRule) {
    const snap = this.cache.get(s)
    if (snap) {
      this.cancel()
      this.plans = snap.plans
      this.selected = snap.selected
      this.following = snap.following
      this.note = ''
      this.bump()
      return
    }
    this.search(s, spinRule)
  }

  /** Drop any locked plan and search from scratch. */
  replan(s: GameState, spinRule: SpinRule) {
    this.note = ''
    this.search(s, spinRule)
  }

  cycle(dir: 1 | -1) {
    if (this.following || this.plans.length < 2) return
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
    if (patch.enabled === false) {
      this.cancel()
      this.bump()
    } else if (patch.enabled || ((patch.depth !== undefined || patch.beam !== undefined) && !this.following)) {
      this.search(s, spinRule)
    } else {
      this.bump()
    }
  }

  /** Fresh search for this state (cancelling any search in flight). */
  search(s: GameState, spinRule: SpinRule) {
    this.cancel()
    this.following = false
    this.plans = []
    this.selected = 0
    this.depthDone = 0
    const req = this.settings.enabled ? this.requestFor(s, spinRule) : null
    this.reqState = s
    if (!req) {
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
        this.bump()
      }
    }
    return this.worker
  }

  private receive(m: WorkerOut) {
    if (m.id !== this.reqId) return
    if (m.kind === 'progress') {
      this.depthDone = m.depthDone
      this.ms = m.ms
      if (m.plans.length) this.plans = m.plans
    } else {
      this.plans = m.plans
      this.ms = m.ms
      this.running = false
      this.depthDone = this.settings.depth
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
