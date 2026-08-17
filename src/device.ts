import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants } from "node:fs/promises";
import { AxiError } from "axi-sdk-js";
import type { SshConfig } from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * The device exec layer: resolves which tablet to talk to, shells out to the
 * system `ssh` binary to run one command on it, and translates connectivity
 * and auth failures into the structured errors specs/commands/device.md
 * defines. Every `device` command runs through `execRemote`, so a firmware
 * quirk or a connectivity fix lands in exactly one place.
 *
 * **BusyBox ash only.** The tablet's remote shell is BusyBox, not bash or a
 * GNU userland — no `[[`, no arrays, no here-strings, no GNU-only flags
 * (`head -n N` not `head -N`). Every remote command string this module (or
 * any later `device` command) sends must be written and tested against that
 * constraint; see
 * specs/behaviors/device-access.md#the-devices-shell-is-busybox. A command
 * that works on the dev machine and fails on the device is a bug here, not
 * on the device.
 */

// ---------------------------------------------------------------------------
// ssh binary discovery — same pattern as findChrome (src/chrome.ts) and
// findGhostscript (src/gs.ts): PATH first, then well-known install
// locations, memoized for the process lifetime, reported by `doctor`.
// ---------------------------------------------------------------------------

export interface SshInfo {
  path: string;
  /** Raw `ssh -V` output, e.g. `OpenSSH_9.6p1, LibreSSL 3.3.6`. */
  version: string;
}

const PATH_CANDIDATES = ["ssh"];

/** Well-known install locations outside `PATH`, keyed by `process.platform`. */
const KNOWN_PATHS: Record<string, string[]> = {
  darwin: ["/usr/bin/ssh", "/opt/homebrew/bin/ssh", "/usr/local/bin/ssh"],
  linux: ["/usr/bin/ssh", "/usr/local/bin/ssh"],
  win32: [],
};

let cachedSsh: SshInfo | null | undefined;

/**
 * Locate the system `ssh` client and confirm it runs, memoized for the
 * process lifetime.
 *
 * `REMARKABLE_AXI_SSH` pins a specific binary, for an unusual install layout
 * or CI. Otherwise `PATH` is checked first, then well-known per-platform
 * install locations. The tool never bundles an SSH client — everything
 * `~/.ssh/config` can express works without this tool knowing about it.
 */
export async function findSsh(): Promise<SshInfo | null> {
  if (cachedSsh !== undefined) return cachedSsh;
  cachedSsh = await discoverSsh();
  return cachedSsh;
}

/** Test-only: force the next `findSsh()` to rediscover. */
export function resetSshCache(): void {
  cachedSsh = undefined;
}

