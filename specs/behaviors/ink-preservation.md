# Behavior: Ink preservation

## Rule

Handwriting is unreproducible. Any operation that supersedes a document preserves the
superseded copy in a findable form, and any operation that carries ink forward reports
what happened to it page by page.

## Applies To

`put --replace`, `put --discard-ink`, and any future operation that swaps a
document's contents. `put --keep-ink` is designed here but **not implemented** —
see [Carrying ink forward: not yet shipped](#carrying-ink-forward-not-yet-shipped).

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

```
error: /Talks/Flyer has ink on 3 of 12 pages; --replace would discard it
help: save it separately first —
        remarkable-axi get "/Talks/Flyer" --overlay flyer-annotated.pdf
      or replace and let it go —
        remarkable-axi put flyer.pdf "/Talks/Flyer" --replace --discard-ink
```

The override flag names what is lost. `--force` would let an agent proceed without
acknowledging the specific consequence; `--discard-ink` does not.

`--keep-ink` — a third route that carries the ink onto the new version instead of
choosing between the two above — is the design this section describes next, but it
is not implemented; see
[Carrying ink forward: not yet shipped](#carrying-ink-forward-not-yet-shipped) for
why the refusal above offers only two routes today.

### Carrying ink forward: not yet shipped

**Status: designed, not implemented.** This section describes the intended design
for the record and for whoever picks it up next — `--keep-ink` does not exist in
`put`'s flags, and the refusal above does not offer it. See
[issue #21](https://github.com/JarvusInnovations/remarkable-axi/issues/21) for the
investigation and the tracking reference.

Why: porting ink onto a replacement means assembling a document from a **new**
upload's pages plus the **old** document's per-page `.rm` files. The obvious tool,
`rmapi-js`'s `putDocumentArchive`, is both marked experimental *and* documented to
assign the reuploaded document a **fresh id** — it does not round-trip a document in
place, and the library's own README records trouble reuploading a cloned document at
all. A second path was investigated — upload the new PDF, then use the high-level API
to declare the real per-page id list a multi-page PDF needs (the initial upload
declares only one, faked, page) before attaching `.rm` files to those ids — but
whether the device honors a client-supplied page list rather than regenerating its
own on first open is undocumented and could not be verified without a live-device
test, which was out of scope for the investigation that produced this note. Shipping
either path without that verification would be exactly the guessed constant
[Measure the device; never ship a guessed constant](../principles.md#measure-the-device-never-ship-a-guessed-constant)
warns against: a plausible mechanism that looks authoritative and silently
misplaces someone's handwriting.

The design below is preserved so a future attempt — ideally one with live-device
access to verify the page-list question — does not have to re-derive it.

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
