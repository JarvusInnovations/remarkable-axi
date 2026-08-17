---
status: planned
depends: []
specs:
  - specs/architecture.md
issues: []
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

- [ ] `remarkable-axi --help` is a single valid TOON document with no prose
      sections and no format mixing
- [ ] `remarkable-axi <command> --help` is TOON for every command in
      `COMMAND_GROUPS`
- [ ] Home view `help[]` emits one line per entry with no escaped commas/quotes
- [ ] Every command output's `help[]` uses the same block form (spot-check `ls`,
      `put`, `check`, and an error path)
- [ ] Unknown-flag errors still print their inline flag reference correctly under
      the new formatting

## Risks / unknowns

- **Downstream string-matching** — anything parsing the old help layout (tests,
  docs snippets, the README) breaks; grep for asserted help fragments before and
  update in the same commit.

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
