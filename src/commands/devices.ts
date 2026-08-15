import { AxiError } from "axi-sdk-js";
import type { Output } from "../output.js";
import { parseFlags, requirePositional } from "../flags.js";
import { readConfig, writeConfig, configPath } from "../config.js";
import { collapseHome } from "../output.js";
import {
  acceptedNames,
  allSpecs,
  pageBoxCaveat,
  resolveModel,
  spec,
} from "../devices.js";

/**
 * The note that keeps this honest.
 *
 * The cloud API has no endpoint for enumerating an account's devices, so the
 * target is whatever the user declared. Without saying so, an agent reading
 * this output would report it as a fact about the hardware on the desk.
 */
const DECLARED =
  "target is user-declared; the cloud API cannot enumerate account devices";

export async function devices(args: string[]): Promise<Output> {
  const parsed = parseFlags("devices", args, {});
  if (parsed.positional.length > 0) {
    throw new AxiError(
      `devices takes no arguments (got \`${parsed.positional[0]}\`)`,
      "USAGE",
      [
        "Run `remarkable-axi devices` to list known models",
        "Run `remarkable-axi setup device <model>` to set the target",
      ],
    );
  }

  const { targetDevice } = await readConfig();

  return {
    ...(targetDevice
      ? { target: spec(targetDevice).name }
      : { target: "not set" }),
    note: DECLARED,
    devices: allSpecs().map((s) => ({
      model: s.model,
      name: s.name,
      screen: s.screen,
      dpi: s.dpi,
      pagePt: s.pagePt,
      calibration: s.calibration,
      target: s.model === targetDevice ? "yes" : "no",
    })),
    help: [
      targetDevice
        ? "Run `remarkable-axi setup device <model>` to change the target"
        : "Run `remarkable-axi setup device <model>` so the target shows in every session",
      "`pagePt` is the full-bleed portrait page size to generate PDFs at",
      "`calibration` is `calibrated` only where the numbers were measured on hardware — see `specs/behaviors/device-calibration.md`",
    ],
  };
}

/** `setup device <model>` — persist which device to design for. */
export async function setupDevice(args: string[]): Promise<Output> {
  const parsed = parseFlags("setup device", args, {});
  const requested = requirePositional(
    parsed,
    0,
    "a device model",
    "Run `remarkable-axi setup device <model>` — see `remarkable-axi devices`",
  );

  const model = resolveModel(requested);
  if (!model) {
    throw new AxiError(`unknown device: ${requested}`, "USAGE", [
      `Accepted: ${acceptedNames().join(", ")}`,
      "Run `remarkable-axi devices` to see every model with its specs",
    ]);
  }

  const previous = (await readConfig()).targetDevice;
  const path = await writeConfig({ targetDevice: model });
  const s = spec(model);
  // Stated once here, not per command that later reads this target — see
  // specs/behaviors/device-calibration.md.
  const caveat = pageBoxCaveat(model);

  // Setting the same target again is the desired state, not a failure.
  if (previous === model) {
    return {
      device: `${s.name} already the target (no-op)`,
      specs: {
        model: s.model,
        screen: s.screen,
        dpi: s.dpi,
        physical: s.physical,
        pagePt: s.pagePt,
        aspect: s.aspect,
        calibration: s.calibration,
      },
      ...(caveat ? { note: caveat } : {}),
    };
  }

  return {
    device: {
      name: s.name,
      model: s.model,
      screen: s.screen,
      dpi: s.dpi,
      physical: s.physical,
      pagePt: s.pagePt,
      aspect: s.aspect,
      calibration: s.calibration,
    },
    saved: collapseHome(path),
    note: caveat ? `${DECLARED}; ${caveat}` : DECLARED,
    help: [
      "Every session now starts with these specs in context",
      `Generate PDFs at ${s.pagePt} for a full-bleed portrait page`,
    ],
  };
}
