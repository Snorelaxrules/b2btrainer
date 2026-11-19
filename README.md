# B2B Trainer

A TETR.IO-style Tetris trainer for finding and chaining spins: press **P** at any
point and it plans a spin setup from your position that keeps back-to-back.

**Play:** https://snorelaxrules.github.io/b2btrainer/

Vite + React + TypeScript, static (no backend). `npm install`, `npm run dev`,
`npm test`.

Full documentation (controls, handling, spin rules, attack table sources,
how the planner works) is coming with the next update.

## Tuning the planner without the UI

Every plan score weight lives in `src/config/planScore.ts`. To see how a position
scores, describe it in JSON (format in `src/harness/position.ts`; examples in
`fixtures/`) and run:

```sh
npm run plan -- fixtures/2026-11-19-i-dependency.json   # or a whole folder
npm run plan -- fixtures --budget 200 --top 3 --all      # like the app's Quick search
```

Each plan prints its keys, the stack it leaves, and a table of what every score
term contributed. Without `--budget` the search runs every pass (16, 48, 144,
432 wide), so results are the same on every machine.
