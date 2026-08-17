---
status: done
pr: 38
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

- [x] Replace refusal and success both report `last_synced`
- [x] Refusal carries the blind-spot line verbatim from the spec
- [x] A document whose only `.rm` entries are zero-stroke replaces without
      `--discard-ink` (closes #28)
- [x] A genuinely inked page still refuses
- [x] The zero-stroke detection method and its measurement are doc-commented

## Risks / unknowns

- **Threshold safety** — a wrong size threshold silently discards real ink, the
  worst failure available here. When in doubt, fetch and parse; the cost is per
  candidate page on a replace, not per listing.

## Notes

Issue #28 turned out to carry only the field report and the author's own
analysis, not a captured zero-stroke `.rm` file — so "measure real
zero-stroke `.rm` entries" from the Approach had no real sample to measure.
Measured against the v6 `.rm` codec's own writer instead (`rmapi-js`'s
`rm6.js`, invoked directly to build and serialize both a minimal
opened-but-undrawn scene and the same scene plus a single-point stroke):

| case | bytes |
| --- | --- |
| opened, zero strokes (scene tree, layer, page-info, scene-info) | ~176 |
| same, plus an author-id table | ~209 |
| + smallest possible real stroke (one-point tap) | +~74 |

That ~74-byte margin is real (it's dictated by the wire format, not device
behavior) but not provably safe: nothing bounds how large the device's own
zero-stroke scaffolding gets in practice (extra layers, undo/redo history, a
larger author table on a multi-device doc), and the Risks section is explicit
that a wrong threshold silently discards real ink — the worst failure
available here. So per the plan's own fallback, `detectInk` fetches and
parses every candidate `.rm` entry instead of trusting size, reusing
`pageGeometry` (the function `get --overlay` already trusts) to decide.
Full reasoning is doc-commented on `detectInk` in `src/commands/put.ts`.

Test suite was contended by concurrent sibling-plan test runs on the same
machine during verification, which produced transient Chrome-render timeouts
unrelated to this change. Isolated reruns of the affected files at a
generous timeout confirmed only the two known-environmental `NO_DEVICE`
failures (issue #34) remain; all `put.test.ts` cases (existing and new) pass
cleanly.

## Follow-ups

- None identified. The device-extended gate (closing the blind spot at the
  gate rather than just disclosing it) is out of scope here by design — it
  rides [`device-reattach`](device-reattach.md), per the plan's Scope.
- The `.rm` size measurement is against the codec's writer, not a captured
  real-device sample. If a genuine zero-stroke `.rm` file is ever captured
  (e.g. attached to a future issue), it would be worth confirming this
  analysis empirically — though the fetch-and-parse approach doesn't
  *require* that confirmation to be correct, only a future size-threshold
  optimization would.
