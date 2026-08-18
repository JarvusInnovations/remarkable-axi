import { describe, expect, test } from "vitest";
import { readSshConfig } from "../src/config.js";

// `readSshConfig` is the pure validation core `readConfig` runs the on-disk
// `ssh` block through — exercised directly here so the JSON-shape edge
// cases are covered with no file I/O, and so this suite never touches this
// machine's real ~/.config/remarkable-axi/config.json (see the comment in
// test/commands/setup.test.ts on why that file can't be safely swapped out
// from under a test).

describe("readSshConfig", () => {
  test("a destination with no via", () => {
    expect(readSshConfig({ destination: "root@192.168.1.37" })).toEqual({
      destination: "root@192.168.1.37",
    });
  });

  test("a destination with a via", () => {
    expect(
      readSshConfig({ destination: "root@192.168.1.37", via: "mbp-2024" }),
    ).toEqual({ destination: "root@192.168.1.37", via: "mbp-2024" });
  });

  test("trims whitespace on both fields", () => {
    expect(
      readSshConfig({ destination: "  root@192.168.1.37  ", via: " mbp " }),
    ).toEqual({ destination: "root@192.168.1.37", via: "mbp" });
  });

  test("a missing, empty, or non-string destination is rejected wholesale", () => {
    expect(readSshConfig({})).toBeUndefined();
    expect(readSshConfig({ destination: "" })).toBeUndefined();
    expect(readSshConfig({ destination: "   " })).toBeUndefined();
    expect(readSshConfig({ destination: 42 })).toBeUndefined();
  });

  test("a non-string via is dropped, not rejected — the destination survives alone", () => {
    expect(
      readSshConfig({ destination: "root@192.168.1.37", via: 42 }),
    ).toEqual({ destination: "root@192.168.1.37" });
  });

  test("a blank via is omitted, not stored as an empty string", () => {
    expect(
      readSshConfig({ destination: "root@192.168.1.37", via: "   " }),
    ).toEqual({ destination: "root@192.168.1.37" });
  });

  test("non-object input (null, array, scalar) is rejected", () => {
    expect(readSshConfig(null)).toBeUndefined();
    expect(readSshConfig(undefined)).toBeUndefined();
    expect(readSshConfig("root@192.168.1.37")).toBeUndefined();
    expect(readSshConfig(["root@192.168.1.37"])).toBeUndefined();
  });
});
