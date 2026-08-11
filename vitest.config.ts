import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        // rmapi-js imports `crc-32/crc32c` without a file extension, and
        // crc-32 publishes no `exports` map, so Node's ESM resolver cannot
        // resolve it. The production build sidesteps this by bundling with
        // esbuild, which resolves the specifier at build time.
        //
        // Tests load modules through Vite, so any suite that *value*-imports
        // rmapi-js needs the extension supplied here. Type-only imports are
        // erased and unaffected, which is why most suites never hit this.
        find: /^crc-32\/crc32c$/,
        replacement: "crc-32/crc32c.js",
      },
    ],
  },
  test: {
    server: {
      deps: {
        // The broken specifier lives inside rmapi-js itself. Without inlining,
        // vitest hands that package to Node's resolver and the alias above
        // never gets a chance to apply.
        inline: ["rmapi-js"],
      },
    },
  },
});
