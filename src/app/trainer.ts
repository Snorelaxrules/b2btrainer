/**
 * Glue between the pure engine, input, renderer and React panels.
 * Owns the Session, the InputController and the frame loop; React only mounts
 * it and subscribes to discrete events (never per frame).
 */
import { HANDLING } from '../config/handling'
import type { Action } from '../config/keys'
import { DEFAULT_RULES, type GravityMode, type Rules } from '../config/rules'
import { SPIN_RULE_LABELS, type SpinRule } from '../config/scoring'
import { type GameState, parseQueue } from '../engine/game'
import { randomSeed } from '../engine/rng'
import { Session } from '../engine/session'
import { InputController } from '../input/controller'
import { bindKeyboard } from '../input/keyboard'
import { type Overlay, Renderer } from '../render/renderer'
import { FinderOverlay } from '../render/finderOverlay'
import { FinderController, type FinderToggles } from './finder'
import { PlanOverlay } from '../render/planOverlay'
import { PlannerController, type PlannerSettings } from './planner'

export interface TrainerSettings {
  seed: number
  /** R keeps the current seed instead of rolling a new one */
  lockSeed: boolean
  customQueue: string
  gravity: GravityMode
  spinRule: SpinRule
  finder: FinderToggles
  planner: PlannerSettings
}

const STORAGE_KEY = 'b2btrainer.settings.v1'

function loadSettings(): TrainerSettings {
  const base: TrainerSettings = {
    seed: randomSeed(),
    lockSeed: false,
    customQueue: '',
    gravity: DEFAULT_RULES.gravity,
    spinRule: DEFAULT_RULES.spinRule,
    finder: { enabled: false, showOther: false, includeHold: false },
    planner: { depth: 5, beam: 100 },
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as Partial<TrainerSettings>
    return {
      ...base,
      lockSeed: !!saved.lockSeed,
      customQueue: typeof saved.customQueue === 'string' ? saved.customQueue : '',
      gravity: saved.gravity === 'normal' ? 'normal' : 'none',
      spinRule: saved.spinRule && saved.spinRule in SPIN_RULE_LABELS ? saved.spinRule : base.spinRule,
      seed: saved.lockSeed && typeof saved.seed === 'number' ? saved.seed : base.seed,
      // the per-piece finder overlay became secondary when the planner arrived: off unless chosen since
      finder: saved.planner && typeof saved.finder === 'object' ? { ...base.finder, ...saved.finder } : base.finder,
      planner: {
        depth: typeof saved.planner?.depth === 'number' ? saved.planner.depth : base.planner.depth,
        beam: typeof saved.planner?.beam === 'number' ? saved.planner.beam : base.planner.beam,
      },
    }
  } catch {
    return base
  }
}

export class Trainer {
  settings: TrainerSettings
  readonly session: Session
  readonly input = new InputController(HANDLING)
  readonly finder: FinderController
  readonly planner: PlannerController
  /** state as of the last session event (to see what a placement did) */
  private seen: GameState
  overlays: Overlay[]
  /** a hold triggered by Shift, undone if Tab follows (Shift+Tab cycles the finder) */
  private shiftHold: { before: GameState; after: GameState } | null = null
  /** wall-clock start of the current game (first input), for PPS/APM */
  private startedAt: number | null = null
  private endedAt: number | null = null
  private listeners = new Set<() => void>()
  version = 0

  constructor() {
    this.settings = loadSettings()
    this.session = new Session(this.gameOptions())
    this.finder = new FinderController(this.settings.finder)
    this.planner = new PlannerController(this.settings.planner)
    this.overlays = [new FinderOverlay(this.finder), new PlanOverlay(this.planner)]
    this.finder.recompute(this.session.state)
    this.seen = this.session.state
    this.session.subscribe((e) => {
      const s = this.session.state
      if (e === 'over') this.endedAt = performance.now()
      if (e === 'undo' || e === 'redo') this.endedAt = s.over ? this.endedAt : null
      this.finder.recompute(s)
      const rule = this.settings.spinRule
      if (e === 'place') this.planner.onPlace(this.seen, s, rule)
      else if (e === 'hold') this.planner.onHold(s, rule)
      else if (e === 'undo' || e === 'redo' || e === 'revert') this.planner.onRestore(s)
      else if (e === 'restart' || e === 'over') this.planner.off('')
      else if (e === 'rules' && this.planner.active) this.planner.search(s, rule)
      this.seen = s
      this.bump()
    })
  }

