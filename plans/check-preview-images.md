---
status: done
pr: 32
depends: []
specs:
  - specs/commands/check.md
issues: []
---

# Preview-scaled check images with a full-res escape hatch

## Scope

`check`'s written page images become previews by default — downscaled to fit within
1568px on the long edge, never upscaled — with `--full-res` restoring native
resolution, per the new
[Page images are previews by default](../specs/commands/check.md#page-images-are-previews-by-default)
section. The output states both the preview and native sizes, and the help lines
always include the `--full-res` invocation whenever images were preview-scaled.

Out of scope: any change to what the lint rules measure (they stay at native
density); the design-loop hints
([`design-loop-disclosure`](design-loop-disclosure.md)).

## Implements

- `specs/commands/check.md` — the preview-scale section, the `--full-res` flag, the
  `images:` size line, and the mandatory escape-hatch help line

## Approach

Rasterization for findings is untouched — rules keep measuring the native-density
raster. The preview is a downscale applied only at image-write time:

- Downscale **in pixel space, on the exact raster the findings measured** — between
  `rasterizePage` and `encodeGrayscalePng` in the check pipeline. Never a second
  Ghostscript pass at a lower `-r`: that is a re-render (different antialiasing
  coverage, different pixel-grid decisions), so the preview could disagree with
  what was measured. Resampling the measured pixels is arithmetic; rendering is
  already frozen before it runs.
- Filter: area-average (box) over the grayscale buffer — the right filter for
  minification, it integrates ink coverage the same way Ghostscript's `AlphaBits`
  antialiasing does, and it is a few dozen lines over a `Uint8Array` with no new
  dependency, consistent with the PGM/own-PNG-encoder stance in `src/lint/`.
- Fit 1568px on the long edge; skip when native is already within it — never
  upscale.
- `--full-res` skips the downscale. Unknown-flag validation gains the flag; `--help`
  documents it via `reference.ts`.
- The `images:` summary line reports `WxH (preview of native WxH)`, or the native
  size alone under `--full-res`.
- When any written image was downscaled, append the
  `Run \`remarkable-axi check <file> --full-res\` for native-resolution images`
  help line. Under `--full-res`, or when nothing was downscaled, omit it.

1568 is a constant with a stated rationale (the agent-vision ingestion ceiling),
not a measured device property — keep it a named constant with the rationale in a
doc comment, so a future ceiling change is one edit.

## Validation

- [x] Default `check` on a Paper Pro target writes images at 1176x1568 and reports
      `preview of native 1620x2160` — verified as a unit test against the mocked
      1620x2160 target (`fitDimensions(1620, 2160)` in `test/lint/resample.test.ts`);
      an actual Ghostscript run against paper-pro lands one pixel off this idealized
      number (1175x1568 of native 1619x2160) — see Notes.
- [x] `--full-res` writes native-resolution images and reports the native size only
- [x] A document whose native raster is already within 1568px is not upscaled and
      gets no escape-hatch hint
- [x] Findings are byte-identical between a default and a `--full-res` run of the
      same document
- [x] The escape-hatch help line appears exactly when at least one written image was
      downscaled
- [x] `--no-images` with `--full-res` is not an error (full-res simply has nothing
      to affect)

## Risks / unknowns

- **Downscale quality** — a naive nearest-neighbor downscale can alias fine line
  work into invisibility and misrepresent the design; the area-average filter in
  the approach is the mitigation. Eyeball a hairline-heavy fixture at preview
  scale before shipping.
- **Human fidelity at 0.73×** — body text stays legible but pixel-level line work
  softens; that is what `--full-res` is for, and the always-advertised hint is the
  mitigation. If review shows 1568 too lossy in practice, the constant moves — the
  spec's rationale, not the number, is the contract.

## Notes

- **The spec's Output example can't be produced literally.** `specs/commands/check.md`
  shows a scalar `images: …` summary line immediately followed by the per-page table
  headed `images[1]{page,path}:` — two lines both keyed `images`. Verified empirically
  (see PR #32's description) that this is not achievable: `check`'s output is a plain
  JS object, TOON's `encode()` renders one line per `Object.keys` entry, and a JS
  object cannot hold two properties under the same key. The implementation keeps the
  summary under `images` (matching the spec's line verbatim) and moved the table to a
  new `image_files` key, same position and order the spec shows. Flagged as a
  deviation rather than silently resolved — see Follow-ups.
- **Ghostscript's own rounding means "1620x2160" isn't the literal native raster.**
  `pageBox()` derives paper-pro's PDF page box from its native pixels rounded to whole
  points (1620/229*72 ≈ 509.17pt → 509pt), and Ghostscript then rasterizes that
  rounded point box back to pixels at 229dpi, landing one pixel short on the width
  (1619, not 1620) in practice. This is pre-existing rounding-chain behavior, not
  introduced by this plan — `test/commands/check.test.ts`'s preview-scale tests derive
  their expected native size from an actual `--full-res` run rather than hard-coding
  the idealized device pixel count, so they pass against Ghostscript's real output.
  The Validation checkbox above is satisfied via the idealized-number unit test
  (`fitDimensions(1620, 2160)`), per the task's own allowance for that.
- Resampling: a hand-rolled separable box (area-average) filter in
  `src/lint/resample.ts`, weighting partial source pixels by their coverage of the
  destination span so non-integer scale ratios resample correctly (not just clean
  divisors). No new dependency.
- Manually eyeballed a ten-hairline fixture (0.08pt–1.43pt rules plus body text) at
  both default and `--full-res` scale — every hairline, including the thinnest,
  stayed visible and distinguishable at preview scale; text stayed legible.

## Follow-ups

- Consider a small correction to `specs/commands/check.md`'s Output example so it
  shows the achievable `images:` + `image_files[1]{page,path}:` shape (or otherwise
  documents the key split) rather than the literal-but-unproducible dual `images`
  lines — see the Notes entry above and PR #32's description for the full reasoning.
- The design-loop-disclosure plan (out of scope here) will add more help lines to
  `check`'s output (an eye-pass hint, a `put` hint) around the same `help` array this
  plan appends the `--full-res` escape hatch to — worth a quick look at final line
  ordering once that plan lands, since this plan's diff only appended to the end.
