# Command: get

## Usage

```
get <path> [<dest>]
```

Bring a document down off the tablet. `<dest>` is a local path, defaulting to
`./<name>.<ext>` in the working directory.

`get` is the mirror of [put](put.md): same argument order, same path semantics,
opposite direction.

## Flags

| Flag | Effect |
| --- | --- |
| `--as <fmt>` | `original`, `pdf` (default), `svg`, or `text` |
| `--pages <spec>` | page numbers and ranges, e.g. `1,3,7-9` (default: all) |
| `--fit <mode>` | `page` (default) keeps the sheet; `content` crops to the ink |
| `--overlay` | draw ink over the original document, on the correct pages |
| `--legible` | rebalance stroke weight for reading and OCR (implies `--fit content`) |

## Formats

| `--as` | Result |
| --- | --- |
| `original` | the file as uploaded — the PDF or EPUB itself, unmodified |
| `pdf` | handwriting rendered to vector PDF, all pages |
| `svg` | handwriting rendered to vector SVG, one page |
| `text` | typed text extracted |

`original` closes the gap that made this command necessary. Before it, a document
could be sent to the tablet and never retrieved: the tool could render ink but not
return the file it was drawn on. A notebook has no original, so `--as original` on one
fails with a structured error pointing at the render formats.

## Rendering

Output is vector, so a vision model can read the result without a rasterizer. Extended
pages are handled: a single page may run several sheet-heights deep, and the output
frame follows the ink rather than the nominal sheet.

`--legible` trades fidelity for recognition and its output is deliberately not what
the device shows. `--overlay` places ink over the original document using the
calibrated placement transform; ink drawn past the page edge is real, so it is counted
and reported rather than clipped.

## Success output

```
wrote:
  path: ./Draft.pdf
  from: /Papers/Draft
  format: pdf
  pages: 12
```

## Failure

| Condition | Code |
| --- | --- |
| nothing at `<path>` | `NOT_FOUND` |
| `<path>` resolves to several documents | `AMBIGUOUS` |
| `--as original` on a notebook | `NO_ORIGINAL`, naming the render formats |
| `--pages` outside the document's range | `USAGE` |
| destination exists | `EXISTS` unless `--force` |

## Principles

**Inherited** — project principles that especially bite here:

- [One verb per direction; the source type dispatches](../principles.md#one-verb-per-direction-the-source-type-dispatches)
  — `get` is the second and last data-movement verb; `--as` selects a representation,
  not a different operation.
- [Measure the device; never ship a guessed constant](../principles.md#measure-the-device-never-ship-a-guessed-constant)
  — `--overlay` placement and `--legible` weighting both rest on recorded calibrations.