  /** Drop the current (possibly locked) plan and analyse the position again. */
  replan() {
    this.planner.search(this.session.state, this.settings.spinRule)
  }

  setPlanner(patch: Partial<PlannerSettings>) {
    this.planner.setSettings(patch, this.session.state, this.settings.spinRule)
    this.update({ planner: this.planner.settings })
  }

  setFinder(patch: Partial<FinderToggles>) {
    this.finder.setToggles(patch, this.session.state)
    this.update({ finder: this.finder.toggles })
  }

  get rules(): Rules {
    return { ...DEFAULT_RULES, gravity: this.settings.gravity, spinRule: this.settings.spinRule }
  }

  private gameOptions() {
    return { seed: this.settings.seed, rules: this.rules, customQueue: parseQueue(this.settings.customQueue) }
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

  /** Seconds of play in this game (from the first input until game over). */
  elapsed(now = performance.now()): number {
    if (this.startedAt === null) return 0
    return ((this.endedAt ?? now) - this.startedAt) / 1000
  }

  update(patch: Partial<TrainerSettings>) {
    this.settings = { ...this.settings, ...patch }
    if (patch.gravity || patch.spinRule) this.session.setRules(this.rules)
    if (patch.spinRule) this.finder.recompute(this.session.state, true)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings))
    } catch {
      // storage unavailable (private mode etc.): settings just won't persist
    }
    this.bump()
  }

  /** Restart; `newSeed` rolls a fresh seed (R does this unless the seed is locked). */
  restart(newSeed = false) {
    if (newSeed) this.settings = { ...this.settings, seed: randomSeed() }
    this.update({})
    this.startedAt = this.endedAt = null
    this.input.reset()
    this.session.restart(this.gameOptions())
  }

  private press(action: Action, t: number, code: string) {
    this.shiftHold = null
    if (action === 'restart') return this.restart(!this.settings.lockSeed)
    if (action === 'toggleFinder') return this.setFinder({ enabled: !this.finder.toggles.enabled })
    if (action === 'togglePlan') return this.planner.toggle(this.session.state, this.settings.spinRule)
    if (this.startedAt === null && !this.session.state.over) this.startedAt = t
    const before = this.session.state
    this.input.press(action, t, this.session)
    if (action === 'hold' && code.startsWith('Shift') && this.session.state !== before) {
      this.shiftHold = { before, after: this.session.state }
    }
  }

  private cycle(dir: 1 | -1) {
    // Shift is also the hold key: if this Shift press just held, take the hold back
    const sh = this.shiftHold
    this.shiftHold = null
    if (dir < 0 && sh && this.session.state === sh.after) this.session.revert(sh.before)
    if (this.planner.active && this.planner.plans.length) this.planner.cycle(dir)
    else this.finder.cycle(dir)
  }

  /** Attach to a canvas and its container. Returns cleanup (listeners, loop, observer). */
  mount(canvas: HTMLCanvasElement, container: HTMLElement): () => void {
    const renderer = new Renderer(canvas)
    const fit = () => renderer.resize(container.clientWidth, container.clientHeight)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(container)

    const unbind = bindKeyboard(window, {
      press: (a, t, code) => this.press(a, t, code),
      cycle: (dir) => this.cycle(dir),
      release: (a, t) => this.input.release(a, t),
      undo: () => this.session.undo(),
      redo: () => this.session.redo(),
      blur: () => this.input.reset(),
    })

    const pointer = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      const cell = renderer.view.cellAt(e.clientX - r.left, e.clientY - r.top)
      const c = cell ? this.finder.candidateAt(cell[0], cell[1]) : null
      if (e.type === 'pointerdown') this.finder.select(c ? c.id : null)
      else this.finder.hover(c ? c.id : null)
    }
    const leave = () => this.finder.hover(null)
    canvas.addEventListener('pointermove', pointer)
    canvas.addEventListener('pointerdown', pointer)
    canvas.addEventListener('pointerleave', leave)

    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(now - last, 100)
      last = now
      this.input.update(now, this.session)
      this.session.tick(dt, this.input.gravityFactor())
      renderer.draw(this.session.state, this.overlays)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      unbind()
      this.planner.dispose()
      canvas.removeEventListener('pointermove', pointer)
      canvas.removeEventListener('pointerdown', pointer)
      canvas.removeEventListener('pointerleave', leave)
      ro.disconnect()
      this.input.reset()
    }
  }
}
