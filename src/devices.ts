import { AxiError } from "axi-sdk-js";
import { deviceScreens, type DeviceModel } from "rmapi-js";

export type { DeviceModel };

/**
 * Short aliases so a caller doesn't have to know model codes.
 *
 * The codes (`RM110`) are what the cloud uses, but nobody thinks in them —
 * an agent told to target "the Paper Pro" should not have to look up `RM02A`.
 */
const ALIASES: Record<string, DeviceModel> = {
  rm1: "RM100",
  "remarkable-1": "RM100",
  rm2: "RM110",
  "remarkable-2": "RM110",
  "paper-pro": "RM02A",
  pp: "RM02A",
  "paper-pro-move": "RM03A",
  ppm: "RM03A",
  move: "RM03A",
  "paper-pure": "RM102",
  pure: "RM102",
};

export const MODELS = Object.keys(deviceScreens) as DeviceModel[];

/** Resolve a model code or alias, case-insensitively. */
export function resolveModel(input: string): DeviceModel | null {
  const key = input.trim();
  const upper = key.toUpperCase();
  if ((MODELS as string[]).includes(upper)) return upper as DeviceModel;

  const alias = ALIASES[key.toLowerCase().replace(/\s+/g, "-")];
  return alias ?? null;
}

/** Every accepted spelling, for error messages. */
export function acceptedNames(): string[] {
  return [...MODELS, ...Object.keys(ALIASES)];
}

/**
 * Resolve the device target for one invocation: an explicit `--device` flag
 * wins, falling back to the configured target, failing structured if neither
 * is present.
 *
 * This is the one place that decision gets made, because every command that
 * needs the page box — `page`, `render`, `check` — must fail the same way
 * when there is nothing to target. Guessing a default here would silently
 * produce documents sized for hardware the user does not own (see
 * `specs/principles.md#measure-the-device-never-ship-a-guessed-constant`).
 */
export function resolveTarget(
  explicit: string | undefined,
  configured: DeviceModel | undefined,
): DeviceModel {
  if (explicit) {
    const model = resolveModel(explicit);
    if (!model) {
      throw new AxiError(`unknown device: ${explicit}`, "USAGE", [
        `Accepted: ${acceptedNames().join(", ")}`,
        "Run `remarkable-axi devices` to see every model with its specs",
      ]);
    }
    return model;
  }

  if (configured) return configured;

  throw new AxiError("no device target set", "NO_DEVICE", [
    `Run \`remarkable-axi setup device <model>\` — models: ${MODELS.join(", ")}`,
    "Or pass `--device <model>` for this invocation only",
  ]);
}

export interface PageBox {
  /** Points. */
  width: number;
  /** Points. */
  height: number;
}

/**
 * Full-bleed portrait (or transposed landscape) page box for a model, in
 * whole points.
 *
 * Rounded because headless Chrome rounds its print box to integer points —
 * the author must not have to know that, and `render` must produce exactly
 * this number or the two would drift apart.
 */
export function pageBox(
  model: DeviceModel,
  opts: { landscape?: boolean } = {},
): PageBox {
  const { width, height, dpi } = deviceScreens[model];
  const portrait: PageBox = {
    width: Math.round((width / dpi) * 72),
    height: Math.round((height / dpi) * 72),
  };
  return opts.landscape
    ? { width: portrait.height, height: portrait.width }
    : portrait;
}

