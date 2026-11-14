/**
 * A playing session: the current immutable GameState plus unlimited undo/redo.
 *
 * Undo granularity is one placed piece. Each placement pushes the state the
 * turn *started* from (the piece freshly spawned, before any hold), so undo
 * restores the board, current piece, queue, hold + used flag, bag/RNG state,
 * and every counter exactly as they were. Placing after an undo drops the redo stack.
 *
 * Mutable wrapper, immutable contents: states on the stacks are never modified.
 */
import * as G from './game'
import type { GameState, NewGameOptions } from './game'
import type { Rules } from '../config/rules'

export type SessionEvent = 'place' | 'hold' | 'undo' | 'redo' | 'restart' | 'over' | 'rules'

export class Session {
  state: GameState
  private turnStart: GameState
  private undoStack: GameState[] = []
  private redoStack: GameState[] = []
  private listeners = new Set<(e: SessionEvent) => void>()
  /** bumps on every discrete event (not on piece movement); handy for React subscriptions */
  version = 0

  constructor(opts: NewGameOptions) {
    this.state = G.newGame(opts)
    this.turnStart = this.state
  }

  get pieceId() {
    return this.state.pieceId
  }
  get canUndo() {
    return this.undoStack.length > 0
  }
  get canRedo() {
    return this.redoStack.length > 0
  }
  get undoDepth() {
    return this.undoStack.length
  }

  subscribe(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(e: SessionEvent) {
    this.version++
    for (const fn of this.listeners) fn(e)
  }

  /** Commit a state produced by an engine action. */
  apply(next: GameState): boolean {
    const prev = this.state
    if (next === prev) return false
    this.state = next
    if (next.stats.pieces !== prev.stats.pieces) {
      this.undoStack.push(this.turnStart)
      this.redoStack.length = 0
      this.turnStart = next
      this.emit('place')
    } else if (next.pieceId !== prev.pieceId) {
      this.emit('hold')
    }
    if (next.over && !prev.over) this.emit('over')
    return true
  }

  /**
   * Change rules (e.g. gravity) mid-game. Rules are a setting, not game history:
   * states restored by undo/redo get the current rules too.
   */
  setRules(rules: Rules) {
    this.state = { ...this.state, rules }
    this.turnStart = { ...this.turnStart, rules }
    this.emit('rules')
  }

  private withRules(s: GameState): GameState {
    return s.rules === this.state.rules ? s : { ...s, rules: this.state.rules }
  }

  undo(): boolean {
    const s = this.undoStack.pop()
    if (!s) return false
    this.redoStack.push(this.turnStart)
    this.state = this.turnStart = this.withRules(s)
    this.emit('undo')
    return true
  }

  redo(): boolean {
    const s = this.redoStack.pop()
    if (!s) return false
    this.undoStack.push(this.turnStart)
    this.state = this.turnStart = this.withRules(s)
    this.emit('redo')
    return true
  }

  /** Replace the current state without touching history (only for un-doing a hold within a turn). */
  revert(state: GameState) {
    this.state = state
    this.emit('hold')
  }

  /** Start from an arbitrary state (puzzles, tests); clears history. */
  load(state: GameState) {
    this.state = this.turnStart = state
    this.undoStack = []
    this.redoStack = []
    this.emit('restart')
  }

  restart(opts: NewGameOptions) {
    this.state = this.turnStart = G.newGame(opts)
    this.undoStack = []
    this.redoStack = []
    this.emit('restart')
  }

  // --- actions (the input controller drives these) ---------------------------------
  moveX(dir: -1 | 1) {
    return this.apply(G.moveX(this.state, dir))
  }
  slide(dir: -1 | 1) {
    return this.apply(G.slide(this.state, dir))
  }
  slideDown(dir: -1 | 1) {
    return this.apply(G.slideDown(this.state, dir))
  }
  softDrop() {
    return this.apply(G.softDrop(this.state))
  }
  hardDrop() {
    return this.apply(G.hardDrop(this.state))
  }
  rotate(turn: 1 | -1 | 2) {
    return this.apply(G.rotate(this.state, turn))
  }
  hold() {
    return this.apply(G.hold(this.state))
  }
  tick(dt: number, softFactor = 1) {
    return this.apply(G.tick(this.state, dt, softFactor))
  }
}
