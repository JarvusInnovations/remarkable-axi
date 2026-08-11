// No shebang here on purpose: scripts/build.ts adds one as an esbuild banner,
// and having it in both places puts a second `#!` on line 2 of the bundle,
// which is a syntax error.

// Imported first, before anything can reach the hashing code that needs it.
import "../src/polyfill.js";
import { main } from "../src/cli.js";

await main();
