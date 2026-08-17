---
status: planned
depends: []
specs:
  - specs/behaviors/design-loop.md
  - specs/commands/page.md
  - specs/commands/check.md
issues: []
---

# Teach the design loop through the tool's own hints

## Scope

Make the page-design workflow — `page` → author → `check` + read the page image →
iterate → `put` — discoverable from the CLI's own output alone, per
[design-loop](../specs/behaviors/design-loop.md): the home-view design entry hint,
`page`'s check hint, and `check`'s eye-pass and put hints. Also the self-explaining
transposed-page-box finding in `check`, so a landscape design no longer needs
outside knowledge to interpret.

Out of scope: preview-scaled images and the `--full-res` hint
([`check-preview-images`](check-preview-images.md)); TOON `--help` and block-form
help arrays ([`help-format-conformance`](help-format-conformance.md)). The
`--full-res` hint ships with the preview plan since it only exists once preview
scaling does.

## Implements

- `specs/behaviors/design-loop.md` — the whole behavior
- `specs/commands/page.md` — the check hint appended to both output forms
- `specs/commands/check.md` — the eye-pass and put help lines; the transposed
  page-box finding wording

## Approach

All hint text lands in or beside `src/reference.ts` so the single-source rule holds;
the home-view hint joins the standing suggestions the home view already emits, and
the per-command hints are emitted by their commands' output paths.

- Home view: add the design entry line to the standing help suggestions.
- `page`: append the check hint to both the plain and `--css` outputs.
- `check`: when images were written, prepend the eye-pass hint naming the first
  image path, and append the put hint carrying the checked file as source with
  `<dest>` as placeholder.
- Transposed box: in the page-box rule, detect width/height exactly swapped against
  the device box and emit the landscape wording from the spec instead of the raw
  signed delta.

No enforcement anywhere: hints only, per the behavior's local principle.

## Validation

- [ ] Home view help includes the `page --css` design entry line
- [ ] `page` and `page --css` both end with the check hint
- [ ] `check` with images emits the eye-pass hint naming a real written image path,
      and the put hint carrying the checked file
- [ ] `check --no-images` emits neither eye-pass nor put hint
- [ ] A landscape page (device box transposed) produces the self-explaining finding,
      not a raw delta; a genuinely mismatched box still produces the signed delta
- [ ] All hint strings live in/derive from `reference.ts`-adjacent single source —
      no duplicated wording in command modules

## Risks / unknowns

- **Hint noise on non-design checks** — `check` on a downloaded deck also gets the
  eye-pass hint. Judged acceptable: the hint is one line and reading the image is a
  sensible next step for any checked document; revisit if it reads as noise in
  practice.

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