export interface DeviceSpec {
  model: DeviceModel;
  name: string;
  /** Native portrait resolution, e.g. `1620x2160`. */
  screen: string;
  dpi: number;
  /** Physical screen size, e.g. `7.1x9.4in`. */
  physical: string;
  /**
   * Page size in PostScript points for a full-bleed portrait page.
   *
   * This is the number that matters when generating a PDF for the device:
   * sizing a page to the screen's *pixels* produces something far too large,
   * since points are 1/72in and the panels are 226–264dpi.
   */
  pagePt: string;
  /** Portrait aspect ratio, e.g. `3:4`. */
  aspect: string;
  /** Coarse calibration status — see `calibrationLabel`. */
  calibration: string;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Derive the numbers a caller actually designs against. */
export function spec(model: DeviceModel): DeviceSpec {
  const screen = deviceScreens[model];
  const { name, width, height, dpi } = screen;

  const wIn = width / dpi;
  const hIn = height / dpi;
  const divisor = gcd(width, height);
  const box = pageBox(model);

  return {
    model,
    name,
    screen: `${width}x${height}`,
    dpi,
    physical: `${wIn.toFixed(1)}x${hIn.toFixed(1)}in`,
    pagePt: `${box.width}x${box.height}pt`,
    aspect: `${width / divisor}:${height / divisor}`,
    calibration: calibrationLabel(model),
  };
}

/** Specs for every known model. */
export function allSpecs(): DeviceSpec[] {
  return MODELS.map(spec);
}

/**
 * Calibration status of one measurement axis.
 *
 * `n/a` is distinct from `unverified`: a monochrome device has no colour
 * palette to establish at all, and presenting that as "unverified" would
 * imply a measurement is owed that will never be made.
 */
export type AxisStatus = "calibrated" | "unverified" | "n/a";

export interface Calibration {
  pageBox: AxisStatus;
  inkPlacement: AxisStatus;
  palette: AxisStatus;
}

/**
 * Per-model calibration, tracked on the three independent axes defined in
 * `specs/behaviors/device-calibration.md`.
 *
 * Only RM02A (Paper Pro) has been measured. RM110 and RM100 are monochrome
 * hardware, so their palette is `n/a` rather than unverified — no mapping
 * will ever be owed. RM03A carries colour pens whose mapping has not been
 * established.
 *
 * RM102 is `unverified` for a weaker reason: it is not known here whether
 * that model offers colour pens at all, and establishing that is the first
 * step of its calibration. The status records that a determination is owed,
 * not that a known palette went unmeasured.
 *
 * Resolving any unverified axis is tracked in issues #10 (RM110), #11
 * (RM100), #12 (RM03A), #13 (RM102) — see the procedure there before
 * changing this table.
 */
const CALIBRATION: Record<DeviceModel, Calibration> = {
  RM02A: { pageBox: "calibrated", inkPlacement: "calibrated", palette: "calibrated" },
  RM110: { pageBox: "unverified", inkPlacement: "unverified", palette: "n/a" },
  RM100: { pageBox: "unverified", inkPlacement: "unverified", palette: "n/a" },
  RM03A: { pageBox: "unverified", inkPlacement: "unverified", palette: "unverified" },
  RM102: { pageBox: "unverified", inkPlacement: "unverified", palette: "unverified" },
};

/** Per-axis calibration status for a model. */
export function calibration(model: DeviceModel): Calibration {
  return CALIBRATION[model];
}

/**
 * Coarse calibration label for the `devices` table column.
 *
 * `n/a` axes do not count against "calibrated" — a monochrome device with a
 * measured page box and ink placement is fully calibrated for what it has.
 */
export function calibrationLabel(model: DeviceModel): string {
  const c = CALIBRATION[model];
  const settled = (status: AxisStatus) => status !== "unverified";
  const fullyCalibrated =
    c.pageBox === "calibrated" &&
    c.inkPlacement === "calibrated" &&
    settled(c.palette);
  return fullyCalibrated ? "calibrated" : "unverified (published specs)";
}

/**
 * The once-per-invocation caveat for a command whose numbers rest on the
 * unverified page box, or `null` when the model's page box is calibrated.
 *
 * Callers state this once in their own output — never per page or per
 * finding, per `specs/behaviors/device-calibration.md`.
 */
export function pageBoxCaveat(model: DeviceModel): string | null {
  return CALIBRATION[model].pageBox === "calibrated"
    ? null
    : "page box unverified, derived from published specs";
}
