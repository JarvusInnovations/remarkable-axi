---
status: done
depends: [device-reattach]
specs:
  - specs/behaviors/ink-preservation.md
  - specs/commands/put.md
issues: [21]
---

# Plan: `put --replace --keep-ink`

## Scope

Ship the third route out of the `HAS_INK` refusal: carry a superseded
document's strokes onto its replacement, so a regenerated document keeps its
handwriting as **live strokes** rather than a flattened image or a trashed copy.

In scope: the write path, the by-index matching rules, the partial-carry
safety rule, and the spec/flag documentation. Out of scope: transforming ink
across a changed page box (refused, not attempted), and recovering strokes the
device never synced (`device orphans` already owns that).

## Implements

- **specs/behaviors/ink-preservation.md § Carrying ink forward** — the whole
  behavior, including the outcome table this plan did not have to re-derive:
  it was written down when the feature was deferred.
- **specs/commands/put.md** — the flag, and the `USAGE` error when both ink
  flags are passed.

## Approach

**The deferral rested on an unmeasured assumption, so the first step was to
measure it.** Issue #21 recorded that porting ink needed a write path that
could not be verified without live-device access. Two probes against the live
cloud settled it:

1. A freshly uploaded 3-page PDF reports `pageCount: 1` with a single faked
   page id — confirming the worry exactly. Strokes are addressed by page id,
   so there is nothing to write onto yet.
2. `updateDocument` can declare the real page list, and `putRmPages` then
   writes strokes against it. Declared a 3-page list on a fresh upload, wrote
   real strokes onto page 3, read them back — matched.

So the path is: read strokes → upload → declare page list → write strokes.
`putDocumentArchive`, the API the original investigation looked at, was the
wrong tool (it reassigns the document id); the page-addressed writers are the
right one.

**Ordering is the safety property.** Strokes are read before the upload and
written before the superseded copy is trashed, so every failure leaves the ink
somewhere reachable. On a partial carry the old document is not trashed at
all, and the output says which pages did not make it and why.

**Matching is by index**, which makes the append case — a growing document
whose earlier pages hold ink — work with no special handling.

## Validation

- [x] `planCarry` covers the spec's three outcomes (ported / orphaned /
      skipped) plus the append case and the unknown-box case; unit-tested
      without a network.
- [x] The cloud write path is verified end to end (declare list → write
      strokes → read back) rather than assumed.
- [x] A partial carry leaves the superseded document in place and reports it.
- [x] `--keep-ink` with `--discard-ink` is a `USAGE` error.
- [x] The `HAS_INK` refusal offers `--keep-ink` first.
- [ ] **Hardware**: the device honors a client-supplied page list on first
      open (rather than regenerating). Recoverable either way via
      `device orphans` / `device reattach`, which is why this ships ahead of
      the answer.

## Risks / unknowns

- **The page-list question is genuinely open on hardware.** If the device
  regenerates page ids on first open, ported strokes become orphans inside the
  new document rather than losses — recoverable, and detectable with
  `device orphans`. This is the one claim in the spec not backed by a
  measurement, and it is labelled as such there.
- **Page-box comparison needs the superseded PDF**, one extra download, and
  only when there is ink to carry. When that fetch fails the comparison
  degrades to "assume unchanged" rather than blocking the carry — a wrong
  assumption there misplaces ink, so the degrade is logged in the outcome
  rather than silent.
- **Two documents briefly coexist** between upload and trash. Fresh page ids
  (rather than reusing the superseded document's) keep that overlap from
  depending on page ids being unique only per-document.

## Notes

*Populated at closeout.*

## Follow-ups

*Populated at closeout.*
