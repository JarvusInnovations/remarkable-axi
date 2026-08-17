import { describe, expect, test } from "vitest";
import {
  COMMAND_GROUPS,
  commandDoc,
  renderCommandHelp,
  renderTopLevelHelp,
} from "../src/reference.js";

describe("COMMAND_GROUPS", () => {
  test("Design leads the surface, holding the authoring commands", () => {
    expect(COMMAND_GROUPS[0]?.group).toBe("Design");
    expect(COMMAND_GROUPS[0]?.commands.map((c) => c.usage)).toContain(
      "page [--device <model>] [--landscape] [--css]",
    );
  });

  test("every declared group is non-empty", () => {
    // The renderer skips empty groups rather than printing a bare header, but
    // an empty group on the real surface means a command was dropped.
    for (const group of COMMAND_GROUPS) {
      expect(group.commands.length).toBeGreaterThan(0);
    }
  });

  test("put and get live in Move, source first and destination last", () => {
    const move = COMMAND_GROUPS.find((g) => g.group === "Move");
    expect(move?.commands.map((c) => c.usage)).toEqual([
      "put <src> <dest>",
      "get <path> [<dest>]",
    ]);
  });

  test("retired commands are not listed on the surface", () => {
    for (const retired of ["send", "replace", "fetch"]) {
      expect(commandDoc(retired)).toBeUndefined();
    }
  });
});

describe("renderTopLevelHelp", () => {
  test("is TOON — each group is a usage/summary table keyed by name, Design first", () => {
    const help = renderTopLevelHelp();
    // A bare manpage header would read `remarkable-axi — <description>`; this
    // is a TOON key instead, same as every other response.
    expect(help).toContain(
      'usage: "remarkable-axi <command> [args] [flags]"',
    );
    expect(help).toContain("Design[3]{usage,summary}:");
    expect(help.indexOf("Design[")).toBeLessThan(help.indexOf("Move["));
    expect(help).toContain("page [--device <model>] [--landscape] [--css]");
    expect(help).toContain("Move[2]{usage,summary}:");
    expect(help).toContain("put <src> <dest>");
    expect(help).toContain("get <path> [<dest>]");
  });

  test("the trailing hints are a block-form help[] array — the timeout note and both Run lines each own a line, none comma-joined", () => {
    const help = renderTopLevelHelp();
    expect(help).toContain(
      [
        "help[3]:",
        "  Every cloud call times out after 120s; set REMARKABLE_TIMEOUT=<seconds> to change it (0 waits indefinitely).",
        "  Run `remarkable-axi <command> --help` for usage on any command.",
        "  Run `remarkable-axi` with no arguments to see current tablet state.",
      ].join("\n"),
    );
  });
});

describe("renderCommandHelp", () => {
  test("renders put's flags and examples as block-form TOON arrays, one entry per line", () => {
    const help = renderCommandHelp("put");
    expect(help).toContain("usage: remarkable-axi put <src> <dest>");
    expect(help).toContain("flags[3]:");
    expect(help).toContain(
      "  --replace        swap the contents of the document already at <dest>",
    );
    expect(help).toContain("examples[4]:");
    expect(help).toContain(
      '  remarkable-axi put "https://example.com/post" /Articles',
    );
  });

  test("--replace states the safe upload-first ordering and names rm-then-put", () => {
    const help = renderCommandHelp("put");
    expect(help).toContain("uploads first, then trashes the old copy under a dated name");
    expect(help).toContain("rm-then-put");
  });

  test("renders get's flags and examples, including --as original — a flag description with its own commas stays unescaped since each flag is its own line", () => {
    const help = renderCommandHelp("get");
    expect(help).toContain('usage: "remarkable-axi get <path> [<dest>]"');
    expect(help).toContain(
      "  --as <fmt>      original, pdf (default), svg, or text",
    );
  });

  test("returns null for a retired command, so it falls through to the handler", () => {
    expect(renderCommandHelp("send")).toBeNull();
    expect(renderCommandHelp("replace")).toBeNull();
    expect(renderCommandHelp("fetch")).toBeNull();
  });
});
