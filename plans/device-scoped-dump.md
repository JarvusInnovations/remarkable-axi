---
status: in-progress
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
- [ ] Live: reattached ink confirmed syncing up to the cloud (poll in flight
      at authoring time; result recorded on issue #45)

## Risks / unknowns

- **Two connections instead of one** — each carries ssh setup latency
  (~2-3s over the phone relay); trivial next to the dump it replaces.

## Notes

(Closeout pending the sync-verification poll.)

## Follow-ups

(Closeout pending.)
