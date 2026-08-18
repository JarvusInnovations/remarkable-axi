import { describe, expect, test } from "vitest";
import { encodeToon } from "../src/output.js";

describe("encodeToon", () => {
  test("leaves scalars and non-string-array values exactly as the TOON encoder would", () => {
    expect(encodeToon({ a: 1, b: "x", c: true })).toBe("a: 1\nb: x\nc: true");
  });

  test("a string-array field becomes block form: one line per entry under a header, not a comma-joined inline array", () => {
    const out = encodeToon({
      help: [
        "Run `remarkable-axi ls --all` for all 128 documents",
        "Run `remarkable-axi put <file> <dest>` to add a document",
      ],
    });
    expect(out).toBe(
      [
        "help[2]:",
        "  Run `remarkable-axi ls --all` for all 128 documents",
        "  Run `remarkable-axi put <file> <dest>` to add a document",
      ].join("\n"),
    );
  });

  test("entries keep commas and quotes unescaped, since block form never needs delimiter quoting", () => {
    // The inline encoder would have to quote this whole entry (it contains
    // the delimiter and a literal quote) — block form just prints the line.
    const out = encodeToon({
      flags: ['--as <fmt>  original, pdf (default), or "text"'],
    });
    expect(out).toBe(
      ['flags[1]:', '  --as <fmt>  original, pdf (default), or "text"'].join(
        "\n",
      ),
    );
  });

  test("an empty string array is untouched — still the encoder's `key: []`", () => {
    expect(encodeToon({ help: [] })).toBe("help: []");
  });

  test("multiple string-array fields on the same object each get their own block, in field order", () => {
    const out = encodeToon({
      usage: "remarkable-axi put <src> <dest>",
      flags: ["--replace   swap the contents"],
      examples: ["remarkable-axi put a.pdf /Papers", "remarkable-axi put b.pdf /Papers"],
    });
    expect(out).toBe(
      [
        "usage: remarkable-axi put <src> <dest>",
        "flags[1]:",
        "  --replace   swap the contents",
        "examples[2]:",
        "  remarkable-axi put a.pdf /Papers",
        "  remarkable-axi put b.pdf /Papers",
      ].join("\n"),
    );
  });

  test("a string-array field nested one level inside a plain object still gets block form", () => {
    // e.g. the home view's target block wrapping a help array alongside it.
    const out = encodeToon({
      target: { model: "RM110" },
      help: ["Run `remarkable-axi doctor` to diagnose"],
    });
    expect(out).toBe(
      [
        "target:",
        "  model: RM110",
        "help[1]:",
        "  Run `remarkable-axi doctor` to diagnose",
      ].join("\n"),
    );
  });

  test("arrays of objects with uniform keys still render as an ordinary TOON table", () => {
    const out = encodeToon({
      recent: [
        { type: "pdf", path: "/Papers/Draft" },
        { type: "epub", path: "/Articles/One" },
      ],
    });
    expect(out).toBe(
      [
        "recent[2]{type,path}:",
        "  pdf,/Papers/Draft",
        "  epub,/Articles/One",
      ].join("\n"),
    );
  });
});
