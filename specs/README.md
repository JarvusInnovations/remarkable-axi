# Specs

This directory is the source of truth for what *should be true* of remarkable-axi.
Implementation follows spec: before changing behavior, change the spec here, then
bring the code into conformance. Spec↔code drift is a bug, not debt.

The full methodology is in the vendored **specops** skill
(`.claude/skills/specops`). Invoke it before writing specs, planning, or building.

## Layout

```
specs/
├── README.md            # this file
├── principles.md        # project-wide decisive rules
├── architecture.md      # runtime, distribution, cloud access, local state
├── commands/            # one file per command — the user-facing contract
│   ├── README.md        # the whole surface at a glance, plus deprecations
│   └── <command>.md
└── behaviors/           # rules spanning several commands
    └── <behavior>.md
```

**commands/** is this project's analogue of screen specs. A command spec declares its
usage, what it accepts, what it does, what it emits on success, and how it fails.

**behaviors/** holds rules no single command owns — page geometry, path uniqueness,
ink preservation, the cloud cache. When a command spec says "the device page box",
the behavior spec defines it.

## Conventions

- Specs declare **what**, not **how**. No file paths, function names, or pseudocode.
- Output examples are illustrative of *shape*, not byte-exact fixtures.
- Errors are specified with their message and their `help` lines, because those are
  the contract an agent acts on — not incidental wording.
- The [AXI standard](https://axi.md) governs output
  format, error shape, flag validation, and help across every command. It is assumed
  rather than restated; specs cover only what is specific to this tool.

## Coverage

Not every existing command is specified yet. `commands/README.md` declares the whole
desired surface; the commands carrying detailed specs are the ones whose behavior has
been designed or redesigned deliberately. The rest are existing behavior awaiting
backfill, and `/audit-spec-drift` will keep reporting them as such — that is the
intended signal, not noise.
