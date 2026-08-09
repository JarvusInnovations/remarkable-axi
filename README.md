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
| `ls [<path>]` | List a folder's contents (`--all` for every document) |
| `find <pattern>` | Search names by substring or regex |
| `mkdir <path>` | Create a folder and every missing parent |
| `mv <path> <dest-dir>` | Move a document or folder |
| `rm <path>` | Move a document or folder to the trash |
| `login <code>` | Pair this machine |
| `doctor` | Check pairing, connectivity, and reachability |
| `setup hooks` | Install SessionStart hooks for Claude Code, Codex, OpenCode |

Run `remarkable-axi <command> --help` for flags and examples.

## Agent integration

`remarkable-axi setup hooks` registers a SessionStart hook so an agent begins
every session already knowing what's on the tablet, with no invocation needed.
Claude Code and Codex get native hooks; OpenCode gets a managed plugin.

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
- **Uploads are PDF and EPUB only** — that is the cloud's limit, not this
  tool's. Use `send` to turn a web page into an EPUB.
- **Fetching handwritten notes is not implemented.** Rendering reMarkable
  `.rm` stroke files has no JavaScript implementation; the only maintained
  renderer is the Python `rmc`. Pulling annotated PDFs is tractable and is the
  obvious next addition.

## Development

```sh
bun install
bun run check    # type-check
bun run test     # unit tests (vitest)
bun run build    # bundle to dist/bin/remarkable-axi.js
bun run dev      # run from source
```

The build bundles with esbuild rather than emitting plain files. That is load-
bearing: `rmapi-js` imports `crc-32/crc32c` without a file extension and
`crc-32` ships no `exports` map, so Node's ESM resolver cannot resolve it —
unbundled output fails to start under plain `node`.

## License

MIT
