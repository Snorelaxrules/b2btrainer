/**
 * Plan score — every feature weight and threshold the planner uses, in one place.
 *
 * A plan is scored once, on its END state (the stack after its last clear) plus
 * its totals. Score = sum of the terms below; positive terms reward, negative
 * ones penalise. `npm run plan -- <position.json>` prints each plan's per-term
 * breakdown so these can be tuned without the UI.
 */
export interface PlanScoreConfig {
  // --- totals over the plan ------------------------------------------------------------
  /** per line of attack sent (spin clears, B2B bonus, combo, surge) */
  attack: number
  /** per spin clear in the chain (spins that keep B2B under the active rule) */
  chainLink: number
  /** a mini spin counts as this fraction of a link (it keeps B2B but sends little) */
  chainMiniFactor: number
  /** extra per link after the first (link weights: full 1, mini `chainMiniFactor`): two spins in a row beat one */
  chainBonus: number
  /** extra per FULL spin (a real T-spin, or any spin under all-spin): minis only keep B2B alive */
  fullSpin: number
  /** per piece placed: tempo. Kept small so it never outweighs stack quality */
  piecesUsed: number
  /** per hold the plan uses: each costs the player tempo and flexibility */
  holdUsed: number
  /** per B2B break (search prunes these; kept so re-scored plans show it) */
  b2bBreak: number

  // --- end stack: cleanliness -----------------------------------------------------------
  /** per empty cell no piece can ever reach (sealed off, or open but unreachable) */
  sealed: number
  /** per row holding such a cell: digging it out later is a non-spin clear, so it costs B2B */
  unsafeDig: number
  /** per covered empty cell that is not part of any spin slot (an accidental overhang) */
  overhang: number
  /** sum of |height steps| between neighbouring columns, ignoring columns a spin slot uses */
  bumpiness: number
  /** sum of squared height steps (towers and cliffs), same columns ignored */
  bumpSquared: number

  // --- end stack: flexibility -----------------------------------------------------------
  /** per piece type (of 7) with NO clean placement (one that covers no empty cell, under the height limit) */
  noCleanSpot: number
  /** per cell a 1-wide well is deeper than `iWellDepth` (only an I fills it cleanly) */
  iWell: number
  iWellDepth: number
  /**
   * per row whose only gap is one open cell in a 1-wide column: it can only be cleared
   * by filling that column straight down, never a spin, so it costs B2B unless an I
   * gets a quad out of it (I-dependency)
   */
  iRow: number
  /** the I is the only piece with a clean placement */
  iOnly: number

  // --- end stack: what comes next ---------------------------------------------------------
  /** per slot line for a piece we know is coming (in hold or the queue left after the plan) */
  slotKnown: number
  /** per slot line for a piece not yet seen */
  slotUnseen: number
  /** a mini slot counts this fraction of a full one */
  slotMiniFactor: number

  // --- T resource ----------------------------------------------------------------------
  /** a T kept in hold or within the next `tLookahead` known pieces after the plan */
  tKept: number
  tLookahead: number
  /** per T the plan places without a spin clear */
  tWasted: number

  // --- safety --------------------------------------------------------------------------
  /** rows of stack allowed before the danger penalty starts */
  safetyMargin: number
  /** per row of max height above `safetyMargin` */
  danger: number
  /** hard limit: the search prunes any state taller than this */
  heightLimit: number
}

/**
 * Tuned 2026-11-23 against 5han's Tetra League play (npm run tune: two matches,
 * searches of 16 then 48 wide ≈ the app's 200 ms). Held-out match at 200 ms:
 * top-3 agreement 50.3% → 57.7%. Notable: no I-dependency penalty (strong players
 * keep and use quad wells), minis worth ¼ of a full spin, overhangs penalised harder.
 */
export const PLAN_SCORE: PlanScoreConfig = {
  attack: 0.8,
  chainLink: 7.7,
  chainMiniFactor: 0.25,
  chainBonus: 0,
  fullSpin: 16.4,
  piecesUsed: 2.4,
  holdUsed: 0,
  b2bBreak: 40,

  sealed: 17.6,
  unsafeDig: 5,
  overhang: 4.8,
  bumpiness: 0.09,
  bumpSquared: 0.04,

  noCleanSpot: 2,
  iWell: 0,
  iWellDepth: 2,
  iRow: 0,
  iOnly: 8,

  slotKnown: 1.5,
  slotUnseen: 1,
  slotMiniFactor: 0.5,

  tKept: 3,
  tLookahead: 3,
  tWasted: 2.5,

  safetyMargin: 12,
  danger: 2,
  heightLimit: 18,
}

/** Search settings (defaults; the UI overrides depth and budget). */
export interface PlanSearchConfig {
  /** wall-clock budget per search in ms; the best plans found by then are returned */
  budgetMs: number
  /** most spin clears one plan may chain */
  maxChain: number
  /** beam width of the first pass; each later pass triples it (iterative widening) */
  beamStart: number
  /** stop widening past this */
  beamMax: number
  /**
   * Partial plans are ranked by what they achieved plus the spin slots their
   * stack offers the pieces still coming, minus this fraction of the end-stack
   * penalties as a light tie-breaker (the full penalties apply only at the end).
   */
  partialStack: number
  /** plans fully scored per pass, per plan shown */
  finalists: number
}

export const PLAN_SEARCH: PlanSearchConfig = {
  budgetMs: 200,
  maxChain: 3,
  beamStart: 16,
  beamMax: 432,
  partialStack: 0.3,
  finalists: 4,
}
