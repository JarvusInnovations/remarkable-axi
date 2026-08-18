#!/usr/bin/env bun
/**
 * Splice the generated command-reference region into
 * skills/remarkable-axi/SKILL.md. The prose outside the markers is
 * hand-authored and never touched.
 *
 *   bun scripts/build-skill.ts            # rewrite SKILL.md
 *   bun scripts/build-skill.ts --check    # exit nonzero if SKILL.md is stale
 *
 * This is the drift gate specs/skill.md requires: `reference.ts` is the one
 * place the command surface is described, so a command added there without
 * running this script leaves the shipped skill out of date, and CI catches it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spliceGeneratedRegions } from "../src/skill.js";

const PATH = new URL("../skills/remarkable-axi/SKILL.md", import.meta.url);
const check = process.argv.includes("--check");

const src = readFileSync(PATH, "utf8");
const out = spliceGeneratedRegions(src);

if (check) {
  if (src !== out) {
    console.error(
      "skills/remarkable-axi/SKILL.md is out of date — run `bun run build:skill` and commit the result",
    );
    process.exit(1);
  }
  console.log("skills/remarkable-axi/SKILL.md is up to date");
} else if (src !== out) {
  writeFileSync(PATH, out);
  console.log("Updated skills/remarkable-axi/SKILL.md generated regions");
} else {
  console.log("skills/remarkable-axi/SKILL.md already up to date");
}
