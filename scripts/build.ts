#!/usr/bin/env bun
/**
 * Bundle the CLI into a single self-contained `dist/bin.js`.
 *
 * Bundling is not just a size optimization here. `rmapi-js` imports
 * `crc-32/crc32c` without a file extension, and `crc-32` publishes no
 * `exports` map, so Node's ESM resolver cannot resolve it — running the
 * unbundled output under plain `node` fails outright. esbuild resolves that
 * specifier at build time. It also makes `npx -y remarkable-axi` fetch one
 * file instead of installing the whole dependency tree.
 */
import { build } from "esbuild";
import { readFile, chmod, rm } from "node:fs/promises";

const OUT = "dist/bin/remarkable-axi.js";

/**
 * The published version is exactly `package.json`'s, matching the bare string
 * the other *-axi tools print. The release workflow rewrites that field from
 * the release tag before building, so no `git describe` is involved — which
 * also keeps the build independent of checkout depth in CI.
 */
async function resolveVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
    version: string;
  };
  return pkg.version;
}

const version = await resolveVersion();

await rm("dist", { recursive: true, force: true });

const result = await build({
  entryPoints: ["bin/remarkable-axi.ts"],
  outfile: OUT,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: false,
  sourcemap: false,
  banner: { js: "#!/usr/bin/env node" },
  define: { __REMARKABLE_AXI_VERSION__: JSON.stringify(version) },
  // Node builtins that esbuild would otherwise try to polyfill, plus jsdom.
  // jsdom is ~12MB of transitive tree and resolves fine under Node's ESM
  // loader on its own, so it stays a normal runtime dependency; everything
  // else is inlined, which is what fixes rmapi-js's unresolvable
  // `crc-32/crc32c` import.
  external: ["node:*", "jsdom"],
  logLevel: "warning",
  metafile: true,
});

await chmod(OUT, 0o755);

const bytes = (await readFile(OUT)).byteLength;
const inputs = Object.keys(result.metafile.outputs[OUT]?.inputs ?? {}).length;

// A tiny sanity gate: a bundle this small means a dependency silently
// externalized and the CLI would fail at runtime instead of at build time.
if (bytes < 50_000) {
  console.error(
    `bundle is only ${bytes} bytes — a dependency was likely not inlined`,
  );
  process.exit(1);
}

// Build metadata is reported here rather than written into dist/, which the
// package `files` entry ships verbatim — it has no business in the tarball.
console.error(
  `built ${OUT} — ${(bytes / 1024).toFixed(0)}KB from ${inputs} modules, version ${version}`,
);
