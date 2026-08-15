---
status: done
pr: 19
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

- [x] `render <html>` writes `./<name>.pdf` at exactly the device page box
- [x] `--out <path>` honored; the flag never selects a format
- [x] No `@page` in source → box injected, output states `(injected)`
- [x] Matching `@page` → proceeds, output states `(matches)`
- [x] Differing `@page` → honored, signed delta reported, exit 0
- [x] `--device-page` overrides a differing declaration
- [ ] Rendered PDF opens on-device filling the panel edge to edge, no panning
- [x] Chrome absent → `MISSING_TOOL` naming the install and that `doctor` checks it
- [x] Chrome failure → `RENDER_FAILED` with the cause extracted, not raw output

## Risks / unknowns

Chrome's headless flag surface shifts between versions, and the working invocation was
arrived at empirically. Pin what is verified and let `doctor` report the detected
version, so a future breakage is diagnosable rather than mysterious.

Whether the rendered PDF genuinely fills the panel can only be confirmed on hardware —
the geometry math predicts it, but the last check is visual and manual.

## Notes

- The "PDF fills the panel edge to edge on-device" box is left unchecked
  deliberately — it can only be confirmed on real hardware, not in this
  environment. The geometry math is verified precisely (rendered `MediaBox`
  checked against the device's `pageBox()` for every disposition,
  injected/matches/honored/overridden, via `pdf-lib`), but that is
  prediction, not the physical check.
- `parseDeclaredPageBox()` and `injectPageBox()` (both in `src/page.ts`)
  were extended, not reimplemented: the parser now scans every `@page` rule
  and lets the last one declaring a size win (the real CSS cascade), and
  injection adds its own `<style>` block composed alongside the author's
  rather than rewriting it. Both were needed for the documented
  `@page { margin: 0 }` (no size) wrinkle and the `--device-page` override,
  and both are written to be reusable by `check`/`put` when those land.
- `--out`'s default lands beside the source file, not the CWD — the spec's
  literal wording ("`./<name>.pdf` beside the source"), and a deliberate
  departure from `fetch`/`put`'s CWD-relative default, which exists only
  because those commands' sources live in the cloud with no local
  "beside" to speak of.
- `specs/commands/render.md` was amended in this PR: the spec named three
  `page:` dispositions but not the fourth `--device-page` produces
  (`overridden`). Added the `(overridden; declared ..., delta)` shape as
  implemented.
- Chrome discovery (`src/chrome.ts`) checks `REMARKABLE_AXI_CHROME`, then
  `PATH`, then well-known per-platform install paths; memoized per process.
  Chrome's CLI `--print-to-pdf` exits 0 even on a write failure, so success
  is judged by the output file actually existing, not the exit code — this
  was discovered empirically against a real Chrome 147 install and is the
  reason `RENDER_FAILED`'s cause has to come from parsing stderr.
- `vitest.config.ts` `testTimeout` raised to 20s: the new suites spawn a
  real Chrome process per case (self-skipping when Chrome is absent), which
  is comfortable in isolation but tight against the previous 5s default
  under full-suite contention.

## Follow-ups

- Deferred to plan: `check` (rasterize + lint, per `specs/commands/check.md`)
  and `put`'s HTML-source dispatch will both call into `render`'s path per
  their specs ("rendered first, exactly as `render` would") — not built
  here, tracked by their own not-yet-authored plans.
- None: no other gaps identified against `specs/commands/render.md` or
  `specs/behaviors/page-geometry.md`.
