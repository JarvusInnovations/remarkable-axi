import { describe, expect, test } from "vitest";
import { classifyClientError } from "../src/auth.js";

describe("classifyClientError", () => {
  test("a rate limit is not an auth failure and does not suggest re-pairing", () => {
    // Observed live: hammering the cloud produced this exact message, and it
    // used to arrive as AUTH_FAILED telling the caller to re-pair — which
    // burns a pairing code against a condition that clears by itself.
    const axi = classifyClientError(
      new Error("couldn't fetch auth token: Too Many Requests"),
    );

    expect(axi.code).toBe("RATE_LIMITED");
    expect(axi.message).toContain("rate limit");
    expect(axi.suggestions.join(" ")).toContain("pairing is fine");
    expect(axi.suggestions.join(" ")).not.toContain("login");
  });

  test("a 429 status is recognised as a rate limit", () => {
    expect(classifyClientError(new Error("request failed with 429")).code).toBe(
      "RATE_LIMITED",
    );
  });

  test("a server error or dropped connection reads as unreachable, not unpaired", () => {
    for (const message of [
      "request failed with 503",
      "read ECONNRESET",
      "connect ETIMEDOUT 1.2.3.4:443",
      "getaddrinfo ENOTFOUND eu.tectonic.remarkable.com",
    ]) {
      const axi = classifyClientError(new Error(message));
      expect(axi.code).toBe("CLOUD_UNREACHABLE");
      expect(axi.suggestions.join(" ")).toContain("pairing is fine");
    }
  });

  test("a genuine auth rejection still says so and offers the re-pair", () => {
    const axi = classifyClientError(new Error("401 Unauthorized: token rejected"));

    expect(axi.code).toBe("AUTH_FAILED");
    expect(axi.suggestions.join(" ")).toContain("login");
  });

  test("a non-Error rejection is still classified rather than leaking through", () => {
    expect(classifyClientError("Too Many Requests").code).toBe("RATE_LIMITED");
  });
});
