import { describe, expect, test } from "vitest";
import { AxiError } from "axi-sdk-js";
import { bool, parseFlags, requirePositional, str } from "../src/flags.js";

describe("parseFlags", () => {
  test("collects positionals", () => {
    const parsed = parseFlags("mv", ["/a", "/b"], {});
    expect(parsed.positional).toEqual(["/a", "/b"]);
  });

  test("reads a value flag in both spaced and equals form", () => {
    const spaced = parseFlags("send", ["url", "--dir", "/Books"], {
      value: ["--dir"],
    });
    const equals = parseFlags("send", ["url", "--dir=/Books"], {
      value: ["--dir"],
    });
    expect(str(spaced, "--dir", "/")).toBe("/Books");
    expect(str(equals, "--dir", "/")).toBe("/Books");
    expect(spaced.positional).toEqual(["url"]);
    expect(equals.positional).toEqual(["url"]);
  });

  test("reads boolean switches", () => {
    const parsed = parseFlags("ls", ["--all"], { boolean: ["--all"] });
    expect(bool(parsed, "--all")).toBe(true);
    expect(bool(parseFlags("ls", [], { boolean: ["--all"] }), "--all")).toBe(
      false,
    );
  });

  test("rejects an unknown flag by name and lists valid ones", () => {
    // A silently dropped flag would hand the agent output it believes is
    // filtered, so this must fail rather than be ignored.
    try {
      parseFlags("ls", ["--stat"], { boolean: ["--all"] });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      const axi = error as AxiError;
      expect(axi.code).toBe("UNKNOWN_FLAG");
      expect(axi.message).toContain("--stat");
      expect(axi.suggestions.join(" ")).toContain("--all");
    }
  });

  test("gives a targeted hint for a deprecated flag", () => {
    try {
      parseFlags("send", ["--format", "pdf"], {
        value: ["--dir"],
        deprecated: { "--format": "--format was removed; use `put` instead" },
      });
      throw new Error("should have thrown");
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.suggestions).toEqual([
        "--format was removed; use `put` instead",
      ]);
    }
  });

  test("reports no-flag commands clearly", () => {
    try {
      parseFlags("doctor", ["--verbose"], {});
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as AxiError).suggestions.join(" ")).toContain(
        "takes no flags",
      );
    }
  });

  test("--help always passes", () => {
    const parsed = parseFlags("doctor", ["--help"], {});
    expect(parsed.flags["--help"]).toBe(true);
  });

  test("a value flag with no value fails", () => {
    expect(() => parseFlags("send", ["--dir"], { value: ["--dir"] })).toThrow(
      "requires a value",
    );
    expect(() =>
      parseFlags("send", ["--dir", "--title"], { value: ["--dir", "--title"] }),
    ).toThrow("requires a value");
  });

  test("a switch given a value fails", () => {
    expect(() =>
      parseFlags("ls", ["--all=yes"], { boolean: ["--all"] }),
    ).toThrow("takes no value");
  });

  test("everything after -- is positional", () => {
    const parsed = parseFlags("put", ["--", "--weird-name.pdf"], {});
    expect(parsed.positional).toEqual(["--weird-name.pdf"]);
  });

  test("a bare - is positional, not a flag", () => {
    expect(parseFlags("put", ["-"], {}).positional).toEqual(["-"]);
  });
});

describe("requirePositional", () => {
  test("returns the value when present", () => {
    const parsed = parseFlags("mkdir", ["/Books"], {});
    expect(requirePositional(parsed, 0, "a path", "usage")).toBe("/Books");
  });

  test("throws a usage error when absent", () => {
    const parsed = parseFlags("mkdir", [], {});
    try {
      requirePositional(parsed, 0, "a folder path", "Run `mkdir <path>`");
      throw new Error("should have thrown");
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.code).toBe("USAGE");
      expect(axi.message).toBe("a folder path is required");
      expect(axi.suggestions).toEqual(["Run `mkdir <path>`"]);
    }
  });
});
