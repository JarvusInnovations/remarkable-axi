import { describe, expect, test } from "vitest";
import {
  COMMAND_GROUPS,
  commandDoc,
  renderCommandHelp,
  renderTopLevelHelp,
} from "../src/reference.js";

describe("COMMAND_GROUPS", () => {
  test("declares an empty Design group so a sibling command slots in cleanly", () => {
    const design = COMMAND_GROUPS.find((g) => g.group === "Design");
    expect(design).toBeDefined();
    expect(design?.commands).toEqual([]);
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
  test("does not crash on the empty Design group, and omits it", () => {
    const help = renderTopLevelHelp();
    expect(help).not.toContain("Design:");
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
