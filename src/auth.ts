import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { AxiError } from "axi-sdk-js";
import { remarkable, type RemarkableApi } from "rmapi-js";

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
    return await remarkable(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AxiError(
      `authentication failed: ${message}`,
      "AUTH_FAILED",
      [
        "The device token may have been revoked or expired",
        "Run `remarkable-axi login <code>` with a fresh code from https://my.remarkable.com/device/desktop/connect",
      ],
    );
  }
}
