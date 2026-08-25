---
status: done
depends: [keep-ink]
specs:
  - specs/behaviors/ink-preservation.md
issues: [55]
---

# Plan: an unmeasurable carry stops being indistinguishable from a clean one

## Scope

Close [#55](https://github.com/JarvusInnovations/remarkable-axi/issues/55): a
`--keep-ink` carry reported porting ink onto page 3 of a two-page document with
`similarity: —, layout not compared`, and trashed the superseded copy anyway.
Two independent defects met in one run.

1. **The similarity degrade path is silent.** When the comparison cannot be made,
   the page ports and the carry is treated as complete. The table already
   distinguishes *not measured* from *measured and fine*; the **decision** does
   not, so the guard built to catch misplaced ink is skipped precisely when the
   tool knows least.
2. **A source index the document did not have.** `planCarry` bounds a source
   index against the *new* page count only. Nothing bounds it against the
   superseded document's own page count, so an index beyond the end of the source
   is invisible to the matching rules.

Out of scope: why the `.content` page list ran long. The guard here is
correct whatever the cause, and the cause is not knowable from the cloud side.

## Implements

- **specs/behaviors/ink-preservation.md § Carrying ink forward** — the fourth
  outcome row (index beyond the superseded document's own page count), the rule
  that the page count comes from the parsed PDF rather than the page list, and
  the amended trash rule: *complete **and corroborated***.
- **§ "Not measured" must never look like "measured and fine"** — new, and the
  half of the existing spec that was stated for the table but never for the
  decision.

## Approach

**Bound the index against the source document, and take the bound from the
document rather than from metadata about it.** The observed index came from
looking a page id up in `contentPageOrder`, and that list was longer than the
PDF it describes — so bounding against its own length would validate nothing.
The parsed page boxes of the superseded PDF are the document itself, so
`planCarry` treats a non-empty `oldBoxes` as the authoritative page count and
rejects any index past its end before it looks at the replacement at all.

Out-of-range is **skipped**, not orphaned. Orphaned says the ink was lost;
these strokes are real and the superseded copy keeps them. The most likely
benign cause — a page added on the device to a PDF that never had one — is
genuine ink with no counterpart in the source, and there is no page of the
replacement it can be assumed to correspond to.

**Split the carry into its additive half and its destructive half.** Writing
strokes onto the replacement destroys nothing, so an unverified port still
writes; what it no longer does is authorize trashing the original. `safeToTrash`
carries the invariant — complete *and* every ported page measured — and `put`
holds the superseded copy back on either failure, the branch that already
existed for a partial carry.

**Carry the reason, not just the absence.** "Layout not compared" is useless
without knowing whether the tool lacked a renderer, could not fetch the
superseded PDF, or could not render that particular page. The reason is attached
to the outcome and surfaced in `kept_ink.unverified`, where it is actionable;
the table cell stays short.

## Validation

- [x] An index beyond the superseded PDF's page count is skipped with the source
      page count named, and nothing is written for it
- [x] The bound comes from the parsed PDF, not from `contentPageOrder` — a
      page list longer than its document does not widen it
- [x] The out-of-range guard runs before the shorter-replacement check, so the
      reason names the real problem
- [x] A ported page with no measured similarity is listed under
      `kept_ink.unverified` with the reason the comparison failed
- [x] An unverified port leaves the superseded document **untrashed**, with a
      warning that says so
- [x] A fully measured carry above the warn line still trashes the superseded
      copy — the fix does not make the safe branch the only branch
- [x] The reason distinguishes an absent renderer from an unfetchable superseded
      PDF from an unrenderable page
- [x] The table still prints `—` / `layout not compared`, unchanged
- [x] The regression from #55 reproduces on the old code and passes on the new:
      a two-page document whose page list carries a third id ports its two real
      pages, names the third as skipped, and keeps the original

## Risks / unknowns

- **On a machine with no renderer, `--keep-ink` now always leaves the superseded
  copy in place.** Two documents then share one path, which `put --replace`
  refuses as `AMBIGUOUS` until one is removed. This is the deliberate cost:
  trashing on an unverified carry is the cheaper default and would make the
  silent path the convenient one. The output names Ghostscript as the fix.
- **Rejected: an override flag** (`--keep-ink --unverified-ok` or similar) to
  restore trashing without a measurement. It would be reached for reflexively,
  which is the `--force` failure this repo's ink refusal was designed around,
  and the hold-back is already fully recoverable by hand.
- **Rejected: refusing the carry outright when no renderer is present.** That
  makes an environmental gap fatal to a flag whose write path does not need a
  renderer at all, and loses ink for a reason that has nothing to do with the
  document.
- **Rejected: bounding the index against `contentPageOrder().length`.** It is
  the input suspected of being wrong; a bound derived from it cannot catch it.

## Notes

**The existing tests could not have caught either half.** `fakeApi.getPdf`
threw unconditionally, so every `--keep-ink` test ran the degrade path: no
superseded PDF, no page boxes, no measurement. That is why a suite with an
explicit "distinguishes unmeasured from fine" assertion still passed while the
decision failed to distinguish them, and why nothing bounded the source index —
`oldBoxes` was always empty, so the bound would have been unreachable anyway.
The fixture now serves a real superseded PDF, which is what makes the
corroborated path testable at all.

**Both halves of #55 were probably one event.** The likeliest reason the
similarity was unmeasurable on that run is the phantom index itself: Ghostscript
cannot rasterize page 3 of a two-page PDF, so the comparison threw and the page
came back unmeasured. Part 2 is the cause and part 1 is the backstop that should
have caught it anyway. Fixing either alone would have left the run wrong.

**An out-of-range index is not necessarily corrupt metadata.** A page added on
the device to a PDF that never had one produces exactly this signature —
genuine ink at an index the source PDF cannot account for. That is why the
outcome is skipped-and-reported rather than an error, and why the superseded
copy is what keeps the strokes.

**The suggestion deliberately avoids `rm <path>`.** While the superseded copy is
held back, two documents answer to one path and `rm` resolves it
first-writer-wins, so that hint could trash the replacement. The help names the
collision and the superseded document's id instead.

## Follow-ups

- **Deferred**: rename the superseded copy in place when it is held back, the
  way it is renamed on its way to trash. It would clear the path collision the
  hold-back creates — `put --replace` currently refuses `AMBIGUOUS` afterwards —
  and make `rm` unambiguous again. Out of scope here because it changes the
  existing partial-carry branch too, which #55 did not ask about.
- **None** for the underlying cause: why that `.content` page list ran longer
  than its document is unresolved, and not answerable from the cloud side. No
  issue filed, because there is nothing to act on until the guard fires again —
  and when it does, its message names the page counts that ruled the index out,
  which is where a diagnosis would start.
