---
status: planned
depends: [page-geometry]
specs:
  - specs/commands/render.md
issues: []
---

# HTML to device-sized PDF

## Scope

Add `render`: headless Chrome print-to-PDF at the target device's page box, with
`@page` injection and mismatch reporting.

## Implements

- `specs/commands/render.md`

## Approach

Own the invocation details that currently have to be rediscovered every time a
document is authored — the print box rounding, suppressing headers and footers, and
waiting for the document to settle before printing.

Inject the page box when the document declares none. Honor a differing declaration and
report the signed delta rather than overriding it: the surrounding layout was written
against the declared box, so silently substituting a different one invalidates every
dimension built on it. `--device-page` overrides explicitly.

Chrome is an optional external dependency. Discover it at run time, report it in
`doctor`, and fail with `MISSING_TOOL` naming what to install rather than degrading
silently.

## Validation

- [ ] `render <html>` writes `./<name>.pdf` at exactly the device page box
- [ ] `--out <path>` honored; the flag never selects a format
- [ ] No `@page` in source → box injected, output states `(injected)`
- [ ] Matching `@page` → proceeds, output states `(matches)`
- [ ] Differing `@page` → honored, signed delta reported, exit 0
- [ ] `--device-page` overrides a differing declaration
- [ ] Rendered PDF opens on-device filling the panel edge to edge, no panning
- [ ] Chrome absent → `MISSING_TOOL` naming the install and that `doctor` checks it
- [ ] Chrome failure → `RENDER_FAILED` with the cause extracted, not raw output

## Risks / unknowns

Chrome's headless flag surface shifts between versions, and the working invocation was
arrived at empirically. Pin what is verified and let `doctor` report the detected
version, so a future breakage is diagnosable rather than mysterious.

Whether the rendered PDF genuinely fills the panel can only be confirmed on hardware —
the geometry math predicts it, but the last check is visual and manual.

## Notes

## Follow-ups
