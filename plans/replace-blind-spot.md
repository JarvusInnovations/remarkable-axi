---
status: planned
depends: []
specs:
  - specs/behaviors/ink-preservation.md
  - specs/commands/put.md
issues: [28]
---

# Replace blind-spot disclosure and real-ink HAS_INK

## Scope

The cloud-side prevention pair, independent of all SSH work:

1. Every `put --replace` — refusal and success — reports the target's
   `last_synced` age, and the refusal carries the blind-spot line ("ink written
   on-device since then is invisible to this check").
2. `HAS_INK` counts only stroke-bearing pages, fixing the zero-stroke false
   positive (#28) that trains the `--discard-ink` reflex.

Out of scope: the device-extended gate (specced as unverified intent; measurement
rides [`device-reattach`](device-reattach.md)).

## Implements

- `specs/behaviors/ink-preservation.md` — the "Cloud checks see only synced ink"
  disclosure and the stroke-bearing refinement
- `specs/commands/put.md` — `last_synced` in replace output

## Approach

- `last_synced`: the target entry's cloud lastModified rendered with the existing
  `age()` helper — already in hand from the tree walk, zero extra requests.
- Zero-stroke detection: measure real zero-stroke `.rm` entries (issue #28 has a
  captured case) and determine whether entry size separates them from inked pages
  by a safe margin. If yes, ship the measured threshold with the measurement
  doc-commented; if the margin is unsafe, fetch and parse the `.rm` header for
  candidate pages only — either way the spec's "no guessing" bar is met and the
  choice is recorded.
- Refusal message keeps its exact shape plus the two new lines; success output
  gains `last_synced`.
- Tests: refusal on a genuinely inked page; no refusal on a zero-stroke page;
  `last_synced` present in both outcomes.

## Validation

- [ ] Replace refusal and success both report `last_synced`
- [ ] Refusal carries the blind-spot line verbatim from the spec
- [ ] A document whose only `.rm` entries are zero-stroke replaces without
      `--discard-ink` (closes #28)
- [ ] A genuinely inked page still refuses
- [ ] The zero-stroke detection method and its measurement are doc-commented

## Risks / unknowns

- **Threshold safety** — a wrong size threshold silently discards real ink, the
  worst failure available here. When in doubt, fetch and parse; the cost is per
  candidate page on a replace, not per listing.

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
