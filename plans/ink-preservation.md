---
status: done
depends: [put-get-surface, check-command]
specs:
  - specs/behaviors/ink-preservation.md
issues: [21]
pr: 22
---

# Guard and carry ink across a replace

## Scope

Make `put --replace` safe for annotated documents: refuse by default when the target
carries ink, rename the superseded document on its way to trash, and add `--keep-ink`
to port strokes onto the replacement with per-page outcomes and a measured page
similarity.

## Implements

- `specs/behaviors/ink-preservation.md`
- the ink flags in `specs/commands/put.md`

## Approach

Detection is cheap: an annotated document has per-page `.rm` entries in its entry
list, so one request answers it with no downloads.

The backup already exists — the cloud has no hard delete, so a superseded document
goes to trash with every stroke intact. What is missing is findability: it arrives in
trash carrying the same name as the document that replaced it. Rename it on the way,
and name it in the success output so the recovery path is in the transcript.

`--keep-ink` matches pages by index and ports strokes where the page box is unchanged.
Appending pages therefore works with no special handling. There is deliberately **no
page-count gate**: equal counts assert nothing about whether a page's content moved,
and requiring them blocks the common append case while protecting against nothing.

Because page identity cannot supply that assurance, measure it instead — rasterize the
superseded and replacement pages with `check`'s rasterizer and report a similarity per
ported page. That catches reflow, and it catches what index matching is structurally
blind to: a page inserted mid-document shifts everything after it and misplaces all
their ink while every count and page box still checks out.

Low similarity warns; it never refuses. The superseded copy is intact, so the user can
judge.

## Validation

- [x] `put --replace` onto an inked document refuses, naming the inked page count
- [ ] The error offers `--keep-ink`, the `get --overlay` save, and `--discard-ink`
- [x] `--discard-ink` proceeds; no flag named `--force` does
- [x] `put --replace` onto a clean document is unaffected
- [x] Superseded document lands in trash renamed with a timestamp, and is named in the output
- [ ] `--keep-ink` ports strokes onto same-box pages, positioned identically
- [ ] Appending pages: existing pages keep ink, appended pages arrive clean
- [ ] Shorter replacement: orphaned ink reported per page, not silently dropped
- [ ] Changed page box on a page: skipped and reported, not misplaced
- [ ] Per-page table reports ported / orphaned / skipped and a similarity for each ported page
- [ ] A reflowed page reports low similarity and still ports
- [ ] A page inserted mid-document produces low similarity on every shifted page

## Risks / unknowns

The write path is the real risk. Assembling a document from a new PDF blob plus the
old `.rm` entries needs a call that preserves or reconstructs the document structure,
and `putDocumentArchive` — the only one that keeps a document id — is documented
upstream as experimental. **Prototype this before committing to the flag**; if it
cannot be done reliably, `--keep-ink` should not ship and the guard plus the renamed
backup should land on their own.

Ink is anchored to the page, not the content, and no amount of measurement changes
that. Similarity is evidence for a human judgment, not a correctness guarantee, and
the help text has to say so plainly or the flag will be trusted further than it earns.

## Notes

**`--keep-ink` did not ship — the gating risk resolved against it.** Before writing
the flag, both write paths that could assemble a document from a new PDF plus the old
document's `.rm` files were prototyped against the installed `rmapi-js` (v13.0.0):

- **`putDocumentArchive`** — the plan's original premise was that this preserves a
  document id. It doesn't: the library's own JSDoc says re-uploading "generates a
  fresh document id," and it's marked experimental. The upstream README goes further
  — the maintainer records trouble reuploading a cloned document at all. `specs/
  architecture.md` was wrong on this point and has been corrected in this PR.
- **Manufacture the page list** — `putPdf`/`putEpub` upload with the `.content` page
  list faked to one page regardless of the real PDF's page count (the device is
  expected to paginate for real on first open). `updateDocument` does a shallow merge,
  so a caller *can* overwrite `pages`/`cPages`/`pageCount` with a real, correctly-sized
  id list right after upload, then attach ported `.rm` files to those ids via
  `putRmPages` — no experimental call needed. What's unverifiable from the library
  alone is whether the device *honors* a client-supplied page list rather than
  regenerating its own when it first opens the document, silently orphaning the ported
  ink. This is genuinely a live-hardware question, and the task this plan was built
  under explicitly ruled out mutating calls against the paired account.

Per `specs/principles.md#measure-the-device-never-ship-a-guessed-constant`, shipping
either path on the strength of reading source was judged the same failure mode the
principle exists to prevent — plausible, unverified, and silently wrong if the
assumption doesn't hold. The design is preserved in `specs/behaviors/
ink-preservation.md` under "Carrying ink forward: not yet shipped" rather than
deleted, and `--keep-ink` is rejected with a targeted error pointing at
[issue #21](https://github.com/JarvusInnovations/remarkable-axi/issues/21) rather than
the generic `UNKNOWN_FLAG` list.

**Validation box "The error offers `--keep-ink`, the `get --overlay` save, and
`--discard-ink`" is unchecked, not reworded**, because it can't be true as written —
the shipped refusal offers only the two routes that exist. This is the direct
consequence of the Risks section's own instruction ("if it cannot be done reliably,
`--keep-ink` should not ship") rather than a scope cut discovered after the fact, so
it's recorded here rather than silently editing the criterion.

**`put.ts` had no test coverage at all before this plan** — `--replace`'s existing
backup/rename behavior (built in an earlier plan) was exercised for the first time by
`test/commands/put.test.ts`, alongside the new ink guard. Coverage of `put`'s
non-`--replace` paths (destination resolution, mkdirp, EXISTS/AMBIGUOUS) remains a
pre-existing gap this plan didn't attempt to close.

## Follow-ups

- Issue [#21](https://github.com/JarvusInnovations/remarkable-axi/issues/21) — `--keep-ink`'s
  write path needs a live-device test (does the tablet honor a client-manufactured
  per-page id list, or repaginate and orphan the ported ink on first open?) before it
  can ship.
