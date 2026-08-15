import { AxiError } from "axi-sdk-js";
import type { Output } from "../output.js";

/**
 * `send` was folded into `put` — a URL is a source type, not a verb. Retained
 * as a targeted redirect (not a generic unknown-command error) so an agent
 * self-corrects in one turn. See specs/commands/README.md#deprecations.
 */
export async function send(args: string[]): Promise<Output> {
  const url = args.find((a) => !a.startsWith("-")) ?? "<url>";
  const dirIndex = args.indexOf("--dir");
  const dir = dirIndex !== -1 ? args[dirIndex + 1] : undefined;
  const titleIndex = args.indexOf("--title");
  const title = titleIndex !== -1 ? args[titleIndex + 1] : undefined;

  const invocation = [
    `remarkable-axi put "${url}"`,
    dir ?? "/",
    ...(title ? [`--name "${title}"`] : []),
  ].join(" ");

  throw new AxiError(
    "`send` was folded into `put`; a URL source is detected automatically",
    "USAGE",
    [invocation],
  );
}
