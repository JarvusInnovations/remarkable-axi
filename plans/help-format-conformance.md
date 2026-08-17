---
status: done
depends: []
specs:
  - specs/architecture.md
issues: []
pr: 35
---

# TOON help output and block-form help arrays

## Scope

Bring the help surface into AXI conformance per the new paragraph in
[architecture.md](../specs/architecture.md#command-surface-has-one-source):

- The top-level listing and every `--help` block emit TOON (`usage:`,
  `commands[n]:`, `flags:`, `examples:` as TOON keys) instead of the current prose
  manpage — which today is also *mixed*, ending in a bolted-on TOON `"built-in":`
  block.
- `help[]` arrays (home view and every command output) emit in block form — one
  line per entry — instead of the inline form with comma-and-quote escaping.

Out of scope: any change to help *content* (that is
[`design-loop-disclosure`](design-loop-disclosure.md)); any change to the
`reference.ts` data shape beyond what rendering needs.

## Implements

- `specs/architecture.md` — the "help output is itself output" paragraph

## Approach

- Rewrite `renderTopLevelHelp` and `renderCommandHelp` in `src/reference.ts` to
  emit TOON from the existing `COMMAND_GROUPS` data — the structure already matches
  the shape the AXI reference tools print (`usage`, grouped `commands`, per-command
  `flags`/`examples`); only the serialization changes. Fold the `built-in` block
  into the same TOON document.
- Emit `help[]` string lists in block form. The `@toon-format/toon` encoder inlines
  primitive arrays by default, so route help arrays through a small formatter at
  the output boundary in `src/cli.ts` (or the encoder's option if it has one)
  rather than hand-assembling TOON anywhere else.
- Sweep tests that assert on help output; update snapshots deliberately, not
  mechanically — each diff should read better after.

## Validation

- [x] `remarkable-axi --help` is a single valid TOON document with no prose
      sections and no format mixing
- [x] `remarkable-axi <command> --help` is TOON for every command in
      `COMMAND_GROUPS` (spot-checked all 14 usages; see Notes for the one
      pre-existing lookup bug found along the way)
- [x] Home view `help[]` emits one line per entry with no escaped commas/quotes
      (verified against a real paired account, read-only)
- [x] Every command output's `help[]` uses the same block form (spot-checked
      `ls` and `check` live, read-only/local; `put` verified via
      `test/output.test.ts`'s direct coverage of the shared `toonOutput` /
      `encodeToon` path rather than a live run, since `put` mutates the
      account)
- [x] Unknown-flag errors still print their inline flag reference correctly under
      the new formatting

## Risks / unknowns

- **Downstream string-matching** — anything parsing the old help layout (tests,
  docs snippets, the README) breaks; grep for asserted help fragments before and
  update in the same commit.

## Notes

- Block form for `help[]`/`flags`/`examples` (and any other string-array
  field) is deliberately **not** strict TOON §9.4 list form, which requires a
  leading `-` on every item. A hint or example line is prose an agent reads,
  not data it decodes back, so the dash would only add noise. This matches
  the shape this repo's README already documented and what other AXI
  reference tools already ship (e.g. `gh-axi issue --help`'s `examples:`
  block, and the `axi` skill's own `help[2]:` example) — confirmed by
  running `gh-axi` live and reading `~/.claude/skills/axi/SKILL.md` before
  implementing, since the spec text alone ("block form... one line per
  entry") doesn't pin down the dash question.
- The rendering fix is a single choke point: `toonOutput()` in `src/cli.ts`
  wraps every command handler (and `home`) where they're registered with the
  SDK, converting each handler's plain-object return into an
  already-rendered TOON string via `encodeToon()` (`src/output.ts`) before
  the SDK's own encoder ever sees it. No command file changed, so every
  existing unit test that asserts on a command's raw object return (e.g.
  `home.test.ts`, `check.test.ts`) kept working unmodified.
- `renderTopLevelHelp()`/`renderCommandHelp()` now build a plain object from
  `COMMAND_GROUPS` and call `encodeToon()` directly rather than assembling
  strings — the `reference.ts` data shape (`CommandDoc`/`CommandGroup`) is
  untouched, per the plan's scope boundary.
- The SDK's own bolted-on `built-in:` block (`update`/`update --check`) is
  rendered by `axi-sdk-js` itself, not this repo, so it can't be folded into
  one `encodeToon()` call. It's still made to read as one continuous TOON
  document: `renderTopLevelHelp()` keeps every key at depth 0 with no
  trailing blank line, and the SDK writes its block right after with no
  separator — verified in the review-guide sample.
- Found a **pre-existing, unrelated bug** while spot-checking every command's
  `--help`: `remarkable-axi setup hooks --help` prints `setup device`'s doc
  instead of its own. `cli.ts` only ever passes the single top-level command
  word (`"setup"`) to `getCommandHelp`, and `commandDoc()`'s loop matches on
  `doc.usage.split(" ")[0] === name`, which is true for *both* `setup
  device <model>` and `setup hooks` — it returns whichever comes first in
  `COMMAND_GROUPS`. Confirmed present on `develop` before this branch (used
  a throwaway worktree at the pre-change commit to check), so it's not a
  regression from this change. Not fixed here — it's a data/dispatch bug,
  not a serialization one, and out of this plan's scope. Filed as a
  follow-up below.
- Two pre-existing test failures (`check`/`render` "no device target and no
  --device fails NO_DEVICE") are unrelated to this change — they fail
  identically on unmodified `develop` on this machine (real paired-device
  config leaking into the test's fake `$HOME`). Not touched.

## Follow-ups

- Fix `commandDoc()`/`getCommandHelp` dispatch so `remarkable-axi setup
  hooks --help` shows the `setup hooks` doc rather than `setup device`'s —
  pre-existing bug, needs `cli.ts` to pass the full command phrase (or
  `commandDoc` to prefer an exact multi-word match) rather than just the
  first word.
- If `axi-sdk-js` ever exposes a rendering hook for its own built-in
  `update`/`update --check` help and commands-list block, revisit folding
  that block-form arrays too (currently outside this repo's reach).
