# remarkable-axi

An [AXI](https://github.com/JarvusInnovations/agent-skills) CLI for the reMarkable
cloud: send documents to a tablet, pull handwriting back off it, and manage the
files in between. Built with bun, bundled to a single file, published to npm.

The audience is **agents first, humans second** — output is TOON, errors are
structured and actionable, and nothing prompts. The `axi` skill carries that
standard; this repo's `specs/principles.md` carries the decisions specific to
driving a reMarkable.

**This repository is public.** No client, employer, or engagement names in code,
specs, plans, commit messages, PR titles or bodies, or example content. Examples
use generic placeholders.

## Spec-driven development (specops)

This project uses spec-driven development. `specs/` is the source of truth for what
*should be true*; `plans/` is the work-in-flight DAG that bridges specs to merged code.
The **specops** skill carries the full methodology — invoke it (the skill triggers on
"spec", "plan", starting a feature, etc.) before writing specs, planning, or building.

- **Specs lead.** Before changing behavior, change the spec; bring code into conformance
  after. Spec↔code drift is a bug, not debt. Specs merge implemented-or-planned; a spec
  still being designed rides a draft planning PR, not the main branch.
- **`plans/` is the planning system — not your built-in plan mode.** Every chunk of work
  lands as a file in `plans/` that freezes to `done` as the durable record of what got
  built. Don't let an ephemeral plan substitute for it, and don't skip it for "small"
  changes. (Classic trap: an ad-hoc plan of "write spec X, then build it" that ends with
  neither a reviewed spec nor a plan file — split those into the two real artifacts.)
- **When to author a plan depends on intent:** mapping out a batch of specs → finish the
  batch first, then propose a *set* of plans; speccing one bounded feature in a mature
  project → draft the spec change and its plan in tandem; intent unclear → ask. The skill
  details each mode.
- **A spec change ripples to its plans.** After editing a spec, review the plans that
  implement it (`grep -l '<spec-path>' plans/*.md`) and offer to update them.

Query the DAG: `.claude/skills/specops/scripts/specops next` (what to work on next) and
`.claude/skills/specops/scripts/specops dag` (graph). Run `/audit-spec-drift` to compare
specs against the implementation.

## The command surface has one source

`src/reference.ts` is the single place the command surface is described. The home
view's help lines, every `--help` block, and the generated SKILL.md region all
derive from it. Changing a command means changing `reference.ts` — never add help
text anywhere else.

## Development

```sh
bun install
bun run check    # type-check
bun run test     # unit tests (vitest)
bun run build    # bundle to dist/bin/remarkable-axi.js
bun run dev      # run from source
```

Releases follow the develop→main Release-PR flow; `develop` is the default branch.
