import type { Output } from "../output.js";
import { bool, parseFlags, str } from "../flags.js";
import { readConfig } from "../config.js";
import { pageBox, pageBoxCaveat, resolveTarget, spec } from "../devices.js";
import { cssBlock } from "../page.js";

/**
 * Report the target device's page box, and the CSS to author against it.
 *
 * Makes no cloud call and reads no local document — its only input is the
 * device target, so it stays instant and works unpaired. See
 * `specs/commands/page.md`.
 */
export async function page(args: string[]): Promise<Output> {
  const parsed = parseFlags("page", args, {
    value: ["--device"],
    boolean: ["--landscape", "--css"],
  });

  const explicit = str(parsed, "--device", "") || undefined;
  // Only touch the config file when nothing was declared explicitly, so
  // `--device` genuinely never reads or writes stored config.
  const configured = explicit
    ? undefined
    : (await readConfig()).targetDevice;
  const model = resolveTarget(explicit, configured);

  const s = spec(model);
  const box = pageBox(model, { landscape: bool(parsed, "--landscape") });
  const caveat = pageBoxCaveat(model);

  const output: Output = {
    device: caveat ? `${model} (${s.name}) — ${caveat}` : `${model} (${s.name})`,
    screen: `${s.screen} @ ${s.dpi}dpi`,
    page: `${box.width}x${box.height}pt`,
  };

  if (bool(parsed, "--css")) {
    output.css = cssBlock(box);
  }

  return output;
}
