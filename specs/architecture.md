# Architecture

## Runtime and distribution

- **Source** is TypeScript, developed and tested under `bun` (see `.tool-versions`).
- **Build** bundles to a single file at `dist/bin/remarkable-axi.js` via esbuild
  (`scripts/build.ts`), so `npx -y remarkable-axi` fetches one file rather than
  installing a dependency tree. esbuild also lowers `await using`, which `rmapi-js`
  uses internally.
- **Published runtime floor** is declared in `package.json` `engines`. The floor is
  whatever the bundle's dependencies actually require at runtime, not whatever the
  source happens to compile under. When a dependency starts using a newer language
  or standard-library feature, the floor moves with it in the same commit.
- **Version** is stamped into the bundle at build time (`src/version.ts`); a source
  checkout reports `0.0.0-dev`.

## Cloud access

All reMarkable cloud access goes through `rmapi-js`. The tool does not speak the
sync protocol directly.

The relevant shape of that API:

- The document tree is **content-addressed with a generation counter**.
  `getRootHash()` returns `{hash, generation}` in one request and is the only call
  whose cost is independent of account size.
- Everything below the root is keyed by hash: the root index lists every document
  with its own hash, and a document's metadata, content, and per-page `.rm` stroke
  files are separately addressed blobs.
- Mutations are root-rewrites guarded by the generation counter; a stale generation
  raises and is retried.
- `delete` is `move(ref, TRASH_ID)` — the cloud has no hard delete exposed here.
- There is **no in-place content update**. `putDocumentArchive` round-trips a
  document's full file set, but is marked experimental and is documented to assign
  the reuploaded copy a **fresh** document id — it does not preserve one. So content
  swaps are composites: upload the new document, then move the superseded one to
  trash. See [ink-preservation](behaviors/ink-preservation.md#carrying-ink-forward-not-yet-shipped)
  for what this ruled out when porting a document's ink onto its replacement was
  investigated.
- Uploads accept **PDF and EPUB only**. Every other input format is converted before
  it reaches the cloud.

## Command surface has one source

`src/reference.ts` describes the entire command surface — usage, summary, flags,
examples, grouped for display. The home view's help lines, every `--help` block, and
the generated SKILL.md region derive from it. Help text exists nowhere else, so
documentation cannot drift from the surface it documents.

Adding or changing a command means changing `reference.ts` first.

Help output is itself output: the top-level listing and every `--help` block are
TOON, the same as every other response — `usage:`, `commands[n]:`, `flags:`,
`examples:` as TOON keys, never a prose manpage, and never a mix of the two in one
response. String-list values such as `help[]` arrays emit in **block form** (one
line per entry) rather than inline, so entries never need comma-and-quote escaping
and stay readable at any length.

## Local state

`~/.config/remarkable-axi/` holds:

- `token` — the device pairing token from `login`.
- device target — the model chosen by `setup device`, which supplies page geometry
  to every command that produces or evaluates a document.
- cached tree state — see [cloud-cache](behaviors/cloud-cache.md).

Nothing else is persisted. The tool holds no database and no document cache beyond
what that behavior spec defines.

## Rendering

Two rendering directions, deliberately separate:

- **Down** — `.rm` stroke files parse to vector paths and emit as PDF or SVG
  (`src/strokes.ts`, `src/render.ts`). Vector output means a vision model can read
  the result without a rasterizer.
- **Up** — HTML becomes a PDF at the target device's page box via headless Chrome.
  Chrome is an optional external dependency, discovered at run time and reported by
  `doctor`; commands that need it fail with an actionable error when it is absent
  rather than degrading silently.

Rasterization (for `check`) uses Ghostscript, discovered and reported the same way.

## Timeouts

Every cloud call runs under a deadline (`src/timeout.ts`), default 120s, overridable
with `REMARKABLE_TIMEOUT` (`0` waits indefinitely). A stall fails with a structured
error rather than hanging a session.
