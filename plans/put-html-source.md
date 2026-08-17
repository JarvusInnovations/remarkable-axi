---
status: planned
depends: []
specs:
  - specs/commands/put.md
issues: []
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

- [ ] `put flyer.html /Designs` renders at the device box and uploads a PDF
- [ ] Lint findings appear in put's output for a problematic HTML source; exit stays
      0 without `--strict`, non-zero with `--strict` on error-severity findings
- [ ] `--device-page` overrides a differing `@page` and reports the delta
- [ ] HTML source with no device target fails `NO_DEVICE` naming `setup device`
- [ ] HTML source without Chrome fails `MISSING_TOOL`; the stale "not implemented"
      wording is gone
- [ ] `put --help` lists `--device-page` and `--strict` and shows an HTML example
- [ ] Page-box injection and delta wording are byte-identical to `render`'s for the
      same source (shared implementation, not a copy)

## Risks / unknowns

- **Findings-in-upload output shape** — put's output gains a findings table; keep it
  check's exact shape so agents learn one schema. Watch total output size on long
  documents (findings collapse per distinct problem, so it should stay bounded).

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
