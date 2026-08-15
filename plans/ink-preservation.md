---
status: planned
depends: [put-get-surface, check-command]
specs:
  - specs/behaviors/ink-preservation.md
issues: []
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

- [ ] `put --replace` onto an inked document refuses, naming the inked page count
- [ ] The error offers `--keep-ink`, the `get --overlay` save, and `--discard-ink`
- [ ] `--discard-ink` proceeds; no flag named `--force` does
- [ ] `put --replace` onto a clean document is unaffected
- [ ] Superseded document lands in trash renamed with a timestamp, and is named in the output
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

## Follow-ups
