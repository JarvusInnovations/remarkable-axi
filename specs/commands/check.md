# Command: check

## Usage

```
check <file> [--pages <spec>]
```

Rasterize a document at the target device's native resolution and report what will
not survive the panel. `<file>` is a PDF or an HTML document.

One call answers "will this read on the tablet" and hands back the evidence to look
at — findings and page images together, so the agent inspecting an image already
knows what to look for.

## Flags

| Flag | Effect |
| --- | --- |
| `--pages <spec>` | page numbers and ranges to rasterize, e.g. `1,3,7-9` (default: all) |
| `--device <model>` | check against a model other than the configured target |
| `--out <dir>` | where the page images are written (default: a temp directory, reported) |
| `--full-res` | write page images at the device's native resolution instead of preview scale |
| `--no-images` | findings only |

`--pages` is a sparse spec, not a range: a long document is usually checked at a
handful of representative pages, and rasterizing the rest is wasted time. Findings are
still reported for every page — only the images are restricted.

### Page images are previews by default

The written page images are downscaled to fit within **1568px on the long edge**
(never upscaled). That number is the ceiling of what agent vision ingests — larger
images are downscaled by the model anyway — so a preview at this scale is lossless
to the agent by construction, while staying crisp enough for a human in the review
loop to judge layout and read body text. What it buys is a bounded, predictable cost
per image on any harness, including ones that pass images through at full size.

Two things do not vary with the preview scale:

- **Findings are always measured at native density.** Rasterization for the lint
  rules happens at the device's own resolution regardless of what image is written;
  the scale affects only the artifact handed back.
- **The native size is always stated** in the output next to the preview size — the
  `image_scale:` line, emitted exactly when a downscale happened — so a smaller
  image can never pass for the full measurement. (At native scale the header's own
  `rasterized at …` line is the size statement, and the line is omitted.)

`--full-res` writes native-resolution images instead, for the cases the preview
genuinely underserves: a human inspecting line work pixel-for-pixel, or a caller
running content-level verification (a barcode decode, an OCR pass) on the images.
Whenever images were written at preview scale, the output's help lines **must**
include the `--full-res` invocation — the escape hatch is advertised at the moment
it applies, never left for the reader to discover in `--help`.

## Input

| `<file>` | Handling |
| --- | --- |
| `.pdf` | rasterized directly |
| `.html` | rendered first, exactly as [render](render.md) would, then rasterized |

Accepting a PDF is the point, not an implementation detail. Most documents that reach
a tablet — decks, papers, briefs, scans — were produced elsewhere, and "will this
deck read on the panel" is the same question answered by the same measurements as
"will my generated flyer read on the panel." Tying the check to an HTML source would
discard that.

Accepting HTML collapses the authoring loop to one call: render and lint together
while iterating, rather than rendering to a file and checking it separately.

## Findings

Each finding carries a page, a severity, and the measurement behind it. Severity is
`error` when the content will not be readable and `warn` when it is degraded.

| Check | Detects |
| --- | --- |
| page box | page size differs from the device page box — the signed delta, per [page-geometry](../behaviors/page-geometry.md). When the page box is exactly the device box **transposed**, the finding says so — a landscape page reads on the portrait panel by panning or device rotation, which is expected for a landscape design and not a defect, and the finding's wording must make that interpretation available without folklore |
| hairlines | rules and strokes thinner than one device pixel at the panel's density, which may not render at all |
| contrast | fills and text too few grey levels apart to separate on a 16-level panel |
| type size | text below the legible floor at the device's density |
| bleed | content falling outside the page box |

Every rule here answers a question about **the panel** — will this mark survive the
device's resolution, its grey range, its page box. That is the scope. Content-specific
verification does not belong in it: checking that a barcode still decodes, that a chart
is readable, that a table did not overflow are all things a caller can do on the page
images `check` already hands back, and each one would drag in a dependency for a case
most documents do not have.

The rasterized pages are the extension point. `check` measures the medium; the caller
measures the content.

### Severity is bounded by what has actually been measured

