---
status: planned
depends: []
specs:
  - specs/commands/put.md
issues: []
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

- [ ] `put --help` `--replace` line states upload-first ordering and names
      rm-then-put
- [ ] `rm` of a document emits the `put --replace` hint; `rm` of a folder does not
- [ ] `devices` output contains no `specs/` path
- [ ] `login` success hints `setup device <model>`
- [ ] `page` without `--css` hints `--css`
- [ ] `grep -rn 'specs/' src` shows no repo-internal path in any user-facing string

## Risks / unknowns

- **Hint budget** — several outputs gain a line; each addition was judged against
  AXI §9's omit-when-self-contained rule, and none of these outputs is
  self-contained for the flow the hint serves. Watch total help-line counts stay
  small (≤4 per output).

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
