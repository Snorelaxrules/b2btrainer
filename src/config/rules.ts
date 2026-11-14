/**
 * Game rules that are not scoring (scoring lives in src/config/scoring.ts).
 */
import { DEFAULT_SPIN_RULE, type SpinRule } from './scoring'

export type GravityMode = 'none' | 'normal'

export interface Rules {
  /**
   * 'none' (default, for training): no gravity and no lock delay; a piece locks
   * only on hard drop. 'normal': gravity plus lock delay with move resets.
   */
  gravity: GravityMode
  /** cells per second when gravity is 'normal' (TETR.IO's default 0.02 G ≈ 1.2 cells/s) */
  gravitySpeed: number
  /** ms a grounded piece waits before locking ('normal' only) */
  lockDelay: number
  /** moves/rotations that may reset the lock timer, per piece ('normal' only) */
  maxLockResets: number
  /** pieces shown in the next queue */
  previews: number
  /** which spins count (see src/config/scoring.ts) */
  spinRule: SpinRule
}

export const DEFAULT_RULES: Rules = {
  gravity: 'none',
  gravitySpeed: 1.2,
  lockDelay: 500,
  maxLockResets: 15,
  previews: 5,
  spinRule: DEFAULT_SPIN_RULE,
}
