---
status: done
depends: [setup-ssh-device-status]
specs:
  - specs/commands/device.md
  - specs/behaviors/device-access.md
issues: []
pr: 41
---

# Device backup and orphan detection

## Scope

The read-only recovery commands: `device backup <path>` (tar a document's full
on-device file set to a local archive) and `device orphans [<path>] [--render]`
(stroke files no page index references, rendered for eye identification), plus
`doctor`'s device-block orphan count. Both are reads; the write ritual stays out
of scope until [`device-reattach`](device-reattach.md).

## Implements

- `specs/commands/device.md` — `device backup`, `device orphans`, doctor's orphan
  count
- `specs/behaviors/device-access.md` — device-side path resolution over the
  storage layout

## Approach

- Path resolution device-side: search `.metadata` visible names, walk `parent`
  uuids to reconstruct full paths; `AMBIGUOUS` lists colliding uuids. Works for
  trashed documents (`parent: "trash"`).
- `backup`: tar `<uuid>*` (metadata, content, strokes dir, thumbnails) over the
  ssh stream to a local `.tar.gz`; report indexed-page vs stroke-file counts and
  flag the excess as orphans.
- `orphans`: parse each doc's `.content` pages list; report `.rm` files absent
  from it with size, mtime, thumbnail availability. Zero-stroke files (parse the
  header; they hold nothing recoverable) reported as a count, never as orphan
  rows. `--render` pulls the orphaned `.rm` files and composites them through the
  existing strokes pipeline at check's preview scale, alongside their surviving
  thumbnails.
- `reference.ts` gains both commands; skill region regenerated (CI enforces).
- Tests: fixture xochitl trees exercised through the mocked exec layer; `.rm`
  parsing reuses the shipped parser and its fixtures.

## Validation

- [x] `device backup` archives a document's complete file set and reports the
      orphan excess when present
- [x] `device orphans` reports only unreferenced stroke-bearing files; zero-stroke
      files appear as a count
- [x] `--render` produces preview-scale composites via the existing strokes
      pipeline
- [x] A device with no orphans says so explicitly
- [x] `doctor` reports the account-wide orphan count when SSH is configured
- [ ] Live (orchestrator, read-only): backup + orphans against the real tablet;
      archive contents verified locally

## Risks / unknowns

- **Streaming large docs over a relayed connection** — tar over two ssh hops can
  be slow; report progress on stderr, never stdout.

## Notes

- Implemented as PR [#41](https://github.com/JarvusInnovations/remarkable-axi/pull/41):
  `src/device-fs.ts` (device-side path resolution over the storage layout —
  metadata dump, parent-chain walking incl. trash, `NOT_FOUND`/`AMBIGUOUS`,
  the orphan diff), `src/rm6.ts` (a minimal v6 `.rm` binary parser),
  `src/commands/device.ts` (`backup`, `orphans`, dispatch), `doctor`'s
  account-wide orphan count in `src/commands/setup.ts`, and an exec-layer
  extension (`execRemoteBinary`, `opts.timeoutMs`) in `src/device.ts`.
- `rmapi-js`'s own `.rm` parser (`parseRmScene`) is not reachable from outside
  the package — its `exports` map publishes only the top-level entry, the
  same wall `src/output.ts` already documents hitting for a type. `src/rm6.ts`
  is a deliberately partial re-derivation of the wire format (MIT-licensed
  upstream, credited in its doc comment), trimmed to exactly the block types
  `pageGeometry` reads. Its test fixtures were hand-encoded and cross-
  validated by feeding them to `rmapi-js`'s real `parseRm` from a throwaway,
  uncommitted scratch script — never from anything shipped — so the parser
  is verified against the real wire format despite never importing the
  library that defines it.
- All five non-live validation boxes are checked, backed by new/expanded
  suites across six files: `test/device.test.ts` (binary exec capture,
  `timeoutMs`), `test/rm6.test.ts` + `test/fixtures/rm6.ts` (the parser),
  `test/device-fs.test.ts` (dump parsing, path resolution incl. trash/
  `AMBIGUOUS`/cycles, orphan diff, remote command builders),
  `test/commands/device.test.ts` (backup + orphans, incl. zero-stroke
  exclusion and `--render` run end-to-end against the real Ghostscript
  installed in this environment), `test/commands/doctor-device.test.ts`
  (the orphan count and its graceful degradation to "unknown").
- `bun run check`, `bun run build`, and `bun run check:skill` all ran clean.
  `bun run test` ran 498 tests across two full runs; the only failures were
  the two pre-existing, already-documented `"no device target … NO_DEVICE"`
  failures in `check`/`render` (issue #34), confirmed unrelated to and
  unmodified by this change.
- **The live-device validation box is intentionally left unchecked.** Per
  the orchestration protocol, live verification against the real tablet is
  the orchestrator's gate, run read-only after merge — not something this
  implementation pass performs. The tablet is currently unreachable pending
  its LAN address, so live checks may trail the merge of this PR.
- `stat -c '%s %Y'` (size/mtime for `.rm` file listings) is the one remote
  command primitive here not already proven by `setup-ssh-device-status`'s
  `STATUS_COMMAND` — unverified against real hardware, same discipline as
  that command: a line that doesn't parse degrades to "unknown" rather than
  dropping the file. Worth double-checking during the orchestrator's live
  pass alongside `STATUS_COMMAND` itself.
- `device backup` picked up a `--force` flag (matching `get`'s own
  overwrite convention) that the spec's usage synopsis hadn't shown; the
  spec was updated in the same PR (a Flags-table-style note plus an
  `EXISTS` Failure row) before the command code that implements it.

## Follow-ups

- `device reattach` continues in [`device-reattach`](device-reattach.md),
  which depends on this plan and now has both read-only commands (`backup`,
  `orphans`) to build its write ritual on top of.
- If the live verification pass finds `DEVICE_DUMP_COMMAND`'s `stat -c`
  usage doesn't match real firmware, fix it in `src/device-fs.ts` — it's the
  one place this plan's remote commands live, mirroring
  `setup-ssh-device-status`'s own risk note about `STATUS_COMMAND`.
