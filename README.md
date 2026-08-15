# remarkable-axi

[![npm](https://img.shields.io/npm/v/remarkable-axi.svg)](https://www.npmjs.com/package/remarkable-axi)
[![CI](https://github.com/JarvusInnovations/remarkable-axi/actions/workflows/ci.yml/badge.svg)](https://github.com/JarvusInnovations/remarkable-axi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Send articles and documents to a reMarkable tablet, design pages *for* its panel,
and pull handwriting back off it — an [AXI](https://github.com/kunchenguid/axi)
CLI built for agents to drive via shell execution.

No `rmapi` binary, no Go toolchain, no Python. It talks to the reMarkable cloud
directly through [`rmapi-js`](https://github.com/erikbrinkman/rmapi-js), and
converts web articles to EPUB in-process.

```
$ remarkable-axi
bin: ~/.local/share/npm/bin/remarkable-axi
description: Send documents to a reMarkable tablet, design pages for its panel, and pull handwriting back off it
status: paired, 128 documents, 11 folders
recent[8]{type,path,modified}:
  epub,/Articles/One week of bugs,2h ago
  pdf,/Papers/Attention Is All You Need,1d ago
  ...
help[3]:
  Run `remarkable-axi ls --all` for all 128 documents
  Run `remarkable-axi put "<url>" /Articles` to send a web article
  Run `remarkable-axi ls <path>` to browse a folder
```

## Install

```sh
npm install -g remarkable-axi
```

Or run it without installing:

```sh
npx -y remarkable-axi
```

## Pair

Get an 8-character code from
<https://my.remarkable.com/device/desktop/connect>, then:

```sh
remarkable-axi login abcdefgh
```

The device token is written to `~/.config/remarkable-axi/token` with `0600`
permissions. Set `REMARKABLE_TOKEN` instead to supply it from the environment
without touching disk — useful in CI and containers.

Verify with `remarkable-axi doctor`.

## Commands

| Command | Description |
| --- | --- |
| `page` | The target device's page box, and the CSS to author against it — no cloud call |
| `render <html>` | Print HTML to a PDF at exactly that page box |
| `check <file>` | Rasterize a PDF or HTML at the panel's density and lint what won't survive it |
| `put <src> <dest>` | Upload a local PDF/EPUB or a URL — source first, destination last (`--replace` to swap an existing document's contents) |
| `get <path> [<dest>]` | Bring a document down: rendered ink, typed text, or `--as original` for the byte-identical upload |
| `ls [<path>]` | List a folder's contents (`--all` for every document) |
| `find <pattern>` | Search names by substring or regex |
| `mkdir <path>` | Create a folder and every missing parent |
| `mv <path> <dest-dir>` | Move a document or folder |
| `rm <path>` | Move a document or folder to the trash |
| `login <code>` | Pair this machine |
| `doctor` | Pairing, connectivity, external tools, duplicate paths, and cache state |
| `devices` | reMarkable models with screen specs, page boxes, and calibration status |
| `setup device <model>` | Set the device to design for; its specs appear every session |
| `setup hooks` | Install SessionStart hooks for Claude Code, Codex, OpenCode |

Run `remarkable-axi <command> --help` for flags and examples.

## Designing for the panel

Most documents that reach a tablet were authored *for* it, and the device does
not scale a page to fit: it renders at natural physical size at ~227dpi and lets
you pan. A page that is not exactly the panel's box under-fills the screen or has
to be scrolled to read. So the geometry is the tool's job, not yours.

```sh
remarkable-axi page --css        # the numbers, and a block to paste
```

```
device: RM110 (reMarkable 2)
screen: 1404x1872 @ 226dpi
page: 447x596pt
css: |
  @page { size: 447pt 596pt; margin: 0; }
  :root { --page-w: 447pt; --page-h: 596pt; }
  html, body { width: 447pt; height: 596pt; margin: 0; }
```

Then author, and lint what you made against the panel rather than against a
monitor:

```sh
remarkable-axi check flyer.html      # renders, rasterizes, and reports
remarkable-axi put flyer.html /Talks # renders internally, then uploads
```

`check` rasterizes every page at the device's native density and measures five
things the panel actually cares about — page box, hairlines too thin to resolve,
fills too few grey levels apart to separate, type under the legible floor, and
content outside the page box — then hands back the page images alongside the
findings so you can see what each one points at.

Every rule is about the **medium**. Whether a barcode still decodes or a chart
still reads is the caller's question, answered on the images `check` already
returns; pulling that in would drag a dependency in for a case most documents
do not have.

Findings collapse: identical ones carry the pages they were seen on rather than
repeating. A real ten-page deck reports three problems, not twenty-one.

```
check: deck.pdf, 10 pages, rasterized at 226dpi (1404x1872)
page_box: 612x792pt — 165pt wider, 196pt taller than RM110's 447x596pt box
findings[3]{pages,severity,check,detail}:
  1-10,warn,page box,"612x792pt — 165pt wider, 196pt taller than the device box"
  "1-2,4-9",error,hairlines,0.11pt rule — below 0.32pt resolvable at 226dpi
  "3",warn,type size,text ~2.23pt tall — below the ~3.82pt legible floor
```

`render` and `check` share one `@page` detection path, so they can never
disagree about the page box. An explicit `@page` you declared is **honored and
reported**, never silently overridden — the surrounding layout was written
against it, so substituting a different box would invalidate every dimension
built on top.

HTML rendering needs Chrome and linting needs Ghostscript; both are discovered
at run time and reported by `doctor`, and their absence is a structured error
naming what to install rather than a silent degradation.

## Calibration — and what we can't measure alone

This project's rule is that a number is either measured on hardware or labelled
as not measured. `devices` says which is which:

```
devices[5]{model,name,screen,dpi,pagePt,calibration,target}:
  RM100,reMarkable 1,1404x1872,226,447x596pt,unverified (published specs),no
  RM110,reMarkable 2,1404x1872,226,447x596pt,page box verified,no
  RM02A,reMarkable Paper Pro,1620x2160,229,509x679pt,calibrated,no
  RM03A,reMarkable Paper Pro Move,954x1696,264,260x463pt,unverified (published specs),no
  RM102,reMarkable Paper Pure,1404x1872,226,447x596pt,unverified (published specs),no
```

Three axes are tracked per model, independently: **page box**, **ink placement**,
and **pen palette** (`n/a` on monochrome hardware — no mapping is ever owed).
Everything below Paper Pro inherits published density figures and an ink constant
measured on one device, and commands say so once per invocation rather than
presenting inferred numbers as measured ones.

**This is where we need people with the hardware.** Each unverified model has an
issue carrying the full procedure, written so it needs the device rather than
knowledge of this codebase: [#10 rM2](https://github.com/JarvusInnovations/remarkable-axi/issues/10),
[#11 rM1](https://github.com/JarvusInnovations/remarkable-axi/issues/11),
[#12 Paper Pro Move](https://github.com/JarvusInnovations/remarkable-axi/issues/12),
[#13 Paper Pure](https://github.com/JarvusInnovations/remarkable-axi/issues/13).

The page-box step takes seconds and needs no measuring at all: generate a page at
the derived box, open it, and toggle **fit-to-width against fit-to-height** with
the zoom menu open. If the box matches the panel the two fits resolve to the same
scale and **nothing moves** — any mismatch makes the page jump, and the flicker is
obvious in a way a static margin is not. That trick came from a contributor and is
how RM110's box got confirmed.

Partial results are welcome; the axes land one at a time and the label says which
part is real.

## Agent integration

`remarkable-axi setup hooks` registers a SessionStart hook so an agent begins
every session already knowing what's on the tablet, with no invocation needed.
Claude Code and Codex get native hooks; OpenCode gets a managed plugin.

Every cloud call has a 120s deadline, so a stalled request fails with a
structured `TIMEOUT` naming the operation instead of hanging silently. Set
`REMARKABLE_TIMEOUT=<seconds>` to change it, or `0` to wait indefinitely.

Output is [TOON](https://toonformat.dev), which is roughly 40% cheaper in
tokens than the equivalent JSON. Errors are structured on stdout so an agent
can read and act on them, and exit codes follow the AXI convention: `0` success
(including no-ops), `1` error, `2` usage error.

## Notes and limits

- **Paths are reconstructed client-side.** The cloud API exposes a flat list of
  entries with parent uuids and no path concept, so `remarkable-axi` builds the
  tree itself. Trashed and orphaned entries are excluded. The cloud permits
  duplicate sibling names, and the device and other clients create them freely,
  so a path can resolve to more than one document. Rather than pick a winner,
  every command refuses that path as `AMBIGUOUS` with the colliding ids — and
  `ls`, `find`, and `doctor` report duplicates whenever they see them, so the
  first you hear of one is not an unrelated command failing on it.
- **`mkdir` is idempotent, the underlying API is not.** `putFolder` creates a
  second folder with the same name when called twice, so every segment is
  checked before it is created.
- **Deleting a folder does not delete its contents.** The API moves only the
  folder to the trash, stranding its children. `rm` refuses a non-empty folder
  unless you pass `--force`, and tells you how many items are affected.
- **There is no in-place content update, so `put --replace` is a verified
  composite.** `updateDocument` only patches metadata, and `putDocumentArchive`
  — which round-trips a document's full file set — is experimental and is
  documented to assign the reuploaded copy a **fresh** document id rather than
  preserving one. (An earlier version of this README claimed the opposite;
  investigating ink portability is what caught it.) So `--replace` uploads first (a failed upload leaves the
  original intact), then renames the superseded document to a dated name and
  moves it to trash by **id** rather than by path. It refuses outright when a
  path is already ambiguous or already occupied without `--replace`, rather
  than picking a victim or silently landing a duplicate.
- **A URL's images are picked for the panel, not taken as served.** The device
  renders an EPUB at its own resolution, so renditions are chosen from `srcset`
  (`800w` widths and `2x` densities both) against the target panel's width: the
  smallest that still covers it, or the largest offered when nothing does.
  Taking `src` unconditionally loses in both directions — sites commonly default
  to a thumbnail with the real resolutions in `srcset` (250px against a 1404px
  panel is a 5.6x upscale), while others default to renditions larger than any
  panel. With no device target set the width is the widest panel any reMarkable
  has: an upper bound over hardware that exists rather than a guess about which
  one you own.
- **Uploads are PDF and EPUB only** — that is the cloud's limit, not this
  tool's. Pass a URL to `put` to turn a web page into an EPUB automatically.
- **Handwriting renders to vector PDF and SVG.** `get` reads the device's
  stroke files directly and emits paths, so output is vector and an agent can
  read the PDF for vision without a rasterizer. `--as original` skips
  rendering entirely and returns the uploaded file byte-identical. Extended
  pages are handled: a single page can run several sheet-heights deep, so the
  output frame follows the ink rather than the nominal sheet size.
- **`--legible` trades fidelity for recognition.** Stroke weight relative to
  letter size dominates whether handwriting can be read, by machine or by eye.
  A pen set thick and used to write small produces strokes almost as wide as
  they are long — one real page measured 0.90, where legible writing sits near
  0.1 — and letterforms merge into solid blobs. `--legible` rescales weight to
  that target, crops to the ink, darkens pale colours without flattening them
  to black, and fades highlighter wash. Weight is only ever reduced: thickening
  thin writing merges it, and going thinner than the target buys nothing at the
  resolutions a vision model sees while risking strokes dropping out. The
  output is deliberately not what the device shows.
- **Colour is measured, not guessed.** Highlighter and shader strokes carry a
  packed RGBA and come out exact. Pens store only a palette index, and no
  mapping ships for the colour ones, so the Paper Pro palette was read off a
  calibration page written on the device — grey, white, blue, red, green, cyan,
  magenta, yellow. Hues are faithful to those labels rather than sampled from
  the panel. An index that appears with two different RGBA values is treated as
  a "colour is in `colorRgba`" marker rather than a palette entry, which is how
  the highlighter behaves. Anything still unknown draws black and is reported
  as `unmappedColorIndices`.
- **Ink over an annotated PDF is opt-in, and calibrated.** The device's PDF
  layout transform is not in the synced data, so it was measured: a page of
  printed targets at known coordinates, annotated on the device and solved by
  least squares. A PDF page maps to ink `x [-803, 803]`, `y [0, 2141]`, fitted
  to width and anchored at the top, with residuals under 0.4 ink units and no
  per-page offset. Note this is unrelated to the reported `paperSize`, which
  for PDF-backed documents is a canonical 1404x1872 the ink freely exceeds —
  deriving the scale from it, as an earlier version did, places ink off-page.
  A second calibration at US Letter gave the *same* scale, which is what rules
  out a fit-to-screen model: the page is rendered at its natural physical size
  at ~227dpi and panned around, so the scale is a constant and the page box
  follows from the page's own dimensions. Because that is a rendering density
  rather than a screen property it should hold across devices, though it has only
  been *measured* on one. Ink drawn past the page edge is real — the device allows
  it — so `--overlay` counts and reports it rather than clipping.

- **The tree is cached against the root generation, not a clock.** The sync API
  is content-addressed under a monotonic generation counter, and one request for
  the root hash says whether anything changed at all. Unchanged, the whole cached
  tree is served outright; changed, only the documents whose own hash moved get
  refetched. There is no expiry to tune: an answer is provably current or
  provably stale. This matters because the ambient session view runs on a hook
  with a hard timeout, and an overrunning hook produces *no* output — a silent
  failure that looks like having no context rather than slow context. On a
  686-document account the view went from 8–13s to about 2s.
- **A mutation folds its own result into the cache but does not claim it is
  current.** Mutations are root-rewrites guarded by the generation counter, so a
  concurrent write from the device rebases yours onto it — meaning the root hash
  you would read back covers a change your local entries do not have. Recording
  it would make the next read a "cache hit" serving a tree silently missing that
  document, so the cache is left deliberately unvalidated and the next read
  reconciles.
- **A document's page count can exceed its PDF's.** The device appends pages to
  a PDF-backed document, and those pages carry ink like any other. So the page
  count reported by the cloud is the *device's* model of the document, not the
  file's — a one-page PDF drawn on can come back as two pages with two stroke
  files. Anything matching device pages to PDF pages has to account for pages
  with no PDF page behind them.

## Development

```sh
bun install
bun run check    # type-check
bun run test     # unit tests (vitest)
bun run build    # bundle to dist/bin/remarkable-axi.js
bun run dev      # run from source
```

The build bundles with esbuild rather than emitting plain files, so
`npx -y remarkable-axi` fetches one file instead of installing the whole
dependency tree. esbuild also lowers `await using`, which `rmapi-js` uses
internally, keeping the floor at Node 22.

`src/reference.ts` is the single place the command surface is described — the
ambient session view, every `--help` block, and the generated skill docs all
derive from it, so documentation cannot drift from what ships.

The project is spec-driven: `specs/` states what should be true and `plans/`
tracks the work bridging specs to code. `specs/principles.md` is the shortest
useful read — it is the decisive rules behind the design (one verb per
direction of travel; never manufacture a state the tool refuses to operate on;
report a mismatch rather than silently correcting the author; measure the
device or say you did not). If you are wondering *why* something behaves the
way it does, that file usually answers it.

## License

MIT
