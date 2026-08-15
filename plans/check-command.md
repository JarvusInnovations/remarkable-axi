---
status: done
pr: 20
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

- [x] `check <pdf>` rasterizes at the device density and reports page box status
- [x] `check <html>` renders first, then lints, in one call
- [x] `--pages` restricts images to those pages; findings still cover every page
      — verified with a single-page selection on a two-page doc; the
      `1,7-9` range/list syntax itself is `get.ts`'s own already-tested
      `parsePageSelection`, reused rather than reimplemented.
- [x] `--no-images` emits findings only
- [x] Sub-pixel rules are flagged; a rule at the resolvable width is not
- [x] Low-contrast text flagged with the level separation stated
- [x] Content outside the page box flagged as bleed
- [x] An uncalibrated device target is caveated once, not per finding
- [x] A clean document says so explicitly rather than emitting an empty table
- [x] Findings on a document with problems do not change the exit code
      — checked the actual process exit code (`0`) via the built CLI, not
      just that the command function doesn't throw.
- [x] Rasterizer absent → `MISSING_TOOL`; `doctor` reports it
- [x] Page-box detection shares render's implementation — one test suite, both commands
      — both commands call the same `detectPageBox`/`describeDelta`
      (`src/page.ts`); confirmed the two command-level test suites produce
      identical delta wording for the same declared-vs-device case.

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

Measurement architecture ended up raster-based rather than PDF-content-stream-based
for hairlines/contrast/type-size, a pivot made mid-implementation after two findings
during calibration:

- Ghostscript's default (non-antialiased) rasterization paints any touched pixel as
  fully opaque regardless of true coverage — a 0.1pt and a 2pt rule render
  indistinguishably by intensity. `-dGraphicsAlphaBits=4 -dTextAlphaBits=4` fixes
  this; integrating the antialiased coverage across a candidate rule's thickness
  recovers true sub-pixel width (calibrated against eleven synthetic rules from
  0.1pt-2pt — see `rasterize.ts`'s doc comment).
- A pure PDF-content-stream reading (line widths, fill colors, `Tf` sizes) would have
  missed the single most realistic case check.md itself calls out — a scanned
  document, which is one full-page embedded image with no vector content at all.
  Raster analysis handles vector PDFs, HTML-rendered PDFs, and scanned PDFs
  uniformly, since it measures what would actually reach the panel rather than what
  a producer declared.

Text-line detection (shared by `type size` and `contrast`) recovers each line's
visible height from per-row edge-transition density — no font, no glyph
segmentation. A real bug surfaced and was fixed during fixture testing: a lone
descender ("y", "g") briefly falling below the transition threshold split one visual
line into a normal band plus a tiny fragment that misread as its own much-smaller
"line" (a 17pt heading's descender measured 1.9pt on its own). Fixed by merging
adjacent bands whose gap is small relative to the taller one — see the doc comment
above `mergeAdjacentBands` in `rules.ts`.

Also fixed during testing: an initial absolute-brightness "ink" cutoff (anything
under grey level 128) silently missed genuinely low-contrast text, since very faint
text never gets that dark — exactly the case `contrast` exists to catch. Replaced
with a band-local percentile split (5th/95th percentile of the band's own pixel
values) that adapts to whatever contrast is actually present.

## Follow-ups

- None (scope decision, documented in `geometry.ts`): `bleed` only compares a page's
  CropBox against its MediaBox. It does not detect raster content overflowing the
  MediaBox itself when no CropBox is declared — a case that would require content
  extending past a page's own canvas, which well-formed PDF producers (including this
  tool's own `render`) don't produce. No urgency; revisit if a real document surfaces
  the gap.
- None (unverified, stated in code and in this PR): the antialiased-coverage
  calibration numbers in `rasterize.ts` and the `AA_BIAS_PX` correction in `rules.ts`
  were measured against this machine's Ghostscript 10.02.1. Behavior on other
  Ghostscript versions/builds is unverified.
- None (pre-existing constraint, not introduced here): `doctor`'s new `ghostscript`
  field has no test isolating the unpaired branch specifically, because
  `src/auth.ts` resolves its token path from `homedir()` at module load rather than
  per call, so a per-test `HOME` override can't isolate it — the existing `chrome`
  field has the same gap. `test/commands/setup.test.ts` asserts the field's presence
  in whichever branch the environment naturally reaches instead.
- None (unverified per `specs/behaviors/device-calibration.md`, by design): the
  `contrast` rule's 16-level premise and the `type size` rule's stroke-to-height
  ratio are typographic/display approximations, not hardware measurements — both
  ship `warn` only, and resolving them isn't tracked as a fresh device-calibration
  axis distinct from the existing page-box/ink-placement/palette ones (issues
  #10-#13).
