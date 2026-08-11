import { describe, expect, test, vi } from "vitest";
import { AxiError } from "axi-sdk-js";
import { DEFAULT_TIMEOUT_MS, timeoutMs, withTimeout } from "../src/timeout.js";

function withEnv(value: string | undefined, fn: () => void) {
  const prev = process.env.REMARKABLE_TIMEOUT;
  if (value === undefined) delete process.env.REMARKABLE_TIMEOUT;
  else process.env.REMARKABLE_TIMEOUT = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.REMARKABLE_TIMEOUT;
    else process.env.REMARKABLE_TIMEOUT = prev;
  }
}

describe("timeoutMs", () => {
  test("defaults when unset", () => {
    withEnv(undefined, () => expect(timeoutMs()).toBe(DEFAULT_TIMEOUT_MS));
  });

  test("reads seconds, since that is the unit people think in", () => {
    withEnv("30", () => expect(timeoutMs()).toBe(30_000));
  });

  test("treats 0 as wait indefinitely", () => {
    withEnv("0", () => expect(timeoutMs()).toBe(0));
  });

  test("falls back rather than failing on nonsense", () => {
    withEnv("abc", () => expect(timeoutMs()).toBe(DEFAULT_TIMEOUT_MS));
    withEnv("-5", () => expect(timeoutMs()).toBe(DEFAULT_TIMEOUT_MS));
  });
});

describe("withTimeout", () => {
  test("passes through a call that resolves in time", async () => {
    const api = { listItems: async () => ["a", "b"] };
    await expect(withTimeout(api, 1000).listItems()).resolves.toEqual(["a", "b"]);
  });

  test("turns a stall into a structured error naming the operation", async () => {
    // The failure this exists for: without it a hung call produces no output,
    // no error, and no exit.
    vi.useFakeTimers();
    const api = { putPdf: () => new Promise(() => {}) };
    const pending = withTimeout(api, 5_000).putPdf();
    const assertion = expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
      message: expect.stringContaining("putPdf"),
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    vi.useRealTimers();
  });

  test("states a sub-second deadline in ms rather than rounding it to 0s", async () => {
    vi.useFakeTimers();
    const api = { listIds: () => new Promise(() => {}) };
    const pending = withTimeout(api, 50).listIds().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(50);
    expect(((await pending) as Error).message).toContain("50ms");
    vi.useRealTimers();
  });

  test("the stall error carries actionable next steps", async () => {
    vi.useFakeTimers();
    const api = { getRmPages: () => new Promise(() => {}) };
    const pending = withTimeout(api, 1_000).getRmPages().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    const err = (await pending) as AxiError;
    expect(err).toBeInstanceOf(AxiError);
    expect(err.suggestions.join(" ")).toContain("REMARKABLE_TIMEOUT");
    vi.useRealTimers();
  });

  test("propagates real errors unchanged", async () => {
    const api = { getPdf: async () => { throw new Error("no pdf for hash"); } };
    await expect(withTimeout(api, 1000).getPdf()).rejects.toThrow("no pdf for hash");
  });

  test("leaves synchronous members alone", () => {
    const api = { name: "rm", clearCache: () => 42 };
    const wrapped = withTimeout(api, 1000);
    expect(wrapped.name).toBe("rm");
    expect(wrapped.clearCache()).toBe(42);
  });

  test("also guards the low-level raw api, which is used directly", async () => {
    vi.useFakeTimers();
    const api = { raw: { getText: () => new Promise(() => {}) } };
    const pending = withTimeout(api, 1_000).raw.getText().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await pending) as AxiError).toBeInstanceOf(AxiError);
    vi.useRealTimers();
  });

  test("is a no-op when disabled", async () => {
    const api = { listItems: async () => "ok" };
    expect(withTimeout(api, 0)).toBe(api);
  });
});
