---
status: planned
depends: []
specs:
  - specs/behaviors/page-geometry.md
  - specs/behaviors/device-calibration.md
  - specs/commands/page.md
issues: []
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

- [ ] `page` with a configured target reports device, screen, density, and page box
- [ ] `page --css` emits a block that renders full-bleed with no letterboxing
- [ ] `page --landscape` transposes the box and nothing else
- [ ] `page --device <model>` overrides without touching stored config
- [ ] `page` completes with no network and while unpaired
- [ ] `page` with no target and no `--device` fails `NO_DEVICE` listing the models
- [ ] `@page` detection returns absent / matching / differing-with-signed-delta
- [ ] Delta is reported in points and states which side of the box it falls on
- [ ] Detection is exercised by one test suite consumed by both render and check
- [ ] `devices` carries a calibration column; RM02A reads calibrated, the rest unverified
- [ ] `page`, `render`, and `check` state the caveat once per invocation for an uncalibrated target
- [ ] The caveat never repeats per page or per finding
- [ ] Each unverified model has an open tracking issue carrying the procedure

## Risks / unknowns

Four of five models are unverified, and they cannot be resolved from this repo — it
takes someone holding the hardware. The tracking issues are the mechanism, but they
may sit open indefinitely, so the flagging has to read as a durable statement of
confidence rather than a temporary apology.

Partial calibration needs a sensible representation: a monochrome device has no colour
palette to establish, so its palette status is `n/a` rather than unverified, and a
model could plausibly have a verified page box and an unverified ink transform.

## Notes

## Follow-ups
