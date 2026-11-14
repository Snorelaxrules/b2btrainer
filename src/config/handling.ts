/**
 * Handling (TETR.IO-style), in milliseconds of real time (performance.now),
 * never frames, so it behaves the same at any refresh rate.
 * Edit the defaults here; the UI does not change them yet.
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
