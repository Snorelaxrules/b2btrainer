/**
 * Scoring rules — the single source of truth for spins, back-to-back and attack.
 * Edit numbers here; the engine, spin finder, lookahead and coach all read this file.
 *
 * Sources (checked Nov 2026):
 *  - tetrio.wiki.gg "Mechanics"  https://tetrio.wiki.gg/wiki/Mechanics
 *      B2B Charging + Surge (start at B2B 4, starting power 4 outside Quick Play, +1 per level,
 *      released in 3 segments when the streak breaks), combo formula base*(1+0.25x) and
 *      ln(1+1.25x) for zero-attack clears at combo ≥ 2, DOWN rounding outside Quick Play,
 *      All-Mini (Beta 1.0.0, 2024-07-26) and All-Mini+ (Beta 1.5.0, 2025-01-18, default for all
 *      multiplayer modes), "All Clear adds 2 B2B regardless of clear type".
 *  - tetrio.wiki.gg "Spins"      https://tetrio.wiki.gg/wiki/Spins
 *      T: last move a rotation + 3 of 4 corners (walls count); full if both facing corners are
 *      filled, otherwise Mini unless the 5th kick test was used. Immobile = can't move up/left/right.
 *  - tetrio.wiki.gg "TETRA LEAGUE" https://tetrio.wiki.gg/wiki/TETRA_LEAGUE
 *      Season 2: All Clear reduced from 10 to 5 lines ("now worth 1 B2B": conflicts with Mechanics).
 *  - tetris.wiki "TETR.IO" and "TETR.IO/Quick_Play" (same B2B/Surge/combo text; Quick Play AC = 3 lines, +2 B2B).
 *  - Per-clear base values (ATTACK below) are TETR.IO's garbage constants as reproduced by
 *    community engine re-implementations; no official page lists them. They have been stable
 *    since Season 1.
 *
 * Unsure / not officially documented — see README "Scoring: open questions".
 */

/** How spins are recognised. Tetra League uses ALL-MINI+ (TETR.IO's multiplayer default since Beta 1.5.0). */
export type SpinRule =
  /** T-spins only (3-corner rule, mini detection). Other pieces never spin. */
  | 'tspin'
  /** All-Mini+: T by 3-corner rule, and ANY piece (T included) that is immobile after a rotation scores a Mini. */
  | 'allmini+'
  /** All-spin: T by 3-corner rule; other immobile pieces score FULL spins (T-spin attack values). */
  | 'allspin'

export const SPIN_RULE_LABELS: Record<SpinRule, string> = {
  tspin: 'T-spins only',
  'allmini+': 'All-Mini+ (Tetra League)',
  allspin: 'All-spin (non-T = full)',
}

export const DEFAULT_SPIN_RULE: SpinRule = 'allmini+'

/** Base attack per clear, before B2B, combo, all clear and surge. Index = lines cleared (0–4). */
export const ATTACK = {
  normal: [0, 0, 1, 2, 4],
  /** spin minis (T-spin minis, and every non-T spin under All-Mini+) */
  mini: [0, 0, 1, 2, 4],
  /** full spins: TSS 2, TSD 4, TST 6, (T-spin quad 10 is impossible with SRS+ but listed for completeness) */
  full: [0, 2, 4, 6, 10],
} as const

export const SCORING = {
  /** O-piece "spins" count under all-spin rules. TETR.IO behaviour unverified; off by default. */
  oSpins: false,
  /**
   * The 5th kick test (index 4) of a 90° rotation upgrades a T-spin Mini to a full T-spin
   * (TST / fin kicks). Not applied to 180s, whose 5th test is a sideways nudge, not a TST kick.
   */
  fifthKickUpgrades: true,

  /** B2B system. 'charging' = TETR.IO Season 2+ (flat bonus + Surge); 'chaining' = Season 1 legacy table. */
  b2bMode: 'charging' as 'charging' | 'chaining',
  /** flat bonus added to every back-to-back difficult clear (charging) */
  b2bBonus: 1,
  /**
   * Legacy B2B chaining bonus by displayed B2B count: [minB2B, bonus], highest match wins.
   * (tetrio.wiki.gg Mechanics, "B2B Chaining", replaced in Beta 1.0.0)
   */
  b2bChaining: [
    [1, 1],
    [3, 2],
    [8, 3],
    [24, 4],
    [67, 5],
    [185, 6],
    [504, 7],
    [1370, 8],
  ] as [number, number][],

  /** Surge starts charging at this displayed B2B count… */
  surgeStart: 4,
  /** …with this many lines (4 in Tetra League; Quick Play uses 1), then +1 per further B2B level. */
  surgeBase: 4,
  /** Surge is released as this many separate attacks (display only here; total is what counts). */
  surgeSegments: 3,

  /** combo multiplier: attack × (1 + comboBonus × combo) */
  comboBonus: 0.25,
  /** zero-attack clears at combo ≥ 2 send ln(1 + comboMinifierLog × combo) */
  comboMinifierLog: 1.25,

  /** Season 2 Tetra League: 5 (Season 1: 10, Quick Play: 3). Added flat after the combo multiplier. */
  allClearAttack: 5,
  /** B2B levels an All Clear adds, regardless of clear type (Mechanics page; confirmed by the user). */
  allClearB2B: 2,

  /** 'down' = floor (Tetra League, ZEN, custom). Quick Play's weighted-RNG rounding is not modelled. */
  rounding: 'down' as const,
}

export type ScoringConfig = typeof SCORING
