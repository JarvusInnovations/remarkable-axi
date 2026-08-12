# remarkable-axi

[![npm](https://img.shields.io/npm/v/remarkable-axi.svg)](https://www.npmjs.com/package/remarkable-axi)
[![CI](https://github.com/JarvusInnovations/remarkable-axi/actions/workflows/ci.yml/badge.svg)](https://github.com/JarvusInnovations/remarkable-axi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Send articles and documents to a reMarkable tablet and manage its cloud files —
an [AXI](https://github.com/kunchenguid/axi) CLI built for agents to drive via
shell execution.

No `rmapi` binary, no Go toolchain, no Python. It talks to the reMarkable cloud
directly through [`rmapi-js`](https://github.com/erikbrinkman/rmapi-js), and
converts web articles to EPUB in-process.

```
$ remarkable-axi
bin: ~/.local/share/npm/bin/remarkable-axi
description: Send articles and documents to a reMarkable tablet and manage its cloud files
status: paired, 128 documents, 11 folders
recent[8]{type,path,modified}:
  epub,/Articles/One week of bugs,2h ago
  pdf,/Papers/Attention Is All You Need,1d ago
  ...
help[3]:
  Run `remarkable-axi ls --all` for all 128 documents
  Run `remarkable-axi send <url> --dir /Articles` to send a web article
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
| `send <url> [--dir <path>] [--title <t>]` | Fetch a web article, convert to EPUB, upload |
| `put <file> [<dir>]` | Upload a local PDF or EPUB |
| `replace <path> <file>` | Swap a document's contents, leaving exactly one at the path |
| `fetch <path> [--as pdf\|svg\|text]` | Render handwriting to PDF/SVG, or extract typed text (`--legible` for OCR) |
| `ls [<path>]` | List a folder's contents (`--all` for every document) |
| `find <pattern>` | Search names by substring or regex |
| `mkdir <path>` | Create a folder and every missing parent |
| `mv <path> <dest-dir>` | Move a document or folder |
| `rm <path>` | Move a document or folder to the trash |
| `login <code>` | Pair this machine |
| `doctor` | Check pairing, connectivity, and reachability |
| `devices` | List reMarkable models with screen specs and PDF page sizes |
| `setup device <model>` | Set the device to design for; its specs appear every session |
| `setup hooks` | Install SessionStart hooks for Claude Code, Codex, OpenCode |

Run `remarkable-axi <command> --help` for flags and examples.

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
  duplicate sibling names; when that happens the first entry wins for lookups.
- **`mkdir` is idempotent, the underlying API is not.** `putFolder` creates a
  second folder with the same name when called twice, so every segment is
  checked before it is created.
- **Deleting a folder does not delete its contents.** The API moves only the
  folder to the trash, stranding its children. `rm` refuses a non-empty folder
  unless you pass `--force`, and tells you how many items are affected.
- **There is no in-place content update, so `replace` is a verified composite.**
  `updateDocument` only patches metadata and `putDocumentArchive` — the one call
  that can keep a document's id — takes a full archive and is experimental. So
  `replace` uploads first (a failed upload leaves the original intact), removes
  the superseded entry by **id** rather than by path, and then verifies exactly
  one document remains. It refuses outright when a path is already ambiguous
  rather than picking a victim.
- **Uploads are PDF and EPUB only** — that is the cloud's limit, not this
  tool's. Use `send` to turn a web page into an EPUB.
- **Handwriting renders to vector PDF and SVG.** `fetch` reads the device's
  stroke files directly and emits paths, so output is vector and an agent can
  read the PDF for vision without a rasterizer. Extended pages are handled:
  a single page can run several sheet-heights deep, so the output frame follows
  the ink rather than the nominal sheet size.
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
  rather than a screen property it should hold across devices, though only one
  has been calibrated. Ink drawn past the page edge is real — the device allows
  it — so `--overlay` counts and reports it rather than clipping.

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

## License

MIT
