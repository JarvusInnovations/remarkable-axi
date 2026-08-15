# Command: render

## Usage

```
render <html> [--out <path>]
```

Convert an HTML document to a PDF sized for the target device. `--out` is a file
path, defaulting to `./<name>.pdf` beside the source. PDF is the only output — the
flag chooses *where*, never *what*.

## Flags

| Flag | Effect |
| --- | --- |
| `--out <path>` | where to write (default: `./<name>.pdf`) |
| `--device <model>` | render for a model other than the configured target |
| `--landscape` | transpose the page box |
| `--device-page` | override the document's declared `@page` with the device page box |

## Behaviour

The document is printed by headless Chrome at the device page box, with `@page`
detection and injection exactly as defined in
[page-geometry](../behaviors/page-geometry.md) — including the rule that an explicit,
differing declaration is honored and reported rather than silently corrected.

`render` owns the details an author should not have to know: the print box rounding
to whole points, suppressing headers and footers, and waiting for the document to
settle before printing.

## Why it is separate from put

`put` renders HTML sources itself, so `render` is not on the path to the tablet. It
exists for the cases where the sized PDF *is* the deliverable — printing it,
archiving it, handing it to someone else — which would otherwise require uploading a
document just to get a local file back.

## Why it is separate from check

`render` produces the artifact; [check](check.md) inspects one. Keeping them apart is
what lets `check` accept documents this tool did not produce, which is the majority of
what reaches a tablet.

## Success output

```
rendered:
  out: ./flyer.pdf
  device: RM110
  page: 447x596pt (injected)
  pages: 1
help[1]: Run `remarkable-axi check ./flyer.pdf` to lint it for the panel
```

`page:` states whether the box was injected, matched, honored-with-a-delta, or
overridden. `--device-page` on a differing declaration produces a fourth
disposition — the device box is used, and the declaration it replaced is reported
with its delta so the override is never silent:

```
page: 447x596pt (overridden; declared 612x792pt, 165pt wider, 196pt taller)
```

## Failure

| Condition | Code |
| --- | --- |
| source missing or not HTML | `NOT_FOUND` / `USAGE` |
| no device target and no `--device` | `NO_DEVICE`, naming `setup device` |
| Chrome not found | `MISSING_TOOL`, naming what to install and that `doctor` checks it |
| Chrome fails or times out | `RENDER_FAILED`, with the cause extracted rather than the raw output |

## Principles

**Inherited** — project principles that especially bite here:

- [The tablet is a design target, not just a destination](../principles.md#the-tablet-is-a-design-target-not-just-a-destination)
  — the page box is enforced here, not left to the author.
- [Report the mismatch; do not silently correct the author](../principles.md#report-the-mismatch-do-not-silently-correct-the-author)
  — governs what happens to a differing `@page`.
