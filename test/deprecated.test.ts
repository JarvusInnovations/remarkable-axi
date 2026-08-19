import { describe, expect, test } from "vitest";
import { AxiError } from "axi-sdk-js";
import { send } from "../src/commands/send.js";
import { replace } from "../src/commands/replace.js";
import { fetch as fetchCmd } from "../src/commands/fetch.js";
// Imported at module scope, not per test: `put` pulls in the article/EPUB
// stack, and paying that load inside a test made it race the per-test
// timeout on a loaded machine. `rejectKeepOld` runs before any dependency
// call, so importing it costs nothing at run time.
import { put } from "../src/commands/put.js";

/**
 * Retired verbs never reach a dependency call — they throw synchronously with
 * a targeted redirect, so these are plain unit tests with no network or
 * pairing required.
 */
describe("send (retired)", () => {
  test("names the put invocation, folding --dir into the destination", async () => {
    await expect(
      send(["https://example.com/post", "--dir", "/Articles"]),
    ).rejects.toMatchObject({
      code: "USAGE",
      suggestions: ['remarkable-axi put "https://example.com/post" /Articles'],
    });
  });

  test("defaults the destination to / when --dir is absent", async () => {
    await expect(send(["https://example.com/post"])).rejects.toMatchObject({
      suggestions: ['remarkable-axi put "https://example.com/post" /'],
    });
  });

  test("folds --title into --name", async () => {
    await expect(
      send(["https://example.com/post", "--title", "Weekend Reading"]),
    ).rejects.toMatchObject({
      suggestions: [
        'remarkable-axi put "https://example.com/post" / --name "Weekend Reading"',
      ],
    });
  });

  test("is an AxiError with a self-correcting message", async () => {
    try {
      await send(["https://example.com/post"]);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).message).toContain("folded into `put`");
    }
  });
});

describe("replace (retired)", () => {
  test("names the put --replace invocation", async () => {
    await expect(
      replace(["/Papers/Draft", "./draft-v2.pdf"]),
    ).rejects.toMatchObject({
      code: "USAGE",
      suggestions: ["remarkable-axi put ./draft-v2.pdf /Papers/Draft --replace"],
    });
  });

  test("carries --name through", async () => {
    await expect(
      replace(["/Papers/Draft", "./draft-v2.pdf", "--name", "Draft v2"]),
    ).rejects.toMatchObject({
      suggestions: [
        'remarkable-axi put ./draft-v2.pdf /Papers/Draft --replace --name "Draft v2"',
      ],
    });
  });
});

describe("fetch (retired)", () => {
  test("names the get invocation", async () => {
    await expect(fetchCmd(["/Quick sheets"])).rejects.toMatchObject({
      code: "USAGE",
    });
  });

  test("folds --out into a positional destination", async () => {
    await expect(
      fetchCmd(["/Papers/Draft", "--out", "draft.pdf"]),
    ).rejects.toMatchObject({
      suggestions: ['remarkable-axi get "/Papers/Draft" draft.pdf'],
    });
  });

  test("passes through render flags unchanged", async () => {
    await expect(
      fetchCmd(["/Papers/Draft", "--as", "svg", "--pages", "2"]),
    ).rejects.toMatchObject({
      suggestions: [
        'remarkable-axi get "/Papers/Draft" --as svg --pages 2',
      ],
    });
  });

  test("names get, pairing with put", async () => {
    try {
      await fetchCmd(["/Papers/Draft"]);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as AxiError).message).toContain("renamed to `get`");
    }
  });
});

describe("--keep-old (retired)", () => {
  test("put refuses --keep-old before touching the network", async () => {
    try {
      await put(["draft.pdf", "/Papers/Draft", "--replace", "--keep-old"]);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      const axi = error as AxiError;
      expect(axi.message).toBe(
        "--keep-old is retired; it left two documents at one path",
      );
      expect(axi.suggestions).toEqual([
        "to save the annotated version first, use `remarkable-axi get <path> --overlay <file>.pdf`",
        "to keep the old version as a separate document, give it a distinct --name",
      ]);
    }
  });

  test("also rejects the --keep-old=value spelling", async () => {
    await expect(
      put(["draft.pdf", "/Papers/Draft", "--keep-old=true"]),
    ).rejects.toMatchObject({
      message: "--keep-old is retired; it left two documents at one path",
    });
  });
});
