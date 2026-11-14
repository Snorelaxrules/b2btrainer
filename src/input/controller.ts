/**
 * DAS / ARR / DCD / SDF from key timestamps (ms on the performance.now() timeline).
 * No DOM: the keyboard binding feeds press/release, and the frame loop calls update().
 * Key auto-repeat (e.repeat) is ignored by the binding; repeat timing lives here.
 */
import { HANDLING, type Handling } from '../config/handling'
import type { Action } from '../config/keys'

/** What the controller drives (Session implements it). */
export interface Controllable {
  readonly pieceId: number
  moveX(dir: -1 | 1): boolean
  slide(dir: -1 | 1): boolean
  slideDown(dir: -1 | 1): boolean
  softDrop(): boolean
  hardDrop(): boolean
  rotate(turn: 1 | -1 | 2): boolean
  hold(): boolean
}

type Dir = -1 | 0 | 1

export class InputController {
  readonly h: Handling
  private left = false
  private right = false
  private soft = false
  /** direction charging / auto-shifting: the most recently pressed one still held */
  private dir: Dir = 0
  private dasStart = 0
  /** auto-repeat moves made since DAS charged (ARR > 0 only) */
  private repeats = 0
  /** auto-shift paused until this time (DCD) */
  private cutUntil = -Infinity
  private seenPiece = -1

  constructor(handling: Partial<Handling> = {}) {
    this.h = { ...HANDLING, ...handling }
  }

  get softHeld() {
    return this.soft
  }

  /** Gravity multiplier for tick() (finite soft drop factors only). */
  gravityFactor() {
    return this.soft && Number.isFinite(this.h.sdf) ? this.h.sdf : 1
  }

  press(action: Action, t: number, game: Controllable) {
    switch (action) {
      case 'moveLeft':
      case 'moveRight': {
        const d = action === 'moveLeft' ? -1 : 1
        if (d === -1) this.left = true
        else this.right = true
        // newest direction wins; a fresh press taps once and starts charging
        this.dir = d
        this.dasStart = t
        this.repeats = 0
        game.moveX(d)
        break
      }
      case 'softDrop':
        this.soft = true
        break
      case 'hardDrop':
        game.hardDrop()
        break
      case 'rotateCW':
        game.rotate(1)
        this.cut(t)
        break
      case 'rotateCCW':
        game.rotate(-1)
        this.cut(t)
        break
      case 'rotate180':
        game.rotate(2)
        this.cut(t)
        break
      case 'hold':
        game.hold()
        break
      default:
        return
    }
    this.update(t, game)
  }

  release(action: Action, t: number) {
    if (action === 'softDrop') {
      this.soft = false
      return
    }
    if (action !== 'moveLeft' && action !== 'moveRight') return
    const d = action === 'moveLeft' ? -1 : 1
    if (d === -1) this.left = false
    else this.right = false
    if (this.dir !== d) return
    // fall back to the other direction if it's still held; it charges afresh
    const other = d === -1 ? this.right : this.left
    this.dir = other ? (-d as Dir) : 0
    this.dasStart = t
    this.repeats = 0
  }

  /** Apply auto-shift and soft drop at time `now`. Safe to call any number of times per frame. */
  update(now: number, game: Controllable) {
    if (game.pieceId !== this.seenPiece) {
      if (this.seenPiece !== -1) {
        this.cut(now)
        if (!this.h.carryDas && this.dir !== 0) {
          this.dasStart = now
          this.repeats = 0
        }
      }
      this.seenPiece = game.pieceId
    }
    const dropping = this.soft && !Number.isFinite(this.h.sdf)
    if (dropping) game.softDrop()
    if (this.dir !== 0 && now >= this.cutUntil) {
      const charged = now - this.dasStart - this.h.das
      if (charged >= 0) {
        if (this.h.arr <= 0) {
          if (dropping) game.slideDown(this.dir)
          else game.slide(this.dir)
        } else {
          const due = 1 + Math.floor(charged / this.h.arr)
          for (; this.repeats < due; this.repeats++) {
            game.moveX(this.dir)
            if (dropping) game.softDrop()
          }
        }
      }
    }
    if (dropping) game.softDrop()
  }

  /** Forget held keys (window blur, restart). */
  reset() {
    this.left = this.right = this.soft = false
    this.dir = 0
    this.repeats = 0
    this.cutUntil = -Infinity
    this.seenPiece = -1
  }

  private cut(t: number) {
    if (this.h.dcd > 0) this.cutUntil = t + this.h.dcd
  }
}
