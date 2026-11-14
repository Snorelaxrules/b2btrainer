/**
 * Glue between the pure engine, input, renderer and React panels.
 * Owns the Session, the InputController and the frame loop; React only mounts
 * it and subscribes to discrete events (never per frame).
 */
import { HANDLING } from '../config/handling'
import type { Action } from '../config/keys'
import { DEFAULT_RULES, type GravityMode, type Rules } from '../config/rules'
import { parseQueue } from '../engine/game'
import { randomSeed } from '../engine/rng'
import { Session } from '../engine/session'
import { InputController } from '../input/controller'
import { bindKeyboard } from '../input/keyboard'
import { type Overlay, Renderer } from '../render/renderer'

export interface TrainerSettings {
  seed: number
  /** R keeps the current seed instead of rolling a new one */
  lockSeed: boolean
  customQueue: string
  gravity: GravityMode
}

const STORAGE_KEY = 'b2btrainer.settings.v1'

function loadSettings(): TrainerSettings {
  const base: TrainerSettings = { seed: randomSeed(), lockSeed: false, customQueue: '', gravity: DEFAULT_RULES.gravity }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as Partial<TrainerSettings>
    return {
      ...base,
      lockSeed: !!saved.lockSeed,
      customQueue: typeof saved.customQueue === 'string' ? saved.customQueue : '',
      gravity: saved.gravity === 'normal' ? 'normal' : 'none',
      seed: saved.lockSeed && typeof saved.seed === 'number' ? saved.seed : base.seed,
    }
  } catch {
    return base
  }
}

export class Trainer {
  settings: TrainerSettings
  readonly session: Session
  readonly input = new InputController(HANDLING)
  overlays: Overlay[] = []
  /** wall-clock start of the current game (first input), for PPS/APM */
  private startedAt: number | null = null
  private endedAt: number | null = null
  private listeners = new Set<() => void>()
  version = 0

  constructor() {
    this.settings = loadSettings()
    this.session = new Session(this.gameOptions())
    this.session.subscribe((e) => {
      if (e === 'over') this.endedAt = performance.now()
      if (e === 'undo' || e === 'redo') this.endedAt = this.session.state.over ? this.endedAt : null
      this.bump()
    })
  }

  get rules(): Rules {
    return { ...DEFAULT_RULES, gravity: this.settings.gravity }
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
    if (patch.gravity) this.session.setRules(this.rules)
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

  private press(action: Action, t: number) {
    if (action === 'restart') return this.restart(!this.settings.lockSeed)
    if (action === 'toggleFinder') return // wired up with the spin finder (step 3)
    if (this.startedAt === null && !this.session.state.over) this.startedAt = t
    this.input.press(action, t, this.session)
  }

  /** Attach to a canvas and its container. Returns cleanup (listeners, loop, observer). */
  mount(canvas: HTMLCanvasElement, container: HTMLElement): () => void {
    const renderer = new Renderer(canvas)
    const fit = () => renderer.resize(container.clientWidth, container.clientHeight)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(container)

    const unbind = bindKeyboard(window, {
      press: (a, t) => this.press(a, t),
      release: (a, t) => this.input.release(a, t),
      undo: () => this.session.undo(),
      redo: () => this.session.redo(),
      blur: () => this.input.reset(),
    })

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
      ro.disconnect()
      this.input.reset()
    }
  }
}
