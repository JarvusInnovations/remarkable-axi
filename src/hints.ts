/**
 * The design-loop hint chain's wording, in one place — `page` to get the
 * geometry, `check` plus the eye-pass to judge it, `put` to ship it — so the
 * strings that stitch the loop together aren't scattered across the command
 * files that emit them one link at a time.
 *
 * See `specs/behaviors/design-loop.md`. This sits beside `reference.ts`
 * rather than in it because these are runtime help-line content, not the
 * command surface `reference.ts` documents (usage/flags/`--help` text); the
 * single-source rule that file exists for is about the surface description,
 * and this module is the analogous single source for this one behavior's
 * hint text.
 */

/** The home view's entry point into the design loop — both the populated
 * and zero-documents branches carry it, since an empty tablet is a prime
 * candidate for a designed page. */
export const DESIGN_ENTRY_HINT =
  "Run `remarkable-axi page --css` to start designing a page for the tablet — check and eyeball a preview before you put";

/** `page`'s pointer at the iteration loop — appended to both its plain and
 * `--css` output forms. */
export const CHECK_ITERATE_HINT =
  "Run `remarkable-axi check <html>` as you iterate — it renders and lints in one call, before any upload";

/** `check`'s eye-pass hint: the one step no finding measures. Only emitted
 * when at least one page image was actually written. */
export function eyePassHint(imagePath: string): string {
  return `Read ${imagePath} to critique the layout by eye — findings measure the panel, not the design`;
}

/** `check`'s exit from the loop, carrying the checked file forward as the
 * `put` source. `<dest>` stays a literal placeholder — `check` has no
 * destination to fill in. */
export function putHint(file: string): string {
  return `Run \`remarkable-axi put ${file} <dest>\` once the layout reads well`;
}
