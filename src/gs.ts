import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants } from "node:fs/promises";

const execFileAsync = promisify(execFile);

/** Binary names checked on `PATH`, in preference order. */
const PATH_CANDIDATES = ["gs", "gswin64c", "gswin32c"];

/** Well-known install locations outside `PATH`, keyed by `process.platform`. */
const KNOWN_PATHS: Record<string, string[]> = {
  darwin: ["/usr/local/bin/gs", "/opt/homebrew/bin/gs"],
  linux: ["/usr/bin/gs"],
  win32: [],
};

export interface GhostscriptInfo {
  path: string;
  /** Raw `--version` output, e.g. `10.02.1`. */
  version: string;
}

let cached: GhostscriptInfo | null | undefined;

/**
 * Locate a Ghostscript executable and confirm it runs, memoized for the
 * process lifetime — same pattern as `findChrome` (`src/chrome.ts`), so
 * every caller in one invocation (`check`, `doctor`) shares one discovery.
 *
 * `REMARKABLE_AXI_GS` pins a specific binary, for an unusual install layout
 * or CI. Otherwise `PATH` is checked first, then well-known per-platform
 * install locations.
 */
export async function findGhostscript(): Promise<GhostscriptInfo | null> {
  if (cached !== undefined) return cached;
  cached = await discoverGhostscript();
  return cached;
}

/** Test-only: force the next `findGhostscript()` to rediscover. */
export function resetGhostscriptCache(): void {
  cached = undefined;
}

async function discoverGhostscript(): Promise<GhostscriptInfo | null> {
  const override = process.env.REMARKABLE_AXI_GS?.trim();
  if (override) {
    const version = await tryVersion(override);
    return version ? { path: override, version } : null;
  }

  for (const name of PATH_CANDIDATES) {
    const resolved = await resolveOnPath(name);
    if (!resolved) continue;
    const version = await tryVersion(resolved);
    if (version) return { path: resolved, version };
  }

  for (const path of KNOWN_PATHS[process.platform] ?? []) {
    if (!(await isExecutable(path))) continue;
    const version = await tryVersion(path);
    if (version) return { path, version };
  }

  return null;
}

async function resolveOnPath(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      process.platform === "win32" ? "where" : "which",
      [name],
    );
    return stdout.split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function tryVersion(path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(path, ["--version"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