A finding may only reach `error` when everything its threshold rests on was measured
rather than assumed. In practice that leaves **hairlines** as the only rule able to
raise one, because its threshold is arithmetic on the device's own density — and even
then only when the rasterizer in use is the one its antialiasing correction was
calibrated against. On any other rasterizer release the measurement still stands but
the correction does not, so the finding is reported at `warn` and says why.

`contrast` never exceeds `warn` at all: the panel's grey separation is a published
figure nobody here has measured on hardware.

This is the same discipline as [device-calibration](../behaviors/device-calibration.md),
applied to the measuring instrument instead of the device. A linter that raises
confident errors from unverified constants teaches an agent to ignore it, which is
worse than having no linter — see
[Best-effort operations report per-item outcomes](../principles.md#best-effort-operations-report-per-item-outcomes).

## Output

```
check: flyer.pdf, 1 page, rasterized at 226dpi (1404x1872)
page_box: 447x596pt — matches RM110 (calibrated)
findings[2]{pages,severity,check,detail}:
  "1-10",warn,contrast,"#a8a8a8 rules on #fff — 2 levels apart on a 16-level panel"
  "1,4-9",warn,hairlines,"0.4pt rule — below 0.7pt resolvable at 226dpi"
image_scale: 1176x1568 (preview of native 1404x1872)
images[1]{page,path}:
  1,/tmp/…/check-p1.png
help[4]:
  Read /tmp/…/check-p1.png to critique the layout by eye — findings measure the panel, not the design
  Run `remarkable-axi check flyer.pdf --full-res` for native-resolution images
  Run `remarkable-axi put flyer.pdf <dest>` once the layout reads well
  Run `remarkable-axi check flyer.pdf --pages 1` after editing to re-check
```

The first and third help lines are the [design-loop](../behaviors/design-loop.md)
chain; the second is the preview escape hatch required above whenever images were
written at preview scale.

A document with nothing to report says so explicitly rather than emitting an empty
findings table.

### One row per distinct problem, not per page

A finding carries the **pages** it was seen on, not a single page, and identical
findings — same check, same severity, same measurement — collapse into one row.

Page geometry belongs to the document and a template rule repeats on every page that
uses the template, so reporting either per page multiplies one fact by the page count.
A real ten-page deck produced twenty-one findings describing three problems, the
page-box mismatch ten times over. That is the same noise the thresholds above were
tuned to avoid, arriving through a different door: a finding an agent has already read
nine times is one it learns to skip.

Collapsing loses nothing — every page a finding applies to is still named, so the
coverage guarantee `--pages` must not weaken is unaffected. What changes is that the
finding count reflects distinct problems rather than page count.

## Relationship to the rest of the surface

- [render](render.md) produces; `check` inspects. They share the `@page` detection
  path and message, so they can never disagree about the page box.
- [design-loop](../behaviors/design-loop.md) makes `check` the center of the page
  authoring loop: its output carries the eye-pass and `put` hints of that chain.
- [put](put.md) runs the same lint on an HTML source and reports findings alongside
  the upload, warning by default and failing under `--strict`.
- [ink-preservation](../behaviors/ink-preservation.md) reuses this rasterizer to
  measure page similarity when carrying ink onto a replacement document.

That shared rasterizer is a sign the factoring is right: the same measurement answers
"is this legible", "did the page box change", and "did the content move under the
ink".

## Failure

| Condition | Code |
| --- | --- |
| source missing | `NOT_FOUND` |
| source neither PDF nor HTML | `USAGE` |
| no device target and no `--device` | `NO_DEVICE`, naming `setup device` |
| rasterizer not found | `MISSING_TOOL`, naming what to install and that `doctor` checks it |

Findings never set a non-zero exit on their own — `check` succeeded in checking. Exit
codes report whether the *check* could run, not what it found.

## Principles

**Inherited** — project principles that especially bite here:

- [The tablet is a design target, not just a destination](../principles.md#the-tablet-is-a-design-target-not-just-a-destination)
  — this command is how that principle becomes verifiable.
- [Measure the device; never ship a guessed constant](../principles.md#measure-the-device-never-ship-a-guessed-constant)
  — every finding reports the measurement, not a verdict alone.
- [Best-effort operations report per-item outcomes](../principles.md#best-effort-operations-report-per-item-outcomes)
  — findings are per page, and a restricted `--pages` never silently narrows them.