async function discoverSsh(): Promise<SshInfo | null> {
  const override = process.env.REMARKABLE_AXI_SSH?.trim();
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

/**
 * `ssh -V` writes its version to stderr, not stdout (unlike Chrome and
 * Ghostscript's `--version`), and some builds exit non-zero doing it — so
 * both the success and error paths read stderr rather than stdout.
 */
async function tryVersion(path: string): Promise<string | null> {
  try {
    const { stderr } = await execFileAsync(path, ["-V"]);
    return stderr.trim() || null;
  } catch (error) {
    const err = error as { stderr?: string };
    return err.stderr?.trim() || null;
  }
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

/** A resolved SSH destination for one invocation. */
export interface SshTarget {
  destination: string;
  via?: string;
}

/**
 * Resolve the destination (and optional ProxyJump hop) for one `device`
 * invocation: `--ssh`/`--via` each override their own field independently,
 * falling back to the persisted `setup ssh` config. Failing structured with
 * no destination at all is the one place every `device` command shares that
 * failure, so `NO_DEVICE_SSH` always names `setup ssh` the same way.
 */
export function resolveSshTarget(
  flags: { ssh?: string; via?: string },
  config: SshConfig | undefined,
): SshTarget {
  const destination = flags.ssh || config?.destination;
  if (!destination) {
    throw new AxiError("no device configured", "NO_DEVICE_SSH", [
      "Run `remarkable-axi setup ssh <destination>` to persist a default",
      "Or pass `--ssh <destination>` for this invocation only",
    ]);
  }

  const via = flags.via || config?.via;
  return via ? { destination, via } : { destination };
}

// ---------------------------------------------------------------------------
// Remote execution
// ---------------------------------------------------------------------------

/** One connect-timeout budget, in seconds, passed to `ssh -o ConnectTimeout=`. */
const CONNECT_TIMEOUT_S = 8;

/** Hard ceiling on one remote command, independent of the connect timeout. */
const EXEC_TIMEOUT_MS = 15_000;

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * The exec boundary this module's callers can replace in tests, so no test
 * ever opens a real connection to a real tablet — matching how `findChrome`/
 * `findGhostscript` are exercised against a real (optional) binary, but
 * `execRemote`'s network step never is.
 */
export type SshRunner = (
  binPath: string,
  args: string[],
  opts: { timeoutMs: number },
) => Promise<RunResult>;

/**
 * Build the `ssh` invocation for one remote command: `BatchMode=yes` so a
 * password prompt is refused rather than hung on (AXI forbids interactive
 * prompts, and the tool never handles the device password), a connect
 * timeout so a dead address fails fast, and `-J <via>` only when a jump host
 * is configured — direct and relayed access are the same invocation
 * differing by one flag.
 */
export function buildSshArgs(target: SshTarget, command: string): string[] {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${CONNECT_TIMEOUT_S}`,
  ];
  if (target.via) args.push("-J", target.via);
  args.push(target.destination, command);
  return args;
}

/** The real runner: shells out to the discovered `ssh` binary. */
const runSsh: SshRunner = async (binPath, args, opts) => {
  try {
    const { stdout, stderr } = await execFileAsync(binPath, args, {
      timeout: opts.timeoutMs,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
      killed?: boolean;
      signal?: string;
    };
    if (err.killed || err.signal) {
      throw new Error(`ssh did not finish within ${opts.timeoutMs / 1000}s`);
    }
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      code: typeof err.code === "number" ? err.code : 1,
    };
  }
};

/** Resolve the discovered `ssh` binary or fail `MISSING_TOOL`, shared by
 * every exec entry point below. */
async function requireSsh(): Promise<SshInfo> {
  const info = await findSsh();
  if (!info) {
    throw new AxiError("ssh not found", "MISSING_TOOL", [
      "Install the OpenSSH client — most systems ship `ssh`; Debian/Ubuntu: `apt install openssh-client`",
      "Run `remarkable-axi doctor` to confirm it is discovered",
    ]);
  }
  return info;
}

/**
 * Run one command on the tablet over SSH and return its stdout.
 *
 * `command` must be BusyBox ash-safe — see the module doc comment above.
 * Failure is always one of the three device-access error codes: `ssh` not
 * found (`MISSING_TOOL`), or the connection/auth failing (`DEVICE_UNREACHABLE`,
 * with key-install steps when the failure looks like an auth rejection).
 * `NO_DEVICE_SSH` is `resolveSshTarget`'s concern, not this function's — by
 * the time a `target` reaches here, one was already found.
 *
 * `opts.timeoutMs` overrides the default 15s ceiling — plenty for the
 * metadata/content greps `backup` and `orphans` do to plan their work, but a
 * full-account metadata dump on a large library can run past it, so callers
 * doing that pass a longer budget explicitly rather than this default
 * silently growing for everyone.
 */
export async function execRemote(
  target: SshTarget,
  command: string,
  opts: { runner?: SshRunner; timeoutMs?: number } = {},
): Promise<string> {
  const info = await requireSsh();
  const args = buildSshArgs(target, command);
  const runner = opts.runner ?? runSsh;
  const timeoutMs = opts.timeoutMs ?? EXEC_TIMEOUT_MS;

  let result: RunResult;
  try {
    result = await runner(info.path, args, { timeoutMs });
  } catch (error) {
    throw unreachable(
      target,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (result.code !== 0) {
    throw unreachable(target, result.stderr || result.stdout);
  }

  return result.stdout;
}

// ---------------------------------------------------------------------------
// Binary-safe remote execution — `device backup`'s tar stream and any single
// `.rm`/thumbnail fetch `device orphans` needs to parse or render.
// ---------------------------------------------------------------------------

/** Hard ceiling on a binary transfer: generous, because a tar of a large
 * document over a relayed (`-J`) connection can be slow — see this plan's
 * "Streaming large docs over a relayed connection" risk note. Individual
 * `.rm`/thumbnail fetches finish in a fraction of this; the ceiling is sized
 * for the tar case, and every caller can still override it. */
const BINARY_TIMEOUT_MS = 300_000;

/** A tarred document is not expected to approach this, but a ceiling here
 * turns a runaway transfer into a clear failure instead of unbounded memory
 * growth. */
const MAX_BINARY_BYTES = 512 * 1024 * 1024;

export interface BinaryRunResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

/** The binary-capture counterpart to `SshRunner` — same replaceable-in-tests
 * shape, but stdout is a `Buffer` so a tar stream (or a `.rm`/PNG file)
 * survives the round trip intact instead of being decoded as UTF-8 text. */
export type SshBinaryRunner = (
  binPath: string,
  args: string[],
  opts: { timeoutMs: number },
) => Promise<BinaryRunResult>;

/** The real binary runner: identical to `runSsh` except for the encoding —
 * BatchMode/ConnectTimeout come from `buildSshArgs`, shared with the string
 * path above. */
const runSshBinary: SshBinaryRunner = async (binPath, args, opts) => {
  try {
    const { stdout, stderr } = await execFileAsync(binPath, args, {
      timeout: opts.timeoutMs,
      encoding: "buffer",
      maxBuffer: MAX_BINARY_BYTES,
    });
    return { stdout, stderr: stderr.toString("utf8"), code: 0 };
  } catch (error) {
    const err = error as {
      stdout?: Buffer;
      stderr?: Buffer;
      code?: number;
      killed?: boolean;
      signal?: string;
    };
    if (err.killed || err.signal) {
      throw new Error(`ssh did not finish within ${opts.timeoutMs / 1000}s`);
    }
    return {
      stdout: err.stdout ?? Buffer.alloc(0),
      stderr: err.stderr?.toString("utf8") ?? "",
      code: typeof err.code === "number" ? err.code : 1,
    };
  }
};

/**
 * Run one command on the tablet and return its stdout as raw bytes —
 * `execRemote`'s binary-safe counterpart, for `device backup`'s tar stream
 * and any `.rm`/thumbnail fetch `device orphans` needs. Error translation
 * (`MISSING_TOOL`/`DEVICE_UNREACHABLE`) is identical to `execRemote`, so a
 * connectivity fix never has to be made twice.
 */
export async function execRemoteBinary(
  target: SshTarget,
  command: string,
  opts: { runner?: SshBinaryRunner; timeoutMs?: number } = {},
): Promise<Buffer> {
  const info = await requireSsh();
  const args = buildSshArgs(target, command);
  const runner = opts.runner ?? runSshBinary;
  const timeoutMs = opts.timeoutMs ?? BINARY_TIMEOUT_MS;

  let result: BinaryRunResult;
  try {
    result = await runner(info.path, args, { timeoutMs });
  } catch (error) {
    throw unreachable(
      target,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (result.code !== 0) {
    throw unreachable(target, result.stderr || "(no stderr)");
  }

  return result.stdout;
}

/**
 * Translate a failed connection/command into `DEVICE_UNREACHABLE`. An auth
 * rejection gets the one-time manual fix — the tool never handles the
 * device password, so a wrong or missing key is not this tool's to retry —
 * per specs/behaviors/device-access.md's "Auth is key-based, full stop."
 */
function unreachable(target: SshTarget, detail: string): AxiError {
  const where = target.via
    ? `${target.destination} via ${target.via}`
    : target.destination;

  if (/permission denied|authentication failed/i.test(detail)) {
    return new AxiError(
      `authentication failed reaching ${where}`,
      "DEVICE_UNREACHABLE",
      [
        "Read the password from the tablet: Settings → Help → About",
        `Run \`ssh-copy-id ${target.destination}\` from a machine that can reach the tablet (or append the key to authorized_keys by hand)`,
        "The password rotates whenever `ssh over WLAN` is toggled off and back on, so having shared it once isn't a lasting exposure",
      ],
    );
  }

  return new AxiError(`could not reach ${where}`, "DEVICE_UNREACHABLE", [
    "Confirm the tablet is on and `ssh over WLAN` is enabled (Settings → Help → About)",
    "Run `remarkable-axi setup ssh <destination>` to repoint a stale address",
    "Or pass `--ssh <destination>` for this invocation only",
  ]);
}

