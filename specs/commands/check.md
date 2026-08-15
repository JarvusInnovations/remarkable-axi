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
| `--no-images` | findings only |

`--pages` is a sparse spec, not a range: a long document is usually checked at a
handful of representative pages, and rasterizing the rest is wasted time. Findings are
still reported for every page — only the images are restricted.

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
| page box | page size differs from the device page box — the signed delta, per [page-geometry](../behaviors/page-geometry.md) |
| hairlines | rules and strokes thinner than one device pixel at the panel's density, which may not render at all |
| contrast | fills and text too few grey levels apart to separate on a 16-level panel |
| type size | text below the legible floor at the device's density |
| bleed | content falling outside the page box |
| QR | machine-readable codes that fail to decode as rendered, and the smallest scale at which they still decode |

The QR check reports a decode scale rather than a pass/fail, because the useful
question is not whether a code decodes at full resolution but whether it decodes from
across a room.

## Output

```
check: flyer.pdf, 1 page, rasterized at 226dpi (1404x1872)
page_box: 447x596pt — matches RM110
findings[2]{page,severity,check,detail}:
  1,warn,contrast,"#a8a8a8 rules on #fff — 2 levels apart on a 16-level panel"
  1,ok,qr,"decodes down to 98px page width (~across a room)"
images[1]{page,path}:
  1,/tmp/…/check-p1.png
help[1]: Run `remarkable-axi check flyer.html --pages 1` after editing to re-check
```

A document with nothing to report says so explicitly rather than emitting an empty
findings table.

## Relationship to the rest of the surface

- [render](render.md) produces; `check` inspects. They share the `@page` detection
  path and message, so they can never disagree about the page box.
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
