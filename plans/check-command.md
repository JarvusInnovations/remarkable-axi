---
status: planned
depends: [render-command]
specs:
  - specs/commands/check.md
issues: []
---

# Lint a document against the panel

## Scope

Add `check`: rasterize a PDF or HTML document at the device's native resolution, run
the lint rules, and return findings alongside page images in one call.

## Implements

- `specs/commands/check.md`

## Approach

The rules exist because each one has already cost a render cycle to discover by eye:
gradient-band rules that vanished when rasterized, grey text a panel cannot separate,
a QR code with too little quiet zone to decode reliably, a page box that under-fills
the panel.

Ship the five rules in the spec — page box, hairlines, contrast, type size, bleed.
The thresholds are the part that needs care: derive each from the device density and
panel level count rather than picking round numbers, and report the measurement in
every finding so a false positive is arguable rather than opaque.

Every rule is about **the panel**, and that boundary is deliberate. Content-specific
verification — does this barcode still decode, is this chart readable, did this table
overflow — belongs to the caller, who has the rasterized pages and knows what the
document is supposed to say. Pulling any of it in would add a dependency for a case
most documents do not have. The page images are the extension point.

`--pages` restricts *images*, never findings. A long document is checked at a handful
of representative pages, and silently narrowing the findings to match would let a
partial check read as a complete one.

Findings never set a non-zero exit. `check` succeeded in checking; the exit code
reports whether it could run, not what it found.

## Validation

- [ ] `check <pdf>` rasterizes at the device density and reports page box status
- [ ] `check <html>` renders first, then lints, in one call
- [ ] `--pages 1,7-9` restricts images to those pages; findings still cover every page
- [ ] `--no-images` emits findings only
- [ ] Sub-pixel rules are flagged; a rule at the resolvable width is not
- [ ] Low-contrast text flagged with the level separation stated
- [ ] Content outside the page box flagged as bleed
- [ ] An uncalibrated device target is caveated once, not per finding
- [ ] A clean document says so explicitly rather than emitting an empty table
- [ ] Findings on a document with problems do not change the exit code
- [ ] Rasterizer absent → `MISSING_TOOL`; `doctor` reports it
- [ ] Page-box detection shares render's implementation — one test suite, both commands

## Risks / unknowns

Threshold calibration is the whole difficulty. Too tight and every document produces
noise an agent learns to ignore, which is worse than no linter. Each threshold should
be justified against a rendered sample before shipping, and the ones that cannot be
justified should ship as `warn` rather than `error`.

The panel's effective grey separation is a display property that has not been
measured on hardware; the 16-level figure is from published specs. The contrast rule
rests on it, and on an uncalibrated model it rests on a figure for hardware nobody
verified — see `specs/behaviors/device-calibration.md`.

## Notes

## Follow-ups
