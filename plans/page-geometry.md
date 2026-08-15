---
status: done
depends: []
specs:
  - specs/behaviors/page-geometry.md
  - specs/behaviors/device-calibration.md
  - specs/commands/page.md
issues: [10, 11, 12, 13]
pr: 15
---

# Page geometry and the page command

## Scope

Make the device page box a first-class, shared value: derive it from the model table,
expose it with a `page` command, and build the `@page` detection that `render` and
`check` both consume.

## Implements

- `specs/behaviors/page-geometry.md`
- `specs/behaviors/device-calibration.md`
- `specs/commands/page.md`

## Approach

`devices` already knows each model's screen and density, and already prints a
`pagePt`. What is missing is that nothing *uses* it: documents get authored against
hand-derived numbers because the geometry is only available if you think to ask.

Extract the box derivation — pixels to points at the model's density, rounded to whole
points because Chrome rounds its print box — into one place that `page`, `render`,
`check`, and `put` all call.

Build `@page` detection here rather than in `render`, so the detection, the threshold,
and the message are shared and `check` and `render` cannot disagree about the page
box.

`page` makes no cloud call, works unpaired, and emits the CSS block with custom
properties so internal layout math references the box by name rather than repeating a
literal.

Commands needing the box with no device target set fail with `NO_DEVICE` rather than
assuming a model, because guessing produces documents sized for hardware the user does
not own.

Add calibration status to the model table and surface it wherever a model's numbers
are used. Only RM02A has been measured; the other four inherit published density
figures, and presenting all five in one uniform table implies a confidence the project
does not have. Each unverified model gets a tracking issue carrying the procedure, so a
contributor with that hardware can resolve it.

## Validation

- [x] `page` with a configured target reports device, screen, density, and page box
- [x] `page --css` emits a block that renders full-bleed with no letterboxing
- [x] `page --landscape` transposes the box and nothing else
- [x] `page --device <model>` overrides without touching stored config
- [x] `page` completes with no network and while unpaired
- [x] `page` with no target and no `--device` fails `NO_DEVICE` listing the models
- [x] `@page` detection returns absent / matching / differing-with-signed-delta
- [x] Delta is reported in points and states which side of the box it falls on
- [ ] Detection is exercised by one test suite consumed by both render and check
- [x] `devices` carries a calibration column; RM02A reads calibrated, the rest unverified
- [ ] `page`, `render`, and `check` state the caveat once per invocation for an uncalibrated target
- [ ] The caveat never repeats per page or per finding
- [x] Each unverified model has an open tracking issue carrying the procedure

## Risks / unknowns

Four of five models are unverified, and they cannot be resolved from this repo — it
takes someone holding the hardware. The tracking issues are the mechanism, but they
may sit open indefinitely, so the flagging has to read as a durable statement of
confidence rather than a temporary apology.

Partial calibration needs a sensible representation: a monochrome device has no colour
palette to establish, so its palette status is `n/a` rather than unverified, and a
model could plausibly have a verified page box and an unverified ink transform.

## Notes

`page --css` "renders full-bleed with no letterboxing" was verified as a property, not
on real hardware: `test/page.test.ts` asserts the emitted block declares `margin: 0`
on every rule and, for every model, round-trips through `parseDeclaredPageBox` back to
exactly the device box (`detectPageBox` reports `matches`). That is everything this
repo can confirm without a tablet on the desk.

Two validation lines are left unchecked because they describe `render` and `check`
consuming this plan's output, and neither command exists yet — `render-command` and
`check-command` are separate, dependent plans. What this plan delivers is the shared
unit itself: `detectPageBox`/`describeDelta` in `src/page.ts`, fully tested in
isolation (absent/matches/differs, signed per-axis delta, which side it falls on), and
`pageBoxCaveat` in `src/devices.ts` for the once-per-invocation caveat wording. `page`
itself does state the caveat correctly (verified) — the checkbox is about all three
commands agreeing, which needs the other two plans landed to confirm.

`resolveTarget` and `pageBoxCaveat` in `src/devices.ts` are the reuse points those two
plans should call rather than reimplementing device resolution or calibration wording.

Known limitation, not currently blocking: `parseDeclaredPageBox` only resolves numeric
`@page { size: ... }` values (pt/in/mm/cm/px). A keyword page size (`A4`, `letter`)
reads as "no declaration" rather than as a differing declaration. Every document this
tool itself emits or injects is numeric, so this doesn't affect the round-trip case;
it would only matter for arbitrary uploaded HTML that declares a keyword size, which
is `render`'s and `check`'s problem to hit, not this plan's.

## Follow-ups

- Deferred to plan: `render-command` — consume `detectPageBox`/`describeDelta` for
  injection + the differing-declaration warning, and state `pageBoxCaveat` once in its
  own output; confirms the two unticked validation lines above once merged.
- Deferred to plan: `check-command` — consume the same detection for its page-box
  finding, so the "detection exercised by one suite consumed by both" line closes;
  also the natural place to decide whether keyword `@page` sizes need support.
- Tracked as: issues #10 (RM110), #11 (RM100), #12 (RM03A), #13 (RM102) — the four
  hardware calibrations this plan could not perform from the repo.
- None: the epsilon (`MATCH_EPSILON = 0.5pt`) chosen for "matches" in `detectPageBox`
  isn't specified numerically anywhere upstream; documented inline with its rationale
  (Chrome rounds its own print box to whole points). Revisit only if a later plan's
  real-world testing shows it too loose or too tight.
