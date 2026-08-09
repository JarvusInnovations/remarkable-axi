/**
 * Parse a reMarkable timestamp to epoch milliseconds.
 *
 * The cloud writes `lastModified` as epoch milliseconds in a *string*
 * (`"1738362000000"`), which `new Date(...)` rejects — it only parses numeric
 * strings as dates when they look like years. Some items carry an ISO string
 * instead, and third-party tools sometimes omit the field entirely, so all
 * three cases are handled here rather than at each call site.
 */
export function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (/^\d+$/.test(trimmed)) {
    const epochMs = Number(trimmed);
    return Number.isFinite(epochMs) ? epochMs : null;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Compact relative age, e.g. `3d ago`. Unparseable values read `unknown`. */
export function age(value: string | undefined, now = Date.now()): string {
  const then = parseTimestamp(value);
  if (then === null) return "unknown";

  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d ago`;

  return `${Math.floor(days / 365)}y ago`;
}

/** Sort key for recency. Undated items sort last rather than randomly. */
export function recencyKey(value: string | undefined): number {
  return parseTimestamp(value) ?? Number.NEGATIVE_INFINITY;
}
