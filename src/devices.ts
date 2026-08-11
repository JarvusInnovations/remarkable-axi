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

  return {
    model,
    name,
    screen: `${width}x${height}`,
    dpi,
    physical: `${wIn.toFixed(1)}x${hIn.toFixed(1)}in`,
    pagePt: `${Math.round(wIn * 72)}x${Math.round(hIn * 72)}pt`,
    aspect: `${width / divisor}:${height / divisor}`,
  };
}

/** Specs for every known model. */
export function allSpecs(): DeviceSpec[] {
  return MODELS.map(spec);
}
