---
status: done
pr: 47
depends: [device-live-hardening]
specs:
  - specs/commands/device.md
issues: [45]
---

# Scoped dumps for single-document device commands

## Scope

Single-document `device` commands (`backup`, `orphans <path>`, `reattach`) stop
paying for the account-wide dump: a metadata-only dump (~300B/doc) resolves the
path, then a uuid-scoped full dump fetches just the target document. The
account-wide sweep (`orphans` with no path, doctor's orphan count) keeps the
full dump. Resolution semantics unchanged — same parser, same
`NOT_FOUND`/`AMBIGUOUS`, and the no-user-strings-in-remote-commands rule holds
(the scoped uuid comes from the metadata dump, never from input).

## Implements

- `specs/commands/device.md` — the existing command surface, at a cost that
  honors the spirit of "Ambient context must not cost account size" on the
  device side

## Approach

Found live during the #45 drill: `reattach` timed out at its 300s budget
because path resolution pulled the full ~6MB dump, which measures 5.5 minutes
over a DERP-relayed phone jump (73s over a LAN relay). `dumpLoop(glob)`
parameterizes the existing per-document loop; `METADATA_DUMP_COMMAND` and
`scopedDumpCommand(uuid)` derive from it; `fetchDocByPath` chains the two
small connections and the three single-document commands use it.

## Validation

- [x] All three single-document commands resolve via metadata + scoped dumps
      (ritual-order test asserts the two-stage sequence)
- [x] Account-wide sweep still uses the full dump
- [x] Live: scoped `orphans <path>` answers in seconds over the slow relay
      where the full dump took 5.5 minutes
- [x] Live: `reattach --map` completed the full ritual over the same relay
      that timed out pre-change — the #45 drill's planted orphan attached,
      per-stroke disposition reported, xochitl restarted
- [x] Live: reattached ink confirmed syncing up to the cloud — `get --as svg`
      retrieved 185 strokes for the drill document

## Risks / unknowns

- **Two connections instead of one** — each carries ssh setup latency
  (~2-3s over the phone relay); trivial next to the dump it replaces.

## Notes

- Also bounded `doctor`'s account orphan-count probe to 15s in this PR — the
  full dump over a slow relay made doctor hang for minutes; it now degrades
  the count to "unknown" honestly.
- The #45 drill closed the whole recovery loop on real hardware: plant →
  detect → reattach ritual → ink live on device → synced up → 185 strokes
  retrieved cloud-side.

## Follow-ups

- Tracked as: issue #34 (updated) — doctor's tests live-probe a reachable
  tablet through the module-load config leak; flaky-when-reachable until the
  isolation root cause is fixed.
