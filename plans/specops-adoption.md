---
status: done
depends: []
specs:
  - specs/README.md
  - specs/principles.md
  - specs/architecture.md
issues: []
pr: 9
---

# Adopt spec-driven development

## Scope

Bootstrap specops in this repo: vendor the skill, create `specs/` and `plans/`,
capture the principles and architecture that until now lived in the README and in
commit messages, and install the drift auditor.

Out of scope: backfilling specs for commands whose behavior is not being redesigned.
`specs/commands/README.md` declares the whole surface, and the unspecified commands
are left as an explicit, auditable gap.

## Implements

- `specs/README.md` — layout and conventions
- `specs/principles.md` — the decisive rules, seeded from decisions already made
- `specs/architecture.md` — runtime, distribution, cloud access shape, local state

## Approach

Vendor the skill with `npx skills add` and commit the generated files separately from
hand-written ones.

Principles are seeded from judgment that was already resolved but only recorded in
prose: the calibration stance ("measure the device; never ship a guessed constant")
comes straight from the README's account of the ink-placement transform and the pen
palette, and `reference.ts` as the single documentation source is an architecture
decision that existed only as a code comment.

Add the CLAUDE.md hook so the methodology loads every session, and note the repo's
public audience there — it constrains what may appear in specs, plans, and commit
messages.

## Validation

- [x] specops skill vendored to `.agents/skills/specops` with `.claude` symlink and `skills-lock.json`
- [x] `specs/` with README, principles, architecture
- [x] `plans/` with README
- [x] `.claude/agents/spec-drift-auditor.md` and `.claude/commands/audit-spec-drift.md`
- [x] CLAUDE.md carries the specops hook and the public-repo constraint
- [x] `specops` CLI runs against `plans/` and reports the DAG
- [x] `bun run check` and `bun run test` still pass (no source touched, but the tree changed)
- [x] SessionStart hook installed at project scope

## Risks / unknowns

The vendored skill is a copy, so it drifts from upstream silently. Re-running
`npx skills add` is the refresh; nothing detects that it is due.

## Notes

Landed alongside the design batch this branch exists to negotiate, so the same PR
carries both the methodology and its first real use.

Most of `principles.md` is transcription rather than invention. The calibration
stance was already the project's practice — the ink transform solved by least squares,
the palette read off a device-written page, indices left absent rather than guessed —
but it lived in a README passage and a source comment where nothing steered a future
implementer by it. Writing it down immediately paid out: applying it to the device
table surfaced that four of five models are unverified, which became
`behaviors/device-calibration.md` and four tracking issues.

`reference.ts` as the single documentation source was likewise a real architecture
decision recorded only as a code comment.

## Follow-ups

- **Tracked as** — the vendored skill drifts from upstream silently; refreshing it is
  a re-run of `npx skills add`, and nothing detects that it is due. Noted in Risks
  rather than filed, since it applies to every repo that vendors a skill and is not
  specific to this one.
- **Deferred to plan** — command specs for the surface that is not being redesigned.
  `specs/commands/README.md` declares the whole surface and `/audit-spec-drift` will
  report the unspecified ones as gaps, which is the intended signal.
