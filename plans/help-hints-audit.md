---
status: done
depends: []
specs:
  - specs/commands/put.md
issues: []
pr: 31
---

# Help-surface audit fixes

## Scope

The wording fixes from a full audit of every command's `--help` block and runtime
help hints against the AXI disclosure rules. Each item below is a small, bounded
change; together they are one conformance pass over the hint surface.

Out of scope: the design-loop hint chain
([`design-loop-disclosure`](design-loop-disclosure.md)); help output format
([`help-format-conformance`](help-format-conformance.md)); put's HTML dispatch
([`put-html-source`](put-html-source.md)).

## Implements

- `specs/commands/put.md` — the "rm then put is the same intent in the unsafe
  order" disclosure: `--replace`'s flag description states the safe ordering, and
  `rm` on a document offers the one-step form

## Approach

- **`put --replace` flag description** (`reference.ts`): from "swap the contents of
  the document already at `<dest>`" to also state the ordering that makes it safe —
  e.g. "swap the contents of the document already at `<dest>` (uploads first, then
  trashes the old copy under a dated name — the safe form of rm-then-put)".
- **`rm` success on a document** adds a hint:
  "Replacing it? `remarkable-axi put <src> <path> --replace` does this in one safe
  motion" — the interception point where the rm-then-put plan forms. Folder
  removals don't get it.
- **`devices` calibration hint** currently references
  `specs/behaviors/device-calibration.md` — a repo-internal path meaningless to an
  npm install. Reword to be self-contained: "`calibration` is `calibrated` only
  where the numbers were measured on real hardware; other models carry declared
  specs".
- **`login` success** gains "Run `remarkable-axi setup device <model>` to set the
  device to design for" — the target is a prerequisite for the whole Design group
  and pairing is the moment it's missing.
- **`page` (plain form)** gains "Run `remarkable-axi page --css` for a paste-ready
  `@page` block" ahead of its design-loop hint, so the flag that exists for
  authoring is discovered from the output that prompts it.
- Sweep all hint strings for the above patterns while touching them: no
  repo-internal paths, every dynamic value parameterized or carried forward, every
  suggested command complete and runnable.

## Validation

- [x] `put --help` `--replace` line states upload-first ordering and names
      rm-then-put
- [x] `rm` of a document emits the `put --replace` hint; `rm` of a folder does not
- [x] `devices` output contains no `specs/` path
- [x] `login` success hints `setup device <model>`
- [x] `page` without `--css` hints `--css`
- [x] `grep -rn 'specs/' src` shows no repo-internal path in any user-facing string

## Risks / unknowns

- **Hint budget** — several outputs gain a line; each addition was judged against
  AXI §9's omit-when-self-contained rule, and none of these outputs is
  self-contained for the flow the hint serves. Watch total help-line counts stay
  small (≤4 per output).

## Notes

- All five changes landed exactly as worded in the Approach section. The
  sweep checked every hint string and every occurrence of the substring
  `specs/` under `src/`; the `devices` calibration line was the only
  user-facing leak found. Everything else that matches is a code comment
  (`//` or JSDoc `/** */`), which the validation rule treats as fine.
- `rm`'s hint gating is on `node.entry.type !== "CollectionType"` — it fires
  for a document regardless of whether the removal needed `--force` (that
  flag only governs non-empty *folder* deletes, never documents), and never
  fires for a folder, empty or not.
- `login`'s new hint reuses the exact phrase "to set the device to design
  for" already used by `setup`'s own USAGE error for a missing subcommand
  (`src/commands/setup.ts`, the `setup needs a subcommand` branch), so the
  wording was already an established convention rather than a new one.
- Three of the five touched commands (`rm`/`mv`/`mkdir` in `organize.ts`,
  `devices`, and `login`) had no command-level test file before this PR —
  `test/commands/organize.test.ts`, `test/commands/devices.test.ts`, and
  `test/commands/login.test.ts` are new, each mocking the cloud/config/token
  boundary rather than touching the network or this machine's real pairing
  state (following the pattern already established in `test/home.test.ts`).
- `bun run test` shows 2 pre-existing failures unrelated to this change:
  `check.test.ts` and `render.test.ts`'s "no device target and no --device
  fails NO_DEVICE" cases. Both were failing identically on `develop` before
  any edit in this PR — this sandbox has real reMarkable pairing/config on
  disk, and `auth.ts`/`config.ts` resolve their file paths from `homedir()`
  at module load, so the tests' per-test `HOME` env override can't isolate
  them (the same constraint `test/commands/setup.test.ts` already documents
  for `doctor`). Confirmed unrelated by running the full suite before making
  any change and seeing the same two failures.

## Follow-ups

- The two pre-existing `NO_DEVICE`-under-real-pairing test failures
  (`check.test.ts`, `render.test.ts`) are a standing gap in this sandbox's
  test isolation, not something this plan's scope covers — worth a follow-up
  plan/issue if the project wants those tests runnable in a paired dev
  environment (e.g. injecting the config/token paths instead of deriving them
  from `homedir()` at import time).
- `organize.ts` (`mkdir`/`mv`/`rm`) still has no test coverage for `mkdir` and
  `mv`, or for `rm`'s `NOT_FOUND`/`NOT_EMPTY` failure paths — only the hint
  gating this plan needed was added. A full `organize.test.ts` sweep is
  reasonable follow-up scope, not done here to stay within this plan's
  bounded change.
