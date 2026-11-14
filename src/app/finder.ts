/**
 * Spin-finder state for the UI: candidate lists, selection, hover, toggles.
 * Recomputed on discrete game events (spawn, hold, undo, …), never per frame.
 */
import { type Candidate, findPlacements } from '../engine/finder'
import type { GameState } from '../engine/game'

export interface FinderToggles {
  enabled: boolean
  /** show grey "other" placements */
  showOther: boolean
  /** also list placements for the hold piece ("what if I hold?") */
  includeHold: boolean
}

export class FinderController {
  toggles: FinderToggles
  current: Candidate[] = []
  hold: Candidate[] = []
  /** the state the lists were computed for */
  source: GameState | null = null
  selectedId: string | null = null
  hoverId: string | null = null
  /** ms the last computation took */
  lastMs = 0
  version = 0
  private listeners = new Set<() => void>()

  constructor(toggles: FinderToggles) {
    this.toggles = toggles
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

  setToggles(patch: Partial<FinderToggles>, s: GameState) {
    this.toggles = { ...this.toggles, ...patch }
    this.recompute(s, true)
  }

  /** Recompute for a state (cheap no-op if the board/piece/counters are unchanged). */
  recompute(s: GameState, force = false) {
    const prev = this.source
    const same =
      prev &&
      prev.board === s.board &&
      prev.active?.type === s.active?.type &&
      prev.hold === s.hold &&
      prev.holdUsed === s.holdUsed &&
      prev.queue[0] === s.queue[0] &&
      prev.counters === s.counters &&
      prev.rules.spinRule === s.rules.spinRule
    this.source = s
    if (same && !force) return
    if (!same) this.selectedId = null
    this.hoverId = null
    const t0 = performance.now()
    if (!this.toggles.enabled || !s.active || s.over) {
      this.current = []
      this.hold = []
    } else {
      const opts = { spinRule: s.rules.spinRule, slots: true }
      this.current = findPlacements(s.board, s.active.type, s.counters, false, opts)
      const holdType = s.holdUsed ? null : (s.hold ?? s.queue[0])
      this.hold =
        this.toggles.includeHold && holdType && holdType !== s.active.type
          ? findPlacements(s.board, holdType, s.counters, true, opts)
          : []
    }
    this.lastMs = performance.now() - t0
    this.bump()
  }

  /** Candidates shown on the board, in cycling order. */
  visible(): Candidate[] {
    const all = [...this.current, ...this.hold]
    return this.toggles.showOther ? all : all.filter((c) => c.category !== 'other')
  }

  /** What the readout and preview show: hover wins over selection. */
  displayed(): Candidate | null {
    const id = this.hoverId ?? this.selectedId
    if (!id) return null
    return this.visible().find((c) => c.id === id) ?? null
  }

  select(id: string | null) {
    if (id === this.selectedId) return
    this.selectedId = id
    this.bump()
  }

  hover(id: string | null) {
    if (id === this.hoverId) return
    this.hoverId = id
    this.bump()
  }

  /** Tab / Shift+Tab */
  cycle(dir: 1 | -1) {
    const list = this.visible()
    if (!list.length) return
    const i = list.findIndex((c) => c.id === this.selectedId)
    const next = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length
    this.hoverId = null
    this.select(list[next].id)
    this.bump()
  }

  /** Candidate covering board cell (x, y), preferring the current selection, then list order. */
  candidateAt(x: number, y: number): Candidate | null {
    const list = this.visible()
    const hit = (c: Candidate) => c.cells.some(([cx, cy]) => cx === x && cy === y)
    const sel = list.find((c) => c.id === this.selectedId)
    if (sel && hit(sel)) return sel
    return list.find(hit) ?? null
  }
}
