# Behavior: Ink preservation

## Rule

Handwriting is unreproducible. Any operation that supersedes a document preserves the
superseded copy in a findable form, and any operation that carries ink forward reports
what happened to it page by page.

## Applies To

`put --replace`, `put --discard-ink`, and any future operation that swaps a
document's contents. `put --keep-ink` — see [Carrying ink forward](#carrying-ink-forward).

## Details

### The superseded copy is the backup

Replacing a document moves the old one to trash — the cloud exposes no hard delete —
so every stroke survives until the user empties trash. That recoverable copy is what
lets ink-carrying operations be permissive rather than defensive.

For it to function as a backup it has to be **findable**, so the superseded document
is renamed on its way to trash:

```
Draft  →  Draft (replaced 2026-08-15 10:42)
```

A trash holding several identically-named copies of the same document is not a
backup. The success output names the trashed document so the recovery path is in the
transcript rather than requiring archaeology.

### Warning before replacing inked documents

`put --replace` onto a document that carries ink refuses by default. Whether a
document carries ink is answered by its entry list — per-page `.rm` files — which is
one request and no downloads.

**A page counts as inked only when its stroke file holds at least one stroke.** The
device creates a stroke file for a page that was merely *opened*, and counting those
as ink makes the refusal fire on documents nobody wrote on
([#28](https://github.com/JarvusInnovations/remarkable-axi/issues/28)). A false
refusal is not conservative — it trains the `--discard-ink` reflex, and that reflex
is what waves through a real loss later. The zero-stroke case must be
distinguishable without guessing; where the entry's size cannot settle it against a
measured threshold, the stroke file is fetched and parsed rather than assumed
either way.

```
error: /Talks/Flyer has ink on 3 of 12 pages; --replace would discard it
       last synced 2h ago — ink written on-device since then is invisible to this check
help: save it separately first —
        remarkable-axi get "/Talks/Flyer" --overlay flyer-annotated.pdf
      or replace and let it go —
        remarkable-axi put flyer.pdf "/Talks/Flyer" --replace --discard-ink
```

The override flag names what is lost. `--force` would let an agent proceed without
acknowledging the specific consequence; `--discard-ink` does not.

### Cloud checks see only synced ink

Everything this behavior can inspect — the entry list, the per-page stroke files,
the trash backup — is the **cloud's copy**. Strokes written on the device that have
not yet synced up are invisible to all of it, and a replace delivered inside that
window wins over them: the device takes the new document, rewrites its page index,
and the unsynced strokes are **orphaned locally** — unreferenced on the device's
disk, not destroyed, and absent from every cloud fetch thereafter. The same
signature occurs without any replace when a stuck device sync is resolved by a
restart taking the cloud's side. Two real incidents (2026-08-14, twelve pages;
2026-08-17, one page) both wore it: cloud fetches report zero ink while the strokes
sit intact on the device.

Because the window cannot be closed from the cloud, it is **disclosed** instead:

- Every `--replace` — refusal *and* success — reports the target's `last_synced`
  age. A small number means the cloud's picture is fresh; a large one on a document
  the user writes on daily is the risk, stated where the decision is being made.
- The refusal's blind-spot line (above) says plainly what the check could not see.
- When a device connection is configured, the check extends to the device itself —
  the intended end state, specified (and bounded) in
  [device-access](device-access.md#the-prize-closing-the-blind-spot-at-the-gate).

Recovery from an orphaning — locating the stroke files, identifying them by their
surviving thumbnails, reattaching them to a live index — is the
[device command group](../commands/device.md). The scheduling mitigation is the
caller's: replace during windows the user has not been writing in, which is the one
time the blind spot is provably empty.

`--keep-ink` is the third route, and the one the refusal names first: it carries
the ink onto the new version instead of choosing between the two above. See
[Carrying ink forward](#carrying-ink-forward).

### Carrying ink forward

`put --replace --keep-ink` ports the superseded document's strokes onto the
replacement, so a document can be regenerated without its handwriting becoming
a flattened image or a trashed copy. It is the third route out of the refusal
above, and the one to reach for when the replacement is a re-render of the same
document — the common case.

**Why this needed a measurement first.** A freshly uploaded multi-page PDF
declares **one faked page** in its `.content`: a 3-page upload reports
`pageCount: 1` with a single page id, because the device generates the real
page list when it first opens the document. Strokes are addressed by page id,
so until a real list exists there is nothing to write onto. The write path is
therefore three steps, in this order:

1. read the superseded document's strokes (`getRmPages`) — **before** anything
   is uploaded, so a failure here costs nothing;
2. upload the replacement, then declare its real page list with
   `updateDocument` (`pages`, `pageCount`, `redirectionPageMap`);
3. write the strokes against that list with `putRmPages`.

All three were verified end to end against the live cloud — declare a page
list on a fresh upload, write real strokes onto its third page, read them back
— before this shipped. That round-trip is what the earlier "the write path
could not be verified as reliable" note was missing.

**The superseded copy is trashed only on a complete carry.** If any inked page
is orphaned or skipped, the old document is left in place — not trashed — and
the output says so. A partial carry must never be the moment ink becomes hard
to find.

**Open on hardware**: whether the device honors a client-supplied page list on
first open, or regenerates its own. If it regenerates, ported strokes land as
orphans in the document's directory rather than being lost, and
`device orphans` / `device reattach` recover them — the failure mode is
recoverable, which is why this ships ahead of that answer rather than behind
it.

`--keep-ink` would port the superseded document's strokes onto the new one. Ink is
stored per page and positioned in page-relative coordinates, so where the page box is
unchanged the strokes transfer verbatim.

Pages are matched **by index**. Each inked page has one of three outcomes:

| Condition | Outcome |
| --- | --- |
| page N exists in the new document with the same page box | ported |
| page N does not exist (new document is shorter) | orphaned — reported loudly |
| page N exists with a different page box | skipped — reported |

Appending pages therefore works with no special handling: existing pages keep their
ink and the appended ones arrive clean.

**There is no page-count gate.** Equal page counts assert nothing about whether a
page's content moved, and requiring them blocks the common append case while
protecting against nothing. A gate that fails to test the variable carrying the risk
is worse than no gate — see
[Best-effort operations report per-item outcomes](../principles.md#best-effort-operations-report-per-item-outcomes).

### What ported ink does and does not guarantee

Ink is anchored to the **page**, not to the content. If a paragraph reflowed, the
strokes stay where they were and now annotate something else. That is undetectable
from the stroke data alone, and the guarantee is stated plainly in help: same page box
and same page index means the ink lands where it was — not that it still means what it
meant.

### Measuring whether the content moved

Because page identity cannot supply that assurance, `--keep-ink` reports a **page
similarity** for each ported page, computed by rasterizing the superseded and
replacement pages and comparing them — the same rasterizer `check` uses.

```
uploaded: Flyer (14 pages)
backup: "Flyer (replaced 2026-08-15 10:42)" in trash — original ink intact
ink[3]{page,ported,similarity,note}:
  2,yes,0.99,layout unchanged
  5,yes,0.97,layout unchanged
  9,yes,0.61,"layout shifted — ink may no longer sit on what it annotated"
```

This measures the thing that matters and catches what index matching is structurally
blind to: a page inserted mid-document shifts every page after it and misplaces all
their ink while every count and page box still checks out.

Low similarity is a warning, never a refusal — the superseded copy is intact, so the
user can judge.

## Principles

**Inherited** — project principles that especially bite here:

- [Nothing the user made is destroyed without a findable copy](../principles.md#nothing-the-user-made-is-destroyed-without-a-findable-copy)
  — why the rename is load-bearing and why best-effort porting is acceptable.
- [Best-effort operations report per-item outcomes](../principles.md#best-effort-operations-report-per-item-outcomes)
  — the per-page outcome table, and why the page-count gate was rejected.
- [Measure the device; never ship a guessed constant](../principles.md#measure-the-device-never-ship-a-guessed-constant)
  — page similarity is measured rather than inferred from metadata.
