import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolveModel, type DeviceModel } from "./devices.js";

const CONFIG_DIR = join(homedir(), ".config", "remarkable-axi");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/** Absolute path of the config file, for diagnostics. */
export const configPath = CONFIG_FILE;

/**
 * The persisted `setup ssh` destination — a device SSH endpoint plus an
 * optional ProxyJump hop, per specs/behaviors/device-access.md.
 */
export interface SshConfig {
  destination: string;
  via?: string;
}

export interface Config {
  /**
   * The device to design for.
   *
   * User-declared, not detected — the cloud API exposes no way to enumerate
   * an account's devices, so nothing here is verified against real hardware.
   */
  targetDevice?: DeviceModel;

  /** The SSH destination `device` commands use, set by `setup ssh`. */
  ssh?: SshConfig;
}

/**
 * Read the config, treating anything unreadable as empty.
 *
 * A malformed or missing config should never stop a command from running: it
 * only ever carries preferences, and failing hard on it would take the whole
 * CLI down over a stray character.
 *
 * Each field is validated and defaulted independently — an invalid or absent
 * `targetDevice` must not discard a perfectly good `ssh` block, and vice
 * versa.
 */
export async function readConfig(): Promise<Config> {
  try {
    const parsed: unknown = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    const raw = parsed as Record<string, unknown>;

    const config: Config = {};

    // Validate on read so an edited config can't inject an unknown model.
    if (typeof raw.targetDevice === "string") {
      const model = resolveModel(raw.targetDevice);
      if (model) config.targetDevice = model;
    }

    const ssh = readSshConfig(raw.ssh);
    if (ssh) config.ssh = ssh;

    return config;
  } catch {
    return {};
  }
}

/** Exported for direct unit testing — validates one `ssh` block with no file I/O. */
export function readSshConfig(raw: unknown): SshConfig | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;

  const destination =
    typeof obj.destination === "string" ? obj.destination.trim() : "";
  if (!destination) return undefined;

  const via = typeof obj.via === "string" ? obj.via.trim() : "";
  return via ? { destination, via } : { destination };
}

/** Merge changes into the config, creating it if needed. */
export async function writeConfig(changes: Config): Promise<string> {
  const current = await readConfig();
  const next: Config = { ...current, ...changes };

  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });

  return CONFIG_FILE;
}
