---
status: done
depends: [put-html-source]
specs:
  - specs/behaviors/design-loop.md
  - specs/commands/page.md
  - specs/commands/check.md
issues: []
pr: 36
---

# Teach the design loop through the tool's own hints

## Scope

Make the page-design workflow — `page` → author → `check` + read the page image →
iterate → `put` — discoverable from the CLI's own output alone, per
[design-loop](../specs/behaviors/design-loop.md): the home-view design entry hint,
`page`'s check hint, and `check`'s eye-pass and put hints. Also the self-explaining
transposed-page-box finding in `check`, so a landscape design no longer needs
outside knowledge to interpret.

Out of scope: preview-scaled images and the `--full-res` hint
([`check-preview-images`](check-preview-images.md)); TOON `--help` and block-form
help arrays ([`help-format-conformance`](help-format-conformance.md)). The
`--full-res` hint ships with the preview plan since it only exists once preview
scaling does.

## Implements

- `specs/behaviors/design-loop.md` — the whole behavior
- `specs/commands/page.md` — the check hint appended to both output forms
- `specs/commands/check.md` — the eye-pass and put help lines; the transposed
  page-box finding wording

## Approach

All hint text lands in or beside `src/reference.ts` so the single-source rule holds;
the home-view hint joins the standing suggestions the home view already emits, and
the per-command hints are emitted by their commands' output paths.

- Home view: add the design entry line to the standing help suggestions — in the
  populated branch *and* the paired-zero-documents branch (an empty tablet is a
  prime candidate for a designed page).
- Depends on [`put-html-source`](put-html-source.md): the chain's `put` hint
  carries the checked HTML file forward, which today `put` refuses — the hint must
  never point at a command that fails.
- `page`: append the check hint to both the plain and `--css` outputs.
- `check`: when images were written, prepend the eye-pass hint naming the first
  image path, and append the put hint carrying the checked file as source with
  `<dest>` as placeholder. This replaces the current "Open the page images above"
  line — and fixes a real gap: today an HTML source gets only the re-check hint and
  is never pointed at its images at all.
- Transposed box: in the page-box rule, detect width/height exactly swapped against
  the device box and emit the landscape wording from the spec instead of the raw
  signed delta.

No enforcement anywhere: hints only, per the behavior's local principle.

## Validation

- [x] Home view help includes the `page --css` design entry line
- [x] `page` and `page --css` both end with the check hint
- [x] `check` with images emits the eye-pass hint naming a real written image path,
      and the put hint carrying the checked file
- [x] `check --no-images` emits neither eye-pass nor put hint
- [x] A landscape page (device box transposed) produces the self-explaining finding,
      not a raw delta; a genuinely mismatched box still produces the signed delta
- [x] All hint strings live in/derive from `reference.ts`-adjacent single source —
      no duplicated wording in command modules

## Risks / unknowns

- **Hint noise on non-design checks** — `check` on a downloaded deck also gets the
  eye-pass hint. Judged acceptable: the hint is one line and reading the image is a
  sensible next step for any checked document; revisit if it reads as noise in
  practice.

## Notes

Hint text landed in a new `src/hints.ts` (`DESIGN_ENTRY_HINT`, `CHECK_ITERATE_HINT`,
`eyePassHint()`, `putHint()`), kept beside `reference.ts` rather than folded into it —
`reference.ts` is the command-surface (usage/flags/`--help`) single source, and this
module is the analogous single source for this one behavior's runtime hint content.

`check`'s help composition: eye-pass and put now fire whenever images were written,
regardless of source type (PDF or HTML) — the HTML-only re-check hint is unchanged and
now lands last rather than replacing the other two. Order in the array: eye-pass,
`--full-res` escape hatch (when applicable), put, re-check.

The transposed-box wording lives in `pageBoxFinding` (`src/lint/geometry.ts`), the
finding-text builder `check` alone calls — not in the shared `describeDelta`/
`detectPageBox` (`src/page.ts`). `render`'s `page:` disposition line and `check`'s own
`page_box:` summary line both call `describeDelta` directly and are unchanged, so
`specs/behaviors/page-geometry.md`'s "shared rule, two dispositions" guarantee holds:
only the per-page `page box` *finding* gets the new wording.

`check.md`'s worked output example shows the HTML-only re-check hint attached to a
`flyer.pdf` filename — that predates this change and is an artifact of the doc's
illustrative filenames already being inconsistent (mixing `flyer.pdf`/`flyer.html`
across revisions), not a signal that re-check should fire for PDFs. Implemented per
the plan's explicit approach instead: re-check stays HTML-source-only.

All validation boxes verified via automated tests plus manual local smoke tests of
`page`, `page --css`, and `check` against a hand-built landscape HTML fixture — no
cloud calls made, per this task's paired-real-device safety rule.

`bun run check` and `bun run build` are clean. `bun run test`: 380 passed, 2 failed —
both failures are `"no device target and no --device fails NO_DEVICE"` in
`check.test.ts` and `render.test.ts`, the pre-existing environmental issue tracked as
issue #34, present on `develop` before this branch and unrelated to this change.

PR: <https://github.com/JarvusInnovations/remarkable-axi/pull/36> (open, not merged).

## Follow-ups

None identified.