// ---------------------------------------------------------------------------
// `device status` — one connection, four facts
// ---------------------------------------------------------------------------

/**
 * One BusyBox ash-safe remote command gathering everything `device status`
 * (and doctor's device block) needs, so the whole check is one connection:
 * xochitl's `systemctl` state, the OS/xochitl release version (sourced from
 * `update.conf` rather than parsed, so no assumption about `grep`/`cut`
 * flags), free/total storage from `df -k`, and a count of on-device
 * documents (`.metadata` files — see specs/behaviors/device-access.md's
 * storage layout table).
 *
 * Unverified against real hardware — see this plan's "BusyBox drift" risk.
 * A field that fails to parse degrades to "unknown" rather than failing the
 * whole command; reachability is the fact this exists to prove.
 */
export const STATUS_COMMAND =
  '. /usr/share/remarkable/update.conf 2>/dev/null; ' +
  'echo "XOCHITL=$(systemctl is-active xochitl 2>/dev/null || echo unknown)"; ' +
  'echo "VERSION=${REMARKABLE_RELEASE_VERSION:-unknown}"; ' +
  'echo "STORAGE=$(df -k /home 2>/dev/null | tail -n1)"; ' +
  'echo "DOCS=$(ls -1 /home/root/.local/share/remarkable/xochitl/*.metadata 2>/dev/null | wc -l)"';

