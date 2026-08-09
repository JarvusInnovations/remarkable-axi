/**
 * Build-stamped version.
 *
 * `scripts/build.ts` substitutes this identifier at bundle time via esbuild's
 * `define`. Running from a source checkout leaves it undeclared, which
 * `typeof` handles without throwing, so the dev fallback applies.
 */
declare const __REMARKABLE_AXI_VERSION__: string | undefined;

export const version =
  typeof __REMARKABLE_AXI_VERSION__ === "string"
    ? __REMARKABLE_AXI_VERSION__
    : "0.0.0-dev";
