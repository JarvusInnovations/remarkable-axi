import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { AxiError } from "axi-sdk-js";
import { remarkable, type RemarkableApi } from "rmapi-js";
import { timeoutMs, withTimeout } from "./timeout.js";

const CONFIG_DIR = join(homedir(), ".config", "remarkable-axi");
const TOKEN_FILE = join(CONFIG_DIR, "token");

/** Absolute path of the token file, for diagnostics. */
export const tokenPath = TOKEN_FILE;

/**
 * Read the persisted device token.
 *
 * `REMARKABLE_TOKEN` wins when set, so a CI or container run can supply the
 * token without writing it to disk.
 */
export async function readToken(): Promise<string | null> {
  const fromEnv = process.env.REMARKABLE_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  try {
    const raw = await readFile(TOKEN_FILE, "utf8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/** Persist a device token with owner-only permissions. */
export async function writeToken(token: string): Promise<string> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
  await chmod(TOKEN_FILE, 0o600);
  return TOKEN_FILE;
}

/**
 * Build an authenticated client, or fail with the pairing instructions.
 *
 * Every command that touches the cloud goes through here so the
 * not-yet-paired case produces one consistent, actionable error.
 */
export async function client(): Promise<RemarkableApi> {
  const token = await readToken();
  if (!token) {
    throw new AxiError(
      "not paired with a reMarkable account",
      "NOT_AUTHENTICATED",
      [
        "Get an 8-character code from https://my.remarkable.com/device/desktop/connect",
        "Run `remarkable-axi login <code>` to pair this machine",
      ],
    );
  }

  try {
    // Every cloud call gets a deadline: a stalled request otherwise produces no
    // output, no error, and no exit.
    return withTimeout(await remarkable(token), timeoutMs());
  } catch (error) {
    throw classifyClientError(error);
  }
}

/**
 * Translate a failure to open a client into the cause the caller can act on.
 *
 * Not every failure to exchange the device token is an *auth* failure. The
 * cloud rate-limits token exchange, and a 429 used to surface here as
 * "authentication failed" suggesting a re-pair — advice that burns a pairing
 * code and fixes nothing, because the condition clears on its own. Flattening
 * distinct causes into the scariest one is precisely what AXI 6 forbids:
 * translate the actionable meaning, discard the noise.
 *
 * Exported for testing; the classification is pure so it needs no network.
 */
export function classifyClientError(error: unknown): AxiError {
  const message = error instanceof Error ? error.message : String(error);

  if (/\b429\b|too many requests|rate.?limit/i.test(message)) {
    return new AxiError(
      `reMarkable cloud rate limit reached: ${message}`,
      "RATE_LIMITED",
      [
        "The pairing is fine — the cloud is throttling token exchange",
        "Wait a minute or two and run the same command again",
      ],
    );
  }

  if (
    /\b5\d\d\b|econnreset|etimedout|enotfound|eai_again|socket hang up|network|timed out/i.test(
      message,
    )
  ) {
    return new AxiError(
      `reMarkable cloud unreachable: ${message}`,
      "CLOUD_UNREACHABLE",
      [
        "The pairing is fine — the cloud did not answer",
        "Check connectivity and retry; `remarkable-axi doctor` reports reachability",
      ],
    );
  }

  return new AxiError(`authentication failed: ${message}`, "AUTH_FAILED", [
    "The device token may have been revoked or expired",
    "Run `remarkable-axi login <code>` with a fresh code from https://my.remarkable.com/device/desktop/connect",
  ]);
}
