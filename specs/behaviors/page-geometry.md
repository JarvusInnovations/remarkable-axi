# Behavior: Page geometry

## Rule

Every document this tool produces or evaluates is measured against the **target
device's page box** — the full-bleed portrait page size at which a PDF fills that
device's panel edge to edge, in points.

The tool derives that box; the user never does.

## Applies To

`page`, `render`, `check`, `put` (when converting an HTML source), `devices`,
`setup device`.

## Details

### The page box

Each known model declares a pixel screen size and a rendering density. The page box
is those pixels converted to points at that density, **rounded to whole points**,
because headless Chrome rounds its print box to integer points and the author must
not have to know that.

For the 1404×1872 @ 226dpi models this yields `447 × 596pt`.

`--landscape` transposes the box. Nothing else changes.

### Why a mismatch matters

The device renders a PDF at its natural physical size at ~227dpi and pans; it does
not scale a page to fit. So a page smaller than the box under-fills the panel at true
size, and a larger one overflows and must be scrolled to read. A mismatch report
therefore states **which side** it is on and **by how much**, in points — not merely
that the sizes differ.

### Detection and injection

Given an HTML source, the tool inspects the document's declared `@page` size:

| Declared | `render` and `put` | `check` |
| --- | --- | --- |
| none | inject the device page box; state that it was injected | finding: no `@page`, would default to Letter |
| matches the device box | proceed | no finding |
| differs from the device box | **honor the declaration**, warn with the signed delta | finding, with the signed delta |

Honoring a differing declaration follows [Report the mismatch; do not silently
correct the author](../principles.md#report-the-mismatch-do-not-silently-correct-the-author):
the surrounding layout was written against the declared box, so substituting a
different one invalidates every dimension built on it.

`--device-page` overrides a differing declaration with the device box.
`--strict` makes a differing declaration fatal.

### Shared rule, two dispositions

`check` and `render` share one detection path, one threshold, and one message.
`check` reports; `render` acts. What `check` warns about is exactly what `render`
would do — they must never be able to disagree.

### No target set

Commands that need the page box and find no device target fail with a structured
error naming `setup device` and listing the models, rather than assuming a default
model. Guessing here would silently produce documents sized for hardware the user
does not own.

## Principles

**Inherited** — project principles that especially bite here:

- [The tablet is a design target, not just a destination](../principles.md#the-tablet-is-a-design-target-not-just-a-destination)
  — this behavior is the mechanism that principle demands.
- [Report the mismatch; do not silently correct the author](../principles.md#report-the-mismatch-do-not-silently-correct-the-author)
  — governs the differing-declaration row of the table above.
- [Measure the device; never ship a guessed constant](../principles.md#measure-the-device-never-ship-a-guessed-constant)
  — why an absent device target is an error rather than a default.
