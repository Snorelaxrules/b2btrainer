# B2B Trainer

A browser-based Tetris trainer, styled after TETR.IO, for practising **spins and
back-to-back (B2B) chains**. You play normally; press **P** at any moment and a
planner analyses your exact position (board, piece in hand, hold, the five
previews) and shows short placement plans that chain spin clears **without ever
breaking B2B**, with the keys to press and an explanation of why each plan scored
the way it did.

**Play:** https://snorelaxrules.github.io/b2btrainer/

Static site: Vite + React + TypeScript, no backend. The game engine, move
search and planner are plain TypeScript with no DOM dependencies, so the same
code runs in the browser (inside a Web Worker), in unit tests, and in Node
command-line tools.

> Not affiliated with TETR.IO or The Tetris Company. "TETR.IO-style" describes
> the rules and handling the trainer reproduces.

---

## Contents

- [What it does](#what-it-does)
- [Controls](#controls)
- [Architecture](#architecture)
- [The game engine](#the-game-engine)
- [Spin rules, B2B and attack](#spin-rules-b2b-and-attack)
- [The planner](#the-planner)
- [Plan scoring](#plan-scoring)
- [Learning from real players: the replay pipeline](#learning-from-real-players-the-replay-pipeline)
- [Developer tools](#developer-tools)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Status and roadmap](#status-and-roadmap)

---

## What it does

- **A playable game with TETR.IO's rules:** SRS+ rotation with 180° kicks, a
  seeded 7-bag, hold, ghost piece, five previews, optional gravity, and TETR.IO's
  default handling (DAS 75 ms, ARR 0, DCD 0, instant soft drop). Handling is
  adjustable in the side panel (shown in frames, like TETR.IO).
- **Unlimited exact undo/redo:** every state is an immutable snapshot.
- **Custom positions:** a fixed seed and a custom queue for drilling the same
  sequence.
- **On-demand spin planner (P):**
  - Searches every reachable placement of the pieces you can see, including hold
    swaps, for sequences that end in one or more B2B-keeping spin clears, up to
    three in a row, e.g. an S-spin that leaves the roof for a TSD.
  - Shows up to three plans on the board as numbered ghost pieces, with each
    step's key sequence and an expandable score breakdown.
  - Once you play a plan's first step, the plan locks and follows you, even if
    you place its pieces in a different order.
- **Two spin rule sets, switchable live:** "All-spin" (TETR.IO's All-Mini+:
  any piece stuck after a rotation scores a mini spin that keeps B2B) and
  "T-spins only".
- **HUD:** B2B counter, surge meter, combo, attack and a log of recent clears.

## Controls

| Action | Keys |
|---|---|
| Move | ← → |
| Soft drop | ↓ |
| Hard drop | Space |
| Rotate clockwise | ↑ or X |
| Rotate counter-clockwise | Z |
| Rotate 180° | A |
| Hold | Shift or C |
| Restart | R |
| Planner on/off | P |
| Switch between shown plans | Tab (Shift+Tab: back) |
| Undo / redo | Ctrl/⌘+Z, Ctrl/⌘+Y (Backspace also undoes) |

## Architecture

```
 keyboard ──► InputController (DAS/ARR/DCD/SDF from timestamps)
                    │
                    ▼
   Session (immutable GameState snapshots, undo/redo) ◄── canvas Renderer
                    │ events: place / hold / undo / restart …
                    ▼
   PlannerController ──postMessage──► Web Worker: searchPlans()
   (lock / follow / cache per state)        │
                    ▲                       ▼
                    └──── verified plans ◄── engine replay check (verify.ts)
```

- **`src/engine`:** pure game logic. A `GameState` is never mutated; every
  action returns a new state, so any state can serve as an undo snapshot or a
  search node.
- **`src/input`:** handling. Key presses become timed moves; repeat timing is
  computed from timestamps, not the OS key repeat.
- **`src/render`:** a single canvas for the board, hold, previews and the plan
  overlay.
- **`src/search`:** the Web Worker. A search that becomes outdated (you moved,
  undid, or changed settings) is cancelled by terminating the worker.
- **`src/app`:** glue: settings (saved in `localStorage`) and the planner
  controller, which locks a plan, follows it through out-of-order placements,
  and remembers planner state per position so undo/redo restores it.
- **`src/config`:** every tunable number lives here, never inline in the logic:
  scoring rules, handling, keys, theme, plan-score weights.

## The game engine

- **Coordinates:** x = column, y = row from the bottom. The board is a 10×40
  `Uint8Array`: 20 visible rows plus a hidden buffer. Pieces spawn in rows
  21–22, just above the field, like TETR.IO.
- **Rotation:** SRS+ wall kicks, including TETR.IO's 180° kick table. Each
  rotation records which kick test it used, because spin detection depends
  on it.
- **Randomizer:** a seeded 7-bag. TETR.IO's Quick Play `zenith` bag turned out
  to be the same: replaying a real Quick Play game with a plain 7-bag from its
  seed reproduces it exactly.
- **Move search (`movegen.ts`):** a breadth-first search over
  `(rotation, x, y, how it arrived)`, packed into 16-bit integer keys. Moves are
  taps, DAS to the wall, soft drop, and the three rotations with kicks. Each
  position is expanded once, but every distinct arrival (a shift, or each kick
  index) is kept, since a spin depends on the last move. Kick and shape tables
  are precomputed and scratch arrays are reused, so a full search takes about
  0.2 ms. It returns every resting placement with its shortest key sequence.
- **Replay verification (`verify.ts`):** plays a plan's key sequences through
  the real engine, step by step, and checks the landing cells, the clear label,
  spin type, attack, B2B and combo. A plan that doesn't reproduce exactly is
  never shown, and the dev build counts discarded plans; that count is zero in
  tests.

## Spin rules, B2B and attack

All rules live in `src/config/scoring.ts`, with sources cited in the file
header: tetrio.wiki.gg's *Mechanics* and *Spins* pages, and the tetris.wiki
TETR.IO pages.

- **T-spins:** the last move was a rotation, and 3 of the 4 corners around the
  T are filled (walls count). It's a full spin if both front corners are filled,
  otherwise a mini. A 90° rotation that used the 5th kick test upgrades a mini
  to a full spin; a 180° rotation's 5th test does not.
- **All-Mini+ (all-spin):** any piece, T included, that can't move left, right
  or up after rotating into place scores a mini spin. O-spins are off.
- **B2B charging and surge:** each spin or quad clear raises B2B. From B2B 4,
  breaking the chain releases stored surge garbage in three segments.
- **Attack:** per-clear base attack table, B2B bonus, combo multiplier
  `1 + 0.25·combo` (with `ln(1 + 1.25·combo)` for zero-attack clears), rounded
  down. An All Clear adds attack and B2B.

## The planner

`src/engine/planner.ts` runs in a Web Worker. It answers: *with only the pieces
I can see, which placements chain spin clears without breaking B2B, and leave
the cleanest stack?*

**Search space**
- A node is a full game state: board, piece in hand, hold and whether it was
  used, position in the queue, B2B and combo.
- Children are every reachable placement of the piece in hand, or of the hold
  or next piece via hold, generated by the real move search on that node's own
  board.
- Only known pieces are used, never guessed ones, so a plan can always be
  played.

**Hard prunes.** A placement is never part of a plan if it:
- breaks B2B,
- leaves the stack above the height limit, or
- seals off a hole that the pieces still coming couldn't reopen. Mid-plan, a
  spin may seal a cell that the next clear opens again; a finished plan may
  never end with more sealed holes than it started with.

**Goal and completion**
- A plan is complete right after a B2B-keeping clear (a spin, or a quad).
- It may go on chaining, up to 3 spins.
- With no spin clear in reach, the planner returns *setups*: stacks that leave
  a spin slot ready for a piece you know is coming.

**Search strategy**
- **Beam search with iterative widening under a time budget** (Quick 200 ms,
  Normal 0.6 s, Deep 2 s). A narrow first pass (16 wide) always finishes; each
  later pass is three times wider. The best plans so far are reported after
  every pass.
- **Ranking partial plans:** what the plan has achieved (attack, spins, pieces
  used), plus the best spin slot its stack offers a piece still coming, minus a
  light stack tie-breaker. The full stack penalties apply only to a finished
  plan's end stack.
- **Cheap first, exact when needed:** spin-slot values are first estimated by a
  shape check, then confirmed with the real move search, best candidates first.
  An early version confirmed a fixed set of front-runners, which let shapes that
  only *looked* like T-slots crowd out clean lines; a regression test now covers
  that.
- **Duplicates and diversity:** a transposition key (board hash, queue position,
  hold, counters) drops repeated states. Each first move is capped at a third
  of the beam, so the three plans shown differ. The same placements in a
  different order count as one plan.

**Latent spin slots (`slots.ts`).** `slots(board, piece, rule)` lists every
reachable placement of a piece that would be a spin *and* clear lines, using
the real move search and spin detection. Uses:
- the "what can spin next" value of a stack;
- naming the slot a setup leaves ("TSD slot ready for the T");
- deciding which overhangs are part of a spin and shouldn't be penalised.

**Following a plan**
- When you place a piece exactly where any step of the shown plan puts it, the
  remaining steps are re-ordered to fit the pieces you have left.
- This is a small depth-first search over hold and queue order, with the
  target cells shifted down past any rows your placement cleared.
- Every re-ordered plan is verified against the live game state again.

## Plan scoring

A finished plan is scored once: on its **end stack**, plus its **totals**. Every
weight lives in `src/config/planScore.ts`, and the panel's "Why this plan"
table shows each term's contribution.

| Group | Terms |
|---|---|
| Totals | attack sent; spin chain (full spins count 1, minis ½, plus a bonus per extra link); full spins; pieces used; holds used |
| Cleanliness | unreachable holes (sealed off, or open but unreachable by any piece); rows that will need digging; stray overhangs (covered cells that aren't part of a spin slot); surface roughness outside slot columns |
| Flexibility | how many of the 7 pieces have a clean placement; deep 1-wide wells; rows whose only gap is a single open column (clearable only by a vertical fill, so they cost B2B unless an I makes a quad of them) |
| What comes next | spin slots left on the end stack, weighted higher for pieces known to be coming |
| T resource | a T kept in hold or the next few pieces; a T spent without a spin clear |
| Safety | height above a margin |

Pocket classification (`features.ts`) uses the real move search for all seven
pieces. It labels every covered cell as one of:
- **tuck:** a piece can slide or drop into it;
- **spin-only:** a piece can only get there by rotating in and getting stuck;
- **dead:** connected to open air, but no piece can ever reach it.

## Learning from real players: the replay pipeline

The scoring weights started as hand-set guesses. To ground them in how top
players actually build, the project reconstructs real games from TETR.IO
replay files and measures how often the planner agrees with the player.

1. **Exact reconstruction.** TETR.IO replays (`.ttr` solo, `.ttrm` Tetra
   League) store inputs, not boards: every key press and release with
   sub-frame timing, the seed, the player's handling, and garbage events.
   `scripts/replay/` feeds them through the open-source, MIT-licensed
   [`@haelp/teto`](https://github.com/halp1/triangle) engine, a frame-accurate
   TETR.IO implementation. This is a dev-only dependency, never shipped.
   Correctness check: for every round of every match so far, the simulated
   attack sent equals the replay's recorded value to the line, and the loser
   tops out on exactly the final frame.
2. **Extraction.** Each placement becomes a position: board (with garbage),
   piece in hand, hold, five previews, B2B, combo, incoming garbage, and the cell
   the player chose. Three Tetra League matches gave **7,592 positions**: 4,066
   by 5han and the rest by four opponents.
3. **Agreement.** For each position, the planner runs on the same information
   the player had. The comparison counts whether its top plan's first move, or
   any of its top three plans' first moves, matches the player's.
   - **Engine check:** our move search can reach **100%** of the players'
     placements, which confirms the rotation and kick rules match TETR.IO.
   - **Baseline at 200 ms** (404 of 5han's positions, before tuning): **37%**
     top-1 and **56%** top-3. Agreement reaches 86% top-3 when he cashes in a
     spin and 93% on his quads; ordinary stacking moves are the hard part.
4. **Tuning.** `npm run tune` runs a coordinate search over the weights to
   maximise agreement. It uses deterministic searches, runs across all CPU cores
   with worker threads, trains on some matches, and reports a **held-out match**
   and **other players** separately, so the weights don't just fit one game.
   - **Lesson:** weights tuned with a narrow single-pass search did not transfer
     to the app's wider time-limited search. Tuning has to use the same passes
     the app completes in 200 ms (16 then 48 wide).
   - **Result** (current defaults, trained on two of 5han's matches):

     | Measured at the app's 200 ms search | Before (top-1 / top-3) | After |
     |---|---|---|
     | 5han's held-out match | 34.0% / 50.3% | **35.3% / 57.7%** |
     | hiyori (not trained on) | 32.3% / 52.0% | 32.3% / 52.7% |

What the data has shown so far:
- **Quad wells are a resource, not a liability.** Tuning removed the
  I-dependency penalties entirely; top players keep a well and cash quads,
  which also keep B2B.
- **Full spins matter far more than minis.** A mini is now worth ¼ of a full
  spin in the chain term, and a full spin carries a large bonus. 5han's opener
  is a TSD every bag, with almost no minis.
- **Stray overhangs and sealed holes cost more, roughness costs less.** Strong
  players tolerate uneven stacks but not covered cells.
- **Holds:** the untuned planner held far more than he does, but a direct hold
  cost didn't improve agreement. The excess came from the old chain weights.

## Developer tools

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit, property and fuzz tests (Vitest) |
| `npm run build` | Type-check and production build |
| `npm run plan -- fixtures/x.json` | Headless planner: prints each plan's keys, end stack and per-term score table |
| `npm run fixtures` | Runs every fixture with an `expected` block (minimum chain length, expected clears in order, optional expected first move); exits 1 on failure |
| `npm run extract -- replays/dataset.json replays/*.ttrm` | Replays → position dataset |
| `npm run replay-check -- replays/x.ttrm` | Per-round reconstruction check against recorded stats |
| `npm run agree -- --player 5han` | Agreement report, broken down by situation, with example misses |
| `npm run tune` | Weight tuning against a player, with held-out evaluation |

**Fixture format** (`fixtures/*.json`). The board is rows top to bottom. The
first queue piece is the one in hand. `b2b` is the in-game ×n count.

```json
{
  "name": "Synthetic: S-spin single leaves the roof of a TSD",
  "ruleset": "allmini+",
  "board": ["#.........", "#..#######", "..........", "#...######", "##.#######"],
  "queue": "STOIL",
  "hold": null,
  "b2b": 3,
  "expected": { "minChainLength": 2, "expectedClears": ["S-Spin Mini Single", "TSD"] }
}
```

The command-line tools run the same TypeScript sources as the app, directly in
Node, which strips types natively. A small resolve hook,
`scripts/ts-hooks.mjs`, handles the extensionless imports. Nothing is
transpiled or duplicated.

## Testing

110+ tests (`npm test`), including:
- **Engine and rules:** SRS+ and 180° kicks, spin detection under each rule
  set, B2B charging, surge, combo and All Clear arithmetic.
- **Move search:** reachability and shortest key sequences.
- **Verification:** deliberately broken plans are rejected, such as a step
  scored on a stale board, a wrong hold order, or a piece beyond the visible
  queue.
- **Planner:**
  - finds the S-spin → TSD chain under All-Mini+, and never counts the S as a
    spin under T-spins only;
  - never breaks B2B;
  - finished plans never leave sealed holes;
  - regression boards from real screenshots.
- **Fuzz (≈45 random messy positions × 3 spin rules):**
  - every plan replays exactly in the engine;
  - every plan obeys the hard prunes and the spin rule;
  - score terms add up to the total;
  - after following the first step, the rest of the plan can still be
    completed.
- **Score and slot modules:** constructed boards for TSD, TST, S-spin, sealed
  holes, dig rows, flexibility and I-dependency.

## Project layout

```
src/
  config/     scoring rules (with sources), plan-score weights + search settings, handling, keys, theme
  engine/     game.ts, pieces.ts, rng.ts, session.ts, scoring.ts      rules and state
              movegen.ts, finder.ts, features.ts, slots.ts            move search and board analysis
              planner.ts, planScore.ts, verify.ts                     planner, scoring, replay check
  harness/    position files, plan reports, replay agreement          (shared by tests and CLI tools)
  input/      handling and keyboard
  render/     canvas renderer and plan overlay
  search/     planner Web Worker
  app/, ui/   trainer state, planner controller, React panels
scripts/      plan, fixtures, agree, tune (TypeScript run by Node); replay/ (extraction via teto)
fixtures/     test positions (JSON)
replays/      local replay files and datasets (git-ignored)
```

## Status and roadmap

**Done:**
- the game, handling and undo;
- the spin and B2B rules;
- the spin-chain planner with explanations, plan following and verification;
- the headless harness and fixture runner;
- exact replay reconstruction and agreement measurement.

**In progress:** more replays (more players) to tune against, so the weights
fit how strong players build in general rather than one player.

**Next:**
- **Rule presets:** current Tetra League uses surge base 3 and All Clear +1 B2B;
  Quick Play uses 4 and +2.
- **Incoming garbage** in the planner: agreement drops while garbage is pending.
- **7-bag tracking:** knowing when the next T or I is guaranteed.
- **An input-count cost:** fast players favour simple placements.
- **Named setups** (TKI, STSD, fractal) as fixtures.
