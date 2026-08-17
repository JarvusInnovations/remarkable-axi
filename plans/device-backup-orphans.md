---
status: planned
depends: [setup-ssh-device-status]
specs:
  - specs/commands/device.md
  - specs/behaviors/device-access.md
issues: []
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

- [ ] `device backup` archives a document's complete file set and reports the
      orphan excess when present
- [ ] `device orphans` reports only unreferenced stroke-bearing files; zero-stroke
      files appear as a count
- [ ] `--render` produces preview-scale composites via the existing strokes
      pipeline
- [ ] A device with no orphans says so explicitly
- [ ] `doctor` reports the account-wide orphan count when SSH is configured
- [ ] Live (orchestrator, read-only): backup + orphans against the real tablet;
      archive contents verified locally

## Risks / unknowns

- **Streaming large docs over a relayed connection** — tar over two ssh hops can
  be slow; report progress on stderr, never stdout.

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
