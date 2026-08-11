import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolveModel, type DeviceModel } from "./devices.js";

const CONFIG_DIR = join(homedir(), ".config", "remarkable-axi");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/** Absolute path of the config file, for diagnostics. */
export const configPath = CONFIG_FILE;

export interface Config {
  /**
   * The device to design for.
   *
   * User-declared, not detected — the cloud API exposes no way to enumerate
   * an account's devices, so nothing here is verified against real hardware.
   */
  targetDevice?: DeviceModel;
}

/**
 * Read the config, treating anything unreadable as empty.
 *
 * A malformed or missing config should never stop a command from running: it
 * only ever carries preferences, and failing hard on it would take the whole
 * CLI down over a stray character.
 */
export async function readConfig(): Promise<Config> {
  try {
    const parsed: unknown = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};

    const raw = (parsed as { targetDevice?: unknown }).targetDevice;
    if (typeof raw !== "string") return {};

    // Validate on read so an edited config can't inject an unknown model.
    const model = resolveModel(raw);
    return model ? { targetDevice: model } : {};
  } catch {
    return {};
  }
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
