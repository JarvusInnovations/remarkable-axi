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
  test("prints every group, Design first", () => {
    const help = renderTopLevelHelp();
    expect(help).toContain("Design:");
    expect(help.indexOf("Design:")).toBeLessThan(help.indexOf("Move:"));
    expect(help).toContain("page [--device <model>] [--landscape] [--css]");
    expect(help).toContain("Move:");
    expect(help).toContain("put <src> <dest>");
    expect(help).toContain("get <path> [<dest>]");
  });
});

describe("renderCommandHelp", () => {
  test("renders put's flags and examples", () => {
    const help = renderCommandHelp("put");
    expect(help).toContain("usage: remarkable-axi put <src> <dest>");
    expect(help).toContain("--replace");
  });

  test("renders get's flags and examples, including --as original", () => {
    const help = renderCommandHelp("get");
    expect(help).toContain("usage: remarkable-axi get <path> [<dest>]");
    expect(help).toContain("original");
  });

  test("returns null for a retired command, so it falls through to the handler", () => {
    expect(renderCommandHelp("send")).toBeNull();
    expect(renderCommandHelp("replace")).toBeNull();
    expect(renderCommandHelp("fetch")).toBeNull();
  });
});
