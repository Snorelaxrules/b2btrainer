/**
 * Lookahead plans for the UI: talks to the planner worker, tracks the selected
 * plan, and notices when the player follows it so the plan stays stable.
 */
import type { SpinRule } from '../config/scoring'
import type { GameState } from '../engine/game'
import { pieceCells } from '../engine/game'
import type { FollowStep, Plan, PlanRequest } from '../engine/planner'
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

export class PlannerController {
  settings: PlannerSettings
  plans: Plan[] = []
  selected = 0
  running = false
  depthDone = 0
  ms = 0
  nodes = 0
  /** steps of the plan being followed (after the ones already placed) */
  private follow: FollowStep[] | null = null
  /** the followed plan, kept on top while the rest of the search streams in */
  private pinned: Plan | null = null
  private worker: Worker | null = null
  private reqId = 0
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

  /** The player just locked a piece: did it match step 1 of the shown plan? */
  notePlacement(before: GameState, after: GameState) {
    const plan = this.plan
    const placed = after.last?.piece
    this.follow = null
    if (!plan || !placed || after.stats.pieces !== before.stats.pieces + 1) return
    const s1 = plan.steps[0]
    if (!s1 || s1.type !== placed.type || cellsKey(s1.cells) !== cellsKey(pieceCells(placed))) return
    const rest = plan.steps.slice(1)
    if (rest.length) this.follow = rest.map((s) => ({ piece: s.piece, viaHold: s.viaHold }))
  }

  /** The player held: keep the plan if it asked for a hold, else replan. */
  noteHold(s: GameState, spinRule: SpinRule) {
    if (this.plan?.steps[0]?.viaHold) return // following: step 1 is now the piece in hand
    this.follow = null
    this.request(s, spinRule)
  }

  cycle(dir: 1 | -1) {
    if (!this.plans.length) return
    this.selected = (this.selected + dir + this.plans.length) % this.plans.length
    this.bump()
  }

  select(i: number) {
    if (i === this.selected || !this.plans[i]) return
    this.selected = i
    this.bump()
  }

  setSettings(patch: Partial<PlannerSettings>, s: GameState, spinRule: SpinRule) {
    this.settings = { ...this.settings, ...patch }
    if (patch.depth !== undefined || patch.beam !== undefined || patch.enabled) this.request(s, spinRule)
    else this.bump()
  }

  /** Start a fresh search for this state (cancelling any search in flight). */
  request(s: GameState, spinRule: SpinRule) {
    if (!this.settings.enabled || !s.active || s.over) {
      this.cancel()
      this.plans = []
      this.bump()
      return
    }
    if (this.running) this.cancel()
    const req: PlanRequest = {
      board: s.board,
      counters: s.counters,
      current: s.active.type,
      hold: s.hold,
      holdUsed: s.holdUsed,
      queue: s.queue.slice(0, s.rules.previews),
      depth: this.settings.depth,
      beam: this.settings.beam,
      spinRule,
      follow: this.follow ?? undefined,
    }
    const id = ++this.reqId
    this.running = true
    this.depthDone = 0
    this.pinned = null
    this.plans = []
    this.selected = 0
    this.bump()
    const w = this.ensureWorker()
    w.postMessage({ id, req } satisfies WorkerIn)
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
      this.nodes = m.nodes
      this.ms = m.ms
      if (m.depthDone === 0) this.pinned = m.plans[0] ?? null
      if (this.pinned) this.plans = [this.pinned, ...m.plans.filter((p) => p.summary !== this.pinned?.summary)].slice(0, 3)
      else if (m.plans.length) this.plans = m.plans
    } else {
      this.plans = m.plans
      this.pinned = null
      this.ms = m.ms
      this.running = false
      this.depthDone = this.settings.depth
    }
    if (this.selected >= this.plans.length) this.selected = 0
    this.bump()
  }

  private cancel() {
    if (this.worker && this.running) {
      this.worker.terminate()
      this.worker = null
    }
    this.running = false
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
  }
}
