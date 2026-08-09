// No shebang here on purpose: scripts/build.ts adds one as an esbuild banner,
// and having it in both places puts a second `#!` on line 2 of the bundle,
// which is a syntax error.
import { main } from "../src/cli.js";

await main();
