/**
 * Handling (TETR.IO-style), in milliseconds of real time (performance.now),
 * never frames, so it behaves the same at any refresh rate. The Handling panel
 * shows them in 60 fps frames like TETR.IO's settings; these are the defaults.
 */
export interface Handling {
  /** Delayed Auto Shift: hold time before auto-repeat starts. 4.5 frames @ 60 fps = 75 ms. */
  das: number
  /** Auto Repeat Rate: ms between auto-repeat moves once DAS has charged. 0 = straight to the wall. */
  arr: number
  /** DAS Cut Delay: pause auto-shift for this long after a rotate, hold or new piece. 0 = never cut. */
  dcd: number
  /** Soft Drop Factor: gravity multiplier while soft dropping. Infinity = straight to the floor, no lock. */
  sdf: number
  /** keep a held direction's DAS charge when a new piece spawns (TETR.IO does) */
  carryDas: boolean
}

export const HANDLING: Handling = {
  das: 75,
  arr: 0,
  dcd: 0,
  sdf: Infinity,
  carryDas: true,
}

export const FRAME_MS = 1000 / 60
export const toFrames = (ms: number) => Math.round((ms / FRAME_MS) * 10) / 10
export const fromFrames = (f: number) => f * FRAME_MS

/** slider ranges, matching TETR.IO's handling menu */
export const HANDLING_LIMITS = {
  das: { min: 1, max: 20, step: 0.1 },
  arr: { min: 0, max: 5, step: 0.1 },
  dcd: { min: 0, max: 20, step: 0.1 },
  sdf: { min: 5, max: 40, step: 1 },
}

/** soft drop speed (cells/s) multiplied by SDF when gravity is off: TETR.IO's base 0.02 G */
export const SOFT_DROP_BASE = 1.2
