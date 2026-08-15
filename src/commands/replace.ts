import { AxiError } from "axi-sdk-js";
import type { Output } from "../output.js";

/**
 * `replace` was folded into `put --replace` — a replace is a put with a
 * destination that already exists. Retained as a targeted redirect (not a
 * generic unknown-command error) so an agent self-corrects in one turn. See
 * specs/commands/README.md#deprecations.
 */
export async function replace(args: string[]): Promise<Output> {
  const positionals = args.filter((a) => !a.startsWith("-"));
  const path = positionals[0] ?? "<path>";
  const file = positionals[1] ?? "<file>";
  const nameIndex = args.indexOf("--name");
  const name = nameIndex !== -1 ? args[nameIndex + 1] : undefined;

  const invocation = [
    `remarkable-axi put ${file} ${path} --replace`,
    ...(name ? [`--name "${name}"`] : []),
  ].join(" ");

  throw new AxiError(
    "`replace` was folded into `put --replace`; a replace is a put with a destination that already exists",
    "USAGE",
    [invocation],
  );
}
