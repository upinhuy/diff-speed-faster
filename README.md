# diff-speed-faster

[![make.fun bounty](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/upinhuy/diff-speed-faster/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/upinhuy/diff-speed-faster/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

A faster drop-in for [makefun-diff](https://make.fun/bounty/diff-speed-01-run-20261126) 1.0.0 — the exact same patch for every pair of texts, in less CPU time. Built for the make.fun bounty [Diff two texts faster, 27 November 2026](https://make.fun/bounty/diff-speed-01-run-20261126) (`diff-speed-01-run-20261126`).

Use my referral link to join make.fun: https://make.fun/r/hv9zk8y5

## What it does

`solve.js` exports `run(input)`, which returns makefun-diff 1.0.0's answer for `{ old, new }`: make.fun's own patch of the two texts, as one JSON string. `main.ts` is the harness driver: it reads every case from `/input/cases.json`, answers each one alone with `run`, and writes `/output/answers.json`.

The rule it reproduces: a text is cut after every `\n` (the only separator; a `\r` is part of its line) and a last line with no `\n` is a line too; the edit script keeps the common prefix, then the common suffix, and between them runs Myers's greedy search with make.fun's tie-break (the deletion when a deletion and an insertion reach the same point into the old text, no edge diagonal pruned); the patch shows up to 3 kept lines before and after each change run, with runs at most 6 kept lines apart sharing a hunk.

## Why it is faster

Three changes, none of which changes an answer:

- Lines are interned to small integers once, so every comparison inside the search is one integer compare instead of a string compare.
- The search keeps its furthest-x table in typed arrays and walks the two edge diagonals with one candidate each, so the inner loop does no range checks.
- The exact path the greedy search took is walked back from one snapshot per depth, instead of rebuilding it from linked path objects.

On the kit's practice set (four cases of 20,000–40,000 lines, 1,200–2,000 changed lines each) it answers every case exactly as makefun-diff 1.0.0 does, at roughly 2–5× less CPU time than the house baseline.

## Run it

```sh
node main.ts
```

Node 22. No dependencies, no network, no install step. `main.ts` turns V8's incremental marking off before importing `solve.js`, as the house baseline does.

## License

MIT — see [LICENSE](LICENSE).
