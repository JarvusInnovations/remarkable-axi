import { describe, expect, test, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import {
  ensureWritable,
  originalExtension,
  resolveGetDestination,
} from "../src/commands/get.js";

describe("originalExtension", () => {
  test("passes through pdf and epub", () => {
    expect(originalExtension("pdf", "/Papers/Draft")).toBe("pdf");
    expect(originalExtension("epub", "/Books/Novel")).toBe("epub");
  });

  test("refuses a notebook with NO_ORIGINAL, naming the render formats", () => {
    try {
      originalExtension("notebook", "/Quick sheets");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      const axi = error as AxiError;
      expect(axi.code).toBe("NO_ORIGINAL");
      expect(axi.message).toContain("notebook");
      expect(axi.suggestions.join(" ")).toContain("--as pdf");
      expect(axi.suggestions.join(" ")).toContain("--as svg");
      expect(axi.suggestions.join(" ")).toContain("--as text");
    }
  });
});

describe("resolveGetDestination", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("defaults to ./<name>.<ext> in the working directory", async () => {
    const out = await resolveGetDestination("Draft", "pdf", undefined);
    expect(out).toBe(resolve("./Draft.pdf"));
  });

  test("lands inside an existing local directory", async () => {
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-"));
    const out = await resolveGetDestination("Draft", "pdf", dir);
    expect(out).toBe(join(dir, "Draft.pdf"));
  });

  test("treats a non-existent dest as the exact file path", async () => {
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-"));
    const target = join(dir, "renamed.pdf");
    const out = await resolveGetDestination("Draft", "pdf", target);
    expect(out).toBe(target);
  });
});

describe("ensureWritable", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("is silent when nothing exists at the destination", async () => {
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-"));
    await expect(
      ensureWritable(join(dir, "new.pdf"), false, "remarkable-axi get x"),
    ).resolves.toBeUndefined();
  });

  test("refuses to clobber an existing file without --force", async () => {
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-"));
    const target = join(dir, "existing.pdf");
    await writeFile(target, "already here");

    try {
      await ensureWritable(target, false, "remarkable-axi get /Draft");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      const axi = error as AxiError;
      expect(axi.code).toBe("EXISTS");
      expect(axi.suggestions.join(" ")).toContain("--force");
    }
  });

  test("--force allows overwriting", async () => {
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-"));
    const target = join(dir, "existing.pdf");
    await writeFile(target, "already here");
    await expect(
      ensureWritable(target, true, "remarkable-axi get /Draft"),
    ).resolves.toBeUndefined();
  });

  test("a directory does not trip the check for its own sake", async () => {
    // `resolveGetDestination` never returns a bare directory path, but this
    // documents that ensureWritable itself only cares whether *something*
    // exists, not what kind.
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-"));
    const sub = join(dir, "sub");
    await mkdir(sub);
    await expect(
      ensureWritable(sub, false, "remarkable-axi get /Draft"),
    ).rejects.toThrow("already exists");
  });
});
