import { AxiError } from "axi-sdk-js";

/** Default deadline for a single cloud call, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Resolve the per-operation deadline.
 *
 * `REMARKABLE_TIMEOUT` is in seconds because that is the unit anyone reaching
 * for it will think in. `0` disables the deadline for the rare case where a
 * genuinely huge upload needs unlimited time.
 */
export function timeoutMs(): number {
  const raw = process.env.REMARKABLE_TIMEOUT?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_TIMEOUT_MS;
  return seconds === 0 ? 0 : seconds * 1000;
}

/** Read naturally at both 120s and a sub-second test deadline. */
function formatDuration(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
}

function deadline(label: string, ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AxiError(
          `\`${label}\` did not respond within ${formatDuration(ms)}`,
          "TIMEOUT",
          [
            "The reMarkable cloud accepted the connection but stopped responding",
            "Retry — this has been observed to clear on a second attempt",
            "Set REMARKABLE_TIMEOUT=<seconds> to allow longer, or 0 to wait indefinitely",
          ],
        ),
      );
    }, ms);
    // Never hold the process open on behalf of the loser of the race.
    timer.unref?.();
  });
}

/**
 * Wrap an object so every async method it exposes fails loudly on a stall.
 *
 * Without this a hung cloud call produces no output, no error, and no exit —
 * the process simply sits there. That has happened twice in practice, once for
 * five minutes before dying, which reads as "uploads are slow" rather than
 * "this request is never coming back". A deadline converts silence into a
 * structured error an agent can act on.
 *
 * The timeout races the call rather than cancelling it: the underlying request
 * may still complete, which is why the message suggests a retry rather than
 * implying the operation definitely failed.
 */
export function withTimeout<T extends object>(target: T, ms: number): T {
  if (ms <= 0) return target;

  const cache = new Map<string | symbol, unknown>();

  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (cache.has(prop)) return cache.get(prop);

      const value = Reflect.get(obj, prop, receiver);

      // The low-level API is reached directly in places, so it needs the same
      // protection rather than only the methods layered on top of it.
      if (prop === "raw" && value && typeof value === "object") {
        const wrapped = withTimeout(value as object, ms);
        cache.set(prop, wrapped);
        return wrapped;
      }

      if (typeof value !== "function") return value;

      const label = String(prop);
      const wrapped = (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(obj, args);
        // Only a promise can stall; leave synchronous helpers untouched.
        return result instanceof Promise
          ? Promise.race([result, deadline(label, ms)])
          : result;
      };

      cache.set(prop, wrapped);
      return wrapped;
    },
  }) as T;
}
