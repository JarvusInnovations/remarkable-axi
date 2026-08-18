---
status: done
depends: []
specs:
  - specs/commands/put.md
issues: []
pr: 33
---

# Implement put's HTML source dispatch

## Scope

Close a spec↔code gap surfaced by the help audit: `put.md` specifies HTML sources —
rendered to PDF at the device page box, linted like `check`, with `--device-page`
and `--strict` — but `src/commands/put.ts` refuses `.html` outright, with a stale
error claiming "`render` … is not implemented yet" (render shipped in PR #19).
This plan implements the spec'd dispatch and brings `reference.ts` along:
`--device-page` and `--strict` in `put`'s flag list, plus an HTML example.

Without this the [design-loop](../specs/behaviors/design-loop.md) chain's last link
(`check <html>` → `put <html> <dest>`) points at a refusal, so
[`design-loop-disclosure`](design-loop-disclosure.md) depends on this plan.

Out of scope: `--keep-ink` (tracked in issue #21); any change to PDF/EPUB/URL
dispatch.

## Implements

- `specs/commands/put.md` — the `.html` row of Source dispatch, "HTML sources and
  page geometry" (render at device box, lint findings alongside the upload,
  warn-not-block, `--strict` fatal on error findings), `--device-page`, and the
  `NO_DEVICE` failure row for HTML sources without a target

## Approach

- Dispatch `.html` through the same render path `render` uses (shared module, not a
  subprocess of our own CLI), producing a temp PDF that uploads as `format: pdf`;
  the temp file is cleaned up after upload since the cloud copy is the deliverable.
- Run the `check` lint on the rendered PDF and attach findings to the upload output
  in check's own findings shape; `--strict` turns error-severity findings into a
  failure *before* upload.
- `--device-page` forwards to the render path's existing `@page` override, with the
  same never-silent delta report.
- Replace the stale refusal: `.html` without Chrome fails as `MISSING_TOOL` naming
  what to install (same as `render`); without a device target, `NO_DEVICE` naming
  `setup device`.
- `reference.ts`: add both flags with one-line descriptions and an HTML example
  (`remarkable-axi put flyer.html /Designs`).

## Validation

- [x] `put flyer.html /Designs` renders at the device box and uploads a PDF —
      verified against real Chrome/Ghostscript with a mocked cloud client (the hard
      safety rule forbids a live-account call); `format: pdf` and a correct `page`
      disposition confirmed in the returned output
- [x] Lint findings appear in put's output for a problematic HTML source; exit stays
      0 without `--strict`, non-zero with `--strict` on error-severity findings
- [x] `--device-page` overrides a differing `@page` and reports the delta
- [x] HTML source with no device target fails `NO_DEVICE` naming `setup device`
- [x] HTML source without Chrome fails `MISSING_TOOL`; the stale "not implemented"
      wording is gone
- [x] `put --help` lists `--device-page` and `--strict` and shows an HTML example
- [x] Page-box injection and delta wording are byte-identical to `render`'s for the
      same source (shared implementation, not a copy) — verified with a test that
      calls both `render()` and `put()` on the same fixture and asserts the `page`
      strings are equal

## Risks / unknowns

- **Findings-in-upload output shape** — put's output gains a findings table; keep it
  check's exact shape so agents learn one schema. Watch total output size on long
  documents (findings collapse per distinct problem, so it should stay bounded).

## Notes

- **Shared implementation, not a copy**: `put`'s HTML path renders via the real
  `render()` command function (`--device-page` forwarded as a flag), then lints the
  PDF `render` produced via the real `check()` command function (`--no-images`) —
  no reimplementation of `@page` detection, injection, or the lint rules. `check`'s
  own `findings` value is passed through to `put`'s output unmodified, so the two
  commands can never drift on shape or wording.
- **`.htm` accepted alongside `.html`**: not called out in the plan's Scope, but
  `render`/`check` already dispatch both extensions identically via their own
  `HTML_EXTENSIONS` sets — leaving `put` `.html`-only would have been a new
  asymmetry, not a narrower scope.
- **`LINT_FAILED`**: the `--strict` fatal-on-error-finding path needed an error code
  the spec's Failure table didn't yet have. Chose `LINT_FAILED`, matching the
  existing `RENDER_FAILED`/`MISSING_TOOL` naming pattern; added to
  `specs/commands/put.md`'s Failure table along with a `MISSING_TOOL` row for
  HTML+no-Chrome (implied by the plan's Approach text but missing from the table).
  Also added a short output-shape example for the two new fields (`page`,
  `findings`) an HTML source adds.
- **Test isolation**: `put`'s HTML path has no `--device` flag of its own (by
  design — only `--device-page` and `--strict` are new), so
  `test/commands/put-html.test.ts` mocks `config.js` directly to control the
  resolved device target from a test, rather than swapping `$HOME` the way
  `render.test.ts`/`check.test.ts` do. That swap turned out not to isolate
  `config.ts` on this machine at all — see the filed issue below — so the new
  suite's approach is the one that actually works, not just the more convenient one.
- **`--strict` and real hairlines**: a genuine error-severity finding needs a
  sub-half-pixel rule at raster density; Chrome's own print path floors CSS
  sub-pixel widths to 1px, so an actually-rendered HTML fixture can't reach it (only
  a `pdf-lib`-authored vector fixture can, as `check.test.ts` already does for
  `check` itself). The two `--strict` tests mock `check()`'s return value for one
  call each to get a deterministic error finding, with `check()` passing through to
  the real implementation everywhere else in the suite.
- **Pre-existing, unrelated test failures observed while validating this plan**:
  `test/commands/render.test.ts` and `test/commands/check.test.ts` each have a
  "no device target and no --device fails NO_DEVICE" test that fails on this
  machine because it has a real paired `~/.config/remarkable-axi/config.json` and
  `config.ts` binds its config path at module-import time, so the tests'
  `process.env.HOME` swap never isolates it. Confirmed pre-existing via `git stash`
  before this plan's changes. Filed as
  [#34](https://github.com/JarvusInnovations/remarkable-axi/issues/34); not fixed
  here — out of this plan's scope.

## Follow-ups

- Issue [#34](https://github.com/JarvusInnovations/remarkable-axi/issues/34) —
  `config.ts` binds its config file path at module-import time via a top-level
  `homedir()` call, so `render.test.ts`/`check.test.ts`'s `NO_DEVICE` tests can't
  actually isolate it by swapping `$HOME` on a machine with a real paired config.
