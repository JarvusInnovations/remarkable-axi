---
status: done
depends: [ink-preservation, device-reattach]
specs:
  - specs/behaviors/ink-preservation.md
  - specs/commands/put.md
issues: [21]
---

# Plan: ship `put --replace --keep-ink`

## Scope

Build the flag [`ink-preservation`](ink-preservation.md) designed but
deliberately did not ship, closing its follow-up: carry a superseded
document's strokes onto its replacement, with the per-page outcome table and
the measured page similarity that plan specified.

**This plan owns only the part that was deferred.** The guard, the renamed
backup, and the `HAS_INK` refusal all shipped there; here they only change
insofar as the refusal now offers `--keep-ink` first.

## Implements

- **specs/behaviors/ink-preservation.md § Carrying ink forward** — the design
  was already written down in full, including the ported/orphaned/skipped
  table. Nothing here re-derived it.
- **§ Measuring whether the content moved** — the per-page similarity, which
  is the half of the spec a naive index-matching implementation silently omits.
- **specs/commands/put.md** — the flag and the both-ink-flags `USAGE` error.

## Approach

**The predecessor's gating risk was the right one, and it is only half
retired.** [`ink-preservation`](ink-preservation.md) prototyped both candidate
write paths and recorded the outcome: `putDocumentArchive` reassigns the
document id (wrong tool), while manufacturing the page list — `putPdf` fakes a
one-page `.content`, `updateDocument` shallow-merges a real one over it,
`putRmPages` attaches strokes to those ids — needs no experimental call. That
analysis was correct and is reused wholesale.

What this plan adds is **execution rather than inference**: the path was run
end to end against the live cloud. A fresh 3-page upload does report
`pageCount: 1` with a single faked page id, exactly as predicted; declaring a
3-page list and writing real strokes onto page 3 round-trips and reads back.

What it does **not** add is the answer to the question the predecessor
actually gated on — whether the *device* honors a client-supplied page list on
first open, or repaginates and orphans the ported ink. That remains open, and
the flag ships ahead of it on a changed risk calculus rather than a resolved
risk: `device orphans` and `device reattach` did not exist when that judgment
was made, and they turn "silently orphaned on the tablet" into a listed,
recoverable state. If the drill shows repagination, the honest response is to
gate the flag behind a device check, not to widen the claim.

**Similarity is not optional garnish.** Matching by index is structurally blind
to a page inserted mid-document: every later page keeps a valid index and page
box while all of its ink lands on the wrong content. Rasterizing both pages and
comparing them is what sees it, and it is measured with `check`'s own
rasterizer — whose docstring already named this as its second caller.

## Validation

Carried over from [`ink-preservation`](ink-preservation.md), whose keep-ink
boxes stayed unchecked when the flag was pulled:

- [x] The refusal offers `--keep-ink`, the `get --overlay` save, and `--discard-ink`
- [x] `--keep-ink` ports strokes onto same-box pages
- [x] Appending pages: existing pages keep ink, appended pages arrive clean
- [x] Shorter replacement: orphaned ink reported per page, not silently dropped
- [x] Changed page box on a page: skipped and reported, not misplaced
- [x] Per-page table reports ported / orphaned / skipped and a similarity for
      each ported page
- [x] A page inserted mid-document produces low similarity on the shifted pages
- [x] An unmeasurable similarity prints `—` and says "layout not compared" —
      never rendered indistinguishable from a measured pass
- [x] A partial carry leaves the superseded document **untrashed**, and says so
- [x] `--keep-ink` with `--discard-ink` is a `USAGE` error
- [x] A replacement whose page count cannot be read carries nothing rather
      than guessing an index mapping
- [x] **Hardware drill**: replace an inked multi-page document on a real
      tablet, open it, and confirm the ported strokes sit on the pages they
      were written to — the predecessor's open question, **now answered**.

## Risks / unknowns

- **We might have to take the flag back out.** The device question is
  unresolved, and the predecessor's judgment — that shipping on unverified
  device behaviour is the failure
  [Measure the device](../specs/principles.md#measure-the-device-never-ship-a-guessed-constant)
  exists to prevent — has not been refuted, only re-weighted against a
  recovery path that now exists. Said out loud before merge, per
  [Reversal is cheaper before the build].
- **A reflowed page still ports its ink**, by design: similarity warns, never
  refuses. The guarantee in help must stay narrow — same box and index means
  the ink lands where it was, not that it still means what it meant.
- **Similarity costs a Ghostscript pass per ported page.** Held down with a
  coarse 36dpi (displacement is a gross-scale signal) and by measuring only
  pages that actually ported.

## Notes

**The device honors a client-supplied page list.** Verified 2026-08-19 on a
reMarkable Paper Pro: a 3-page document carrying live strokes on pages 1 and 3
was replaced by a 4-page one built from the superseded document's *original*
PDF plus an appended page. Both inked pages ported at similarity 1.00, the new
page arrived clean, and on the device all four pages rendered with the ink
exactly where it was written. This retires the question
[`ink-preservation`](ink-preservation.md) gated on, and issue #21 with it.

**Take the original, not a freshly-baked copy.** Building the replacement from
`get --overlay` output would flatten the live strokes into the page image *and*
then port them as strokes — the same ink twice, one copy uneditable. The
replacement is assembled from `get --as original`, which carries everything
previously flattened while leaving the live strokes to `--keep-ink`. Any caller
appending to a document it also annotates needs this ordering.

**The measured similarity of 1.00 is a real signal, not a rounding artifact**:
the ported pages came from the superseded document's own PDF, so they are
byte-identical renders. A first live run that scored anything lower would have
meant the base was wrong.

**CI has no Ghostscript**, which surfaced a better design than the red build
demanded. Skipping raster suites where `gs` is absent is the repo's existing
pattern, but skipping alone would leave the metric unverified on every machine
without a renderer. Extracting `compareDarkness` as a pure function fixed the
build *and* let the property the weighting exists for be pinned directly: two
mostly-white pages with content in different places must not score like a
match (a per-pixel mean gives ~0.97 there; ink-weighted it collapses below
0.1).

## Follow-ups

- **None.** Issue #21 is closed by this plan; `specs/behaviors/ink-preservation.md`
  no longer carries an unshipped section, and the hardware question it was
  waiting on is answered in Notes above.
