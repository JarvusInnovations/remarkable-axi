# Behavior: Device calibration

## Rule

Every device model carries a **calibration status**, and it is visible wherever the
model's numbers are used. A figure taken from published specifications is never
presented with the same confidence as one measured on hardware.

## Applies To

`devices`, `page`, `render`, `check`, `get --overlay`, `setup device`.

## Details

### Why this is a behavior and not a footnote

This project's own principle is
[measure the device; never ship a guessed constant](../principles.md#measure-the-device-never-ship-a-guessed-constant).
The device table does not currently meet it: one model has been calibrated, and the
rest inherit published density figures and an ink-placement constant that is *expected*
to hold across hardware but has not been shown to.

That is a defensible position — the alternative is supporting one device — but only if
it is stated. Presenting five models in one uniform table implies five equal
confidences, and an author designing for an uncalibrated model has no way to know their
page box is inferred.

### What "calibrated" means

Three independent measurements, tracked per model:

| Measurement | Established by |
| --- | --- |
| **page box** | a full-bleed page at the derived size fills the panel edge to edge with no panning |
| **ink placement** | printed targets at known page coordinates, annotated on the device and solved by least squares — yielding the ink-per-point scale, confirming no per-page offset, and confirming the same scale at a second page size |
| **pen palette** | each colour pen index captured on-device alongside its name, written in that pen's own colour |

A model may be partially calibrated: a monochrome device has no colour palette to
establish, and its palette status is `n/a` rather than unverified.

### Current state

Only **RM02A (Paper Pro)** has been calibrated. The ink-placement solve used a
509×679pt page — that model's own page box — plus a US Letter page as the
cross-check, and the colour palette was read off a page written on it.

Every other model is unverified on every axis.

### Where it surfaces

`devices` carries the status as a column, not a footnote:

```
devices[5]{model,name,screen,dpi,pagePt,calibration,target}:
  RM02A,reMarkable Paper Pro,1620x2160,229,509x679pt,calibrated,yes
  RM110,reMarkable 2,1404x1872,226,447x596pt,"unverified (published specs)",no
  …
```

Commands that consume an uncalibrated model's numbers say so once, in their own
output, rather than assuming the user read the device table:

```
rendered:
  out: ./flyer.pdf
  device: RM110 — page box unverified, derived from published specs
  page: 447x596pt (injected)
```

`get --overlay` on a document from an uncalibrated model notes that ink placement rests
on a constant measured elsewhere, since misplaced ink is the failure this project
already treats as worse than no output.

The note is stated once per invocation and never repeated per page or per finding. A
caveat that appears on every row stops being read.

### Resolving a model

Calibration status is a fact about the world, not about the code, so it changes when
someone with the hardware measures it. Each unverified model carries a tracking issue
with the procedure, so a contributor with that device can complete it without reverse
engineering how the first one was done:

| Model | Issue |
| --- | --- |
| RM110 — reMarkable 2 | #10 |
| RM100 — reMarkable 1 | #11 |
| RM03A — reMarkable Paper Pro Move | #12 |
| RM102 — reMarkable Paper Pure | #13 |

The three measurements are independent, so a partial result still moves a model's
status. A measurement is accepted only with its provenance — what was measured, on
what, and with what residuals — because a number without that is exactly the guessed
constant this project declines to ship.

## Principles

**Inherited** — project principles that especially bite here:

- [Measure the device; never ship a guessed constant](../principles.md#measure-the-device-never-ship-a-guessed-constant)
  — this behavior is what keeps that principle honest where measurement is not
  currently possible.
- [Report the mismatch; do not silently correct the author](../principles.md#report-the-mismatch-do-not-silently-correct-the-author)
  — the same instinct applied to confidence: state what is inferred rather than
  presenting it as measured.
