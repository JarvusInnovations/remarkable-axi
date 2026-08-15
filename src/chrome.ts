import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

/**
 * Binary names checked on `PATH`, in preference order.
 *
 * Stable channels first, then whatever generic name a distro packaged
 * Chromium under.
 */
const PATH_CANDIDATES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium-browser",
  "chromium",
  "chrome",
];

/** Well-known install locations outside `PATH`, keyed by `process.platform`. */
const KNOWN_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

export interface ChromeInfo {
  path: string;
  /** Raw `--version` output, e.g. `Google Chrome 127.0.6533.88`. */
  version: string;
}

let cached: ChromeInfo | null | undefined;

/**
 * Locate a Chrome/Chromium executable and confirm it runs, memoized for the
 * process lifetime — every caller in one invocation (`render`, `doctor`)
 * shares one discovery.
 *
 * `REMARKABLE_AXI_CHROME` pins a specific binary, for an unusual install
 * layout or CI. Otherwise `PATH` is checked first, then well-known
 * per-platform install locations, so a normal desktop install of Chrome or
 * Chromium is found with no configuration.
 */
export async function findChrome(): Promise<ChromeInfo | null> {
  if (cached !== undefined) return cached;
  cached = await discoverChrome();
  return cached;
}

/** Test-only: force the next `findChrome()` to rediscover. */
export function resetChromeCache(): void {
  cached = undefined;
}

async function discoverChrome(): Promise<ChromeInfo | null> {
  const override = process.env.REMARKABLE_AXI_CHROME?.trim();
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

/** Hard ceiling on one print invocation, independent of `REMARKABLE_TIMEOUT` (which governs cloud calls only). */
const RENDER_TIMEOUT_MS = 30_000;

/**
 * How long Chrome's virtual clock runs before the page is captured.
 *
 * Headless print-to-pdf takes a document exactly as it stands when the
 * budget expires — fonts, layout, and any script-driven changes must have
 * settled by then. Static documents (the common case here) settle almost
 * immediately; this just buys the rest room to finish.
 */
const SETTLE_BUDGET_MS = 5_000;

export interface PrintResult {
  bytes: number;
}

/**
 * Print one local HTML file to a PDF with headless Chrome, suppressing the
 * default header/footer and waiting for the document to settle first —
 * details `render` owns so the author never has to discover them.
 *
 * Chrome's command-line `--print-to-pdf` reports success (exit 0, no
 * stderr) even when it could not write the output file, so success is
 * judged by the output file actually existing afterward, not by the exit
 * code.
 */
export async function printToPdf(
  chromePath: string,
  htmlPath: string,
  outPath: string,
  opts: { timeoutMs?: number } = {},
): Promise<PrintResult> {
  const timeoutMs = opts.timeoutMs ?? RENDER_TIMEOUT_MS;
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--virtual-time-budget=${SETTLE_BUDGET_MS}`,
    `--print-to-pdf=${outPath}`,
    pathToFileURL(htmlPath).href,
  ];

  // Chrome refuses to start as root without this, which is the default user
  // in most containers agents run in.
  if (process.getuid?.() === 0) args.unshift("--no-sandbox");

  let stderr = "";
  try {
    const result = await execFileAsync(chromePath, args, { timeout: timeoutMs });
    stderr = result.stderr;
  } catch (error) {
    const err = error as { stderr?: string; killed?: boolean; signal?: string };
    stderr = err.stderr ?? "";
    if (err.killed || err.signal) {
      throw new Error(`chrome did not finish within ${timeoutMs / 1000}s`);
    }
    throw new Error(extractCause(stderr) ?? "chrome exited unexpectedly");
  }

  const size = await outputSize(outPath);
  if (size === null || size === 0) {
    throw new Error(
      extractCause(stderr) ?? "chrome exited without producing a PDF",
    );
  }

  return { bytes: size };
}

async function outputSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.size;
  } catch {
    return null;
  }
}

/**
 * Pull the actionable line out of Chrome's stderr rather than surfacing the
 * raw stream — most of it is unrelated fontconfig/GPU noise even on a
 * successful run.
 */
function extractCause(stderr: string): string | null {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const withError = lines.find((l) => /error/i.test(l));
  if (withError) {
    // Strip a `[pid:tid:...:severity]` logging prefix when present.
    const match = /ERROR:.*$/i.exec(withError);
    return (match ? match[0] : withError).slice(0, 500);
  }

  return lines.length > 0 ? lines[lines.length - 1]!.slice(0, 500) : null;
}
