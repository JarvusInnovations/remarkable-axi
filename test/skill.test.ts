import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  commandReferenceMarkdown,
  spliceGeneratedRegions,
} from "../src/skill.js";

describe("commandReferenceMarkdown", () => {
  test("renders every non-empty command group as a heading with bulleted npx invocations", () => {
    const md = commandReferenceMarkdown();
    expect(md).toContain("### Design");
    expect(md).toContain(
      "- `npx -y remarkable-axi page [--device <model>] [--landscape] [--css]` — Report the target device's page box, and the CSS to author against it",
    );
    expect(md).toContain("### Move");
    expect(md).toContain("- `npx -y remarkable-axi put <src> <dest>`");
    // Groups render in COMMAND_GROUPS order, Design first.
    expect(md.indexOf("### Design")).toBeLessThan(md.indexOf("### Move"));
  });

  test("never emits a bare `remarkable-axi` invocation — every example runs via npx with no global install", () => {
    const md = commandReferenceMarkdown();
    const lines = md.split("\n").filter((l) => l.startsWith("- `"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain("npx -y remarkable-axi ");
    }
  });
});

describe("spliceGeneratedRegions", () => {
  test("replaces content between BEGIN/END markers and leaves surrounding prose untouched", () => {
    const doc = [
      "# Skill",
      "",
      "prose before",
      "",
      "<!-- BEGIN GENERATED: command-reference -->",
      "stale content",
      "<!-- END GENERATED: command-reference -->",
      "",
      "prose after",
      "",
    ].join("\n");

    const out = spliceGeneratedRegions(doc);

    expect(out).toContain("prose before");
    expect(out).toContain("prose after");
    expect(out).not.toContain("stale content");
    expect(out).toContain("### Design");
  });

  test("is idempotent — splicing an already-spliced document produces no further change", () => {
    const doc = [
      "<!-- BEGIN GENERATED: command-reference -->",
      "<!-- END GENERATED: command-reference -->",
    ].join("\n");
    const once = spliceGeneratedRegions(doc);
    const twice = spliceGeneratedRegions(once);
    expect(twice).toBe(once);
  });

  test("throws when a declared region's markers are missing, rather than silently leaving the doc stale", () => {
    expect(() => spliceGeneratedRegions("# no markers here")).toThrow(
      /missing the generated region markers/,
    );
  });
});

describe("skills/remarkable-axi/SKILL.md", () => {
  test("the committed file's generated region matches the generator (the CI drift gate)", () => {
    const path = new URL(
      "../skills/remarkable-axi/SKILL.md",
      import.meta.url,
    );
    const committed = readFileSync(path, "utf8");
    expect(spliceGeneratedRegions(committed)).toBe(committed);
  });

  test("references both companion files with a when-to-open cue", () => {
    const path = new URL(
      "../skills/remarkable-axi/SKILL.md",
      import.meta.url,
    );
    const committed = readFileSync(path, "utf8");
    expect(committed).toContain("references/ink-recovery.md");
    expect(committed).toContain("references/ssh-setup.md");
  });
});