export interface DeviceStatusFacts {
  xochitlState: string;
  xochitlRunning: boolean;
  version: string | null;
  storage: { totalBytes: number; freeBytes: number } | null;
  documents: number | null;
}

/** Parse `STATUS_COMMAND`'s `KEY=value` lines into typed facts. */
export function parseStatusOutput(stdout: string): DeviceStatusFacts {
  const fields: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    fields[line.slice(0, eq)] = line.slice(eq + 1);
  }

  const xochitlState = fields.XOCHITL?.trim() || "unknown";
  const versionRaw = fields.VERSION?.trim();
  const version = versionRaw && versionRaw !== "unknown" ? versionRaw : null;

  let storage: DeviceStatusFacts["storage"] = null;
  const storageLine = fields.STORAGE?.trim();
  if (storageLine) {
    // `df -k` columns: filesystem, 1K-blocks, used, available, use%, mount.
    const cols = storageLine.split(/\s+/);
    const totalKb = Number(cols[1]);
    const availKb = Number(cols[3]);
    if (Number.isFinite(totalKb) && Number.isFinite(availKb)) {
      storage = { totalBytes: totalKb * 1024, freeBytes: availKb * 1024 };
    }
  }

  const docsRaw = fields.DOCS?.trim();
  const documents = docsRaw && /^\d+$/.test(docsRaw) ? Number(docsRaw) : null;

  return {
    xochitlState,
    xochitlRunning: xochitlState === "active",
    version,
    storage,
    documents,
  };
}

/** `4.1GB` / `58GB` — binary GiB, labeled GB to match the spec's examples. */
function formatGB(bytes: number): string {
  const rounded = (bytes / 1024 ** 3).toFixed(1);
  return `${rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded}GB`;
}

/** `running, 3.22.0.65`, `running` (no version found), or the raw systemctl state. */
export function formatXochitl(facts: DeviceStatusFacts): string {
  if (facts.xochitlRunning) {
    return facts.version ? `running, ${facts.version}` : "running";
  }
  return facts.xochitlState;
}

/** `4.1GB free of 58GB`, or `unknown` when `df`'s output didn't parse. */
export function formatStorage(facts: DeviceStatusFacts): string {
  if (!facts.storage) return "unknown";
  return `${formatGB(facts.storage.freeBytes)} free of ${formatGB(facts.storage.totalBytes)}`;
}

/** `691 local`, or `unknown` when the count didn't parse. */
export function formatDocuments(facts: DeviceStatusFacts): string {
  return facts.documents !== null ? `${facts.documents} local` : "unknown";
}

// ---------------------------------------------------------------------------
// `device reattach` — the write ritual's fixed commands
// (specs/behaviors/device-access.md#reads-are-free-writes-follow-the-ritual).
// Every write goes: stop xochitl, apply (elsewhere — path/uuid-specific, so
// built per-invocation in device-fs.ts), sync, restart, verify. The four
// commands here are the constant, document-independent bookends; unverified
// against real hardware like `STATUS_COMMAND` above, but each is a single
// well-known BusyBox/systemd primitive rather than a composed script, so the
// surface for firmware drift is small.
// ---------------------------------------------------------------------------

export const STOP_XOCHITL_COMMAND = "systemctl stop xochitl";
export const START_XOCHITL_COMMAND = "systemctl start xochitl";
export const SYNC_COMMAND = "sync";

/** The post-restart verification probe: bare `systemctl is-active` output
 * (`active`, `inactive`, `failed`, …), trimmed and compared by the caller —
 * deliberately not reusing the fuller `STATUS_COMMAND` here, since the
 * ritual only needs the one fact and a smaller command is a smaller surface
 * for a slow relayed connection to fail on mid-verification. */
export const XOCHITL_ACTIVE_COMMAND = "systemctl is-active xochitl";
