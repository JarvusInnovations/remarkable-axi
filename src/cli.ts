import { AxiError, exitCodeForError, runAxiCli } from "axi-sdk-js";
import { encode } from "@toon-format/toon";
import {
  DESCRIPTION,
  renderCommandHelp,
  renderTopLevelHelp,
} from "./reference.js";
import { home } from "./commands/home.js";
import { ls, find } from "./commands/browse.js";
import { devices } from "./commands/devices.js";
import { fetch as fetchCmd } from "./commands/fetch.js";
import { send, put } from "./commands/send.js";
import { replace } from "./commands/replace.js";
import { mkdir, mv, rm } from "./commands/organize.js";
import { login, doctor, setup } from "./commands/setup.js";
import { version } from "./version.js";

/**
 * Error codes that represent a malformed invocation rather than a failed
 * operation. AXI §6 requires these to exit 2, but the SDK only maps its own
 * `VALIDATION_ERROR` that way — so they are re-mapped here rather than
 * flattening every usage error into one undifferentiated code.
 */
const USAGE_CODES = new Set(["USAGE", "UNKNOWN_FLAG", "VALIDATION_ERROR"]);

function renderFailure(
  message: string,
  code: string,
  suggestions: string[],
): string {
  const output: Record<string, unknown> = { error: message, code };
  if (suggestions.length > 0) output.help = suggestions;
  // Written verbatim by the SDK, so the trailing newline is ours.
  return `${encode(output)}\n`;
}

export async function main(argv: string[] = process.argv.slice(2)) {
  await runAxiCli({
    description: DESCRIPTION,
    version,
    argv,
    topLevelHelp: renderTopLevelHelp(),
    getCommandHelp: renderCommandHelp,
    home,
    commands: {
      ls,
      find,
      devices,
      fetch: fetchCmd,
      send,
      put,
      replace,
      mkdir,
      mv,
      rm,
      login,
      doctor,
      setup,
    },
    formatError: (error) => {
      if (error instanceof AxiError) {
        return {
          output: renderFailure(error.message, error.code, error.suggestions),
          exitCode: USAGE_CODES.has(error.code) ? 2 : exitCodeForError(error),
        };
      }

      // Never let a raw dependency error or stack trace reach stdout — an
      // agent would try to read it as data.
      const message = error instanceof Error ? error.message : String(error);
      return {
        output: renderFailure(
          `unexpected failure: ${message}`,
          "INTERNAL_ERROR",
          ["Run `remarkable-axi doctor` to check pairing and connectivity"],
        ),
        exitCode: 1,
      };
    },
  });
}
